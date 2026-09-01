import { frozenDates, V43_OUTCOME_SCHEMA, V43_STATION_IDS } from "./v43-outcomes.ts";
import { V43_HORIZON_SCHEMA } from "./v43-evaluate.ts";

export const V43_F066_PLUS_THREE_EVALUATION_SCHEMA =
  "noaa_nbm_v43_f066_q95_floor_plus_3_adaptive_holdout_evaluation_v1";
export const V43_F066_PLUS_THREE_IDENTITY = "noaa_nbm_v43_f066_q95_floor_plus_3_adaptive_holdout_v1";
export const V43_F066_PLUS_THREE_DEVELOPMENT_START = "2026-01-07";
export const V43_F066_PLUS_THREE_DEVELOPMENT_END = "2026-02-25";
export const V43_F066_PLUS_THREE_HOLDOUT_START = "2026-02-26";
export const V43_F066_PLUS_THREE_HOLDOUT_END = "2026-04-16";
export const V43_F066_PLUS_THREE_BUFFER_F = 3;
export const V43_F066_PLUS_THREE_SCORE = 0.95;
export const V43_F066_PLUS_THREE_BOOTSTRAP_SAMPLES = 10_000;
export const V43_F066_PLUS_THREE_BOOTSTRAP_SEED = 66_095_003;

const F066_SOURCE_PRODUCT = "noaa_nbm_v43_blend_qmd_12z_f066_native_max_t_q95_historical_calibration_v1";
const SHA256 = /^[a-f0-9]{64}$/;
type Row = Record<string, unknown>;

interface SourceRow {
  stationId: string;
  marketDate: string;
  q95MaxF: number;
}

interface OutcomeRow {
  stationId: string;
  marketDate: string;
  tmaxF: number;
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    Deno.exit(1);
  }
}

export async function evaluateV43F066PlusThree(input: {
  f066: unknown;
  outcomes: unknown;
  generatedAt?: Date;
}) {
  const f066 = await validateF066(input.f066);
  const outcomes = await validateOutcomes(input.outcomes);
  const generatedAt = input.generatedAt ?? new Date();
  if (Number.isNaN(generatedAt.getTime())) throw new Error("plus-three evaluation generation clock is malformed");

  const outcomeByKey = new Map(outcomes.rows.map((row) => [`${row.marketDate}/${row.stationId}`, row.tmaxF]));
  const development = f066.rows.filter((row) => row.marketDate <= V43_F066_PLUS_THREE_DEVELOPMENT_END);
  const holdout = f066.rows.filter((row) => row.marketDate >= V43_F066_PLUS_THREE_HOLDOUT_START);
  if (
    development.length !== 1_000 || new Set(development.map((row) => row.marketDate)).size !== 50 ||
    holdout.length !== 1_000 || new Set(holdout.map((row) => row.marketDate)).size !== 50
  ) throw new Error("plus-three development/holdout split is incomplete");

  const scored = holdout.map((row) => {
    const outcome = outcomeByKey.get(`${row.marketDate}/${row.stationId}`);
    if (outcome === undefined) throw new Error("plus-three holdout row has no exact official outcome");
    const threshold = Math.floor(row.q95MaxF) + V43_F066_PLUS_THREE_BUFFER_F;
    const success = outcome <= threshold ? 1 : 0;
    return {
      stationId: row.stationId,
      marketDate: row.marketDate,
      threshold,
      outcome,
      success,
      margin: success - V43_F066_PLUS_THREE_SCORE,
    };
  });
  const dateMeans = [...groupMeans(scored, (row) => row.marketDate, (row) => row.margin).values()];
  const clustered = wholeDateBootstrap50(dateMeans, V43_F066_PLUS_THREE_BOOTSTRAP_SEED);
  const stationIds = [...V43_STATION_IDS].sort();
  const stationLeaveOneOut = stationIds.map((excludedStationId) => {
    const remainder = scored.filter((row) => row.stationId !== excludedStationId);
    const means = [...groupMeans(remainder, (row) => row.marketDate, (row) => row.margin).values()];
    const bootstrap = wholeDateBootstrap50(
      means,
      V43_F066_PLUS_THREE_BOOTSTRAP_SEED + stationSeed(excludedStationId),
    );
    return {
      excluded_station_id: excludedStationId,
      station_dates: remainder.length,
      independent_market_dates: new Set(remainder.map((row) => row.marketDate)).size,
      successes: remainder.reduce((sum, row) => sum + row.success, 0),
      observed_success_rate: mean(remainder.map((row) => row.success)),
      mean_observed_minus_score: bootstrap.mean,
      one_sided_90_lower_margin: bootstrap.oneSided90Lower,
      one_sided_95_lower_margin: bootstrap.oneSided95Lower,
    };
  });
  const stationCounts = counts(scored.map((row) => row.stationId));
  const dateCounts = counts(scored.map((row) => row.marketDate));
  const successes = scored.reduce((sum, row) => sum + row.success, 0);
  const brier = mean(scored.map((row) => (row.success - V43_F066_PLUS_THREE_SCORE) ** 2));
  const unsigned = {
    schema: V43_F066_PLUS_THREE_EVALUATION_SCHEMA,
    identity: V43_F066_PLUS_THREE_IDENTITY,
    generated_at: generatedAt.toISOString(),
    evidence_class: "adaptive_historical_holdout",
    adaptive_selection: true,
    independent_oos: false,
    profitability_claim: false,
    calibrated_probability_claim: false,
    execution_evidence: false,
    provider_confirmed_fill_evidence: false,
    research_only: true,
    recommendation_authority: false,
    order_authority: false,
    capital_risk_authority: false,
    trading_authority: false,
    production_activation: false,
    active_trading_capability_changed: false,
    source_artifact_sha256: f066.sha256,
    outcome_artifact_sha256: outcomes.sha256,
    source_identity: {
      horizon: "f066",
      source_profile: "v43-f066",
      source_product: F066_SOURCE_PRODUCT,
    },
    threshold_policy: {
      arithmetic: "official_integer_tmax_f <= floor(native_f066_q95_f) + 3",
      buffer_f: V43_F066_PLUS_THREE_BUFFER_F,
      fixed_probability: V43_F066_PLUS_THREE_SCORE,
      adjacent_plus_2_identity_accepted: false,
    },
    development_window: {
      start: V43_F066_PLUS_THREE_DEVELOPMENT_START,
      end: V43_F066_PLUS_THREE_DEVELOPMENT_END,
      station_dates_inspected: development.length,
      market_dates_inspected: 50,
      holdout_rows_credited: 0,
      holdout_market_dates_credited: 0,
    },
    holdout_window: {
      start: V43_F066_PLUS_THREE_HOLDOUT_START,
      end: V43_F066_PLUS_THREE_HOLDOUT_END,
      station_dates: scored.length,
      independent_market_dates: dateMeans.length,
      stations: stationIds.length,
    },
    cluster_policy: {
      unit: "whole_market_date",
      reported_independent_market_dates: 50,
      prohibited_100_date_inflation: true,
      prohibited_200_date_inflation: true,
      development_pooling_prohibited: true,
      f042_pooling_prohibited: true,
      station_row_independence_claim_prohibited: true,
    },
    results: {
      rows: scored.length,
      successes,
      failures: scored.length - successes,
      observed_success_rate: successes / scored.length,
      brier_score_at_fixed_0_95: brier,
      whole_date_clustered: {
        mean_observed_minus_score: clustered.mean,
        one_sided_90_lower_margin: clustered.oneSided90Lower,
        one_sided_95_lower_margin: clustered.oneSided95Lower,
        method: "deterministic_whole_market_date_cluster_bootstrap_v1",
        seed: V43_F066_PLUS_THREE_BOOTSTRAP_SEED,
        samples: V43_F066_PLUS_THREE_BOOTSTRAP_SAMPLES,
        resampled_clusters_per_sample: dateMeans.length,
      },
      concentration: {
        maximum_station_share: Math.max(...stationCounts.values()) / scored.length,
        maximum_date_share: Math.max(...dateCounts.values()) / scored.length,
      },
      station_leave_one_out: stationLeaveOneOut,
    },
    gates: {
      complete_exact_50_dates: dateMeans.length === 50 && scored.length === 1_000,
      nonnegative_clustered_90_margin: clustered.oneSided90Lower >= 0,
      nonnegative_clustered_95_margin: clustered.oneSided95Lower >= 0,
      maximum_station_share_at_most_0_05: Math.max(...stationCounts.values()) / scored.length <= 0.05,
      maximum_date_share_at_most_0_02: Math.max(...dateCounts.values()) / scored.length <= 0.02,
      all_station_leave_one_out_90_nonnegative: stationLeaveOneOut.every((row) => row.one_sided_90_lower_margin >= 0),
      all_station_leave_one_out_95_nonnegative: stationLeaveOneOut.every((row) => row.one_sided_95_lower_margin >= 0),
    },
    limitations: [
      "The +3F buffer was chosen after inspecting January 7 through February 25 and is not independent OOS evidence.",
      "Only February 26 through April 16 contributes to the 50-date adaptive holdout result.",
      "A pass cannot establish executable prices, provider-confirmed fills, realized profit, or trading authority.",
    ],
  };
  return { artifact_sha256: await canonicalSha256(unsigned), ...unsigned };
}

export async function writeV43F066PlusThreeCreateOnce(path: string, evaluation: unknown) {
  const output = childOfVarTmp(path, "plus-three evaluation output");
  if (!output.endsWith(".json")) throw new Error("plus-three evaluation output must be JSON");
  const value = object(evaluation, "plus-three evaluation artifact");
  const expected = text(value.artifact_sha256, "plus-three evaluation SHA-256");
  await verifyHash(value, expected, "plus-three evaluation artifact");
  const threshold = object(value.threshold_policy, "plus-three threshold policy");
  const holdout = object(value.holdout_window, "plus-three holdout window");
  const development = object(value.development_window, "plus-three development window");
  if (
    value.schema !== V43_F066_PLUS_THREE_EVALUATION_SCHEMA || value.identity !== V43_F066_PLUS_THREE_IDENTITY ||
    value.adaptive_selection !== true || value.independent_oos !== false || value.profitability_claim !== false ||
    value.research_only !== true || value.recommendation_authority !== false || value.order_authority !== false ||
    value.capital_risk_authority !== false || value.trading_authority !== false ||
    value.production_activation !== false ||
    threshold.buffer_f !== V43_F066_PLUS_THREE_BUFFER_F || threshold.fixed_probability !== 0.95 ||
    threshold.arithmetic !== "official_integer_tmax_f <= floor(native_f066_q95_f) + 3" ||
    threshold.adjacent_plus_2_identity_accepted !== false ||
    holdout.start !== V43_F066_PLUS_THREE_HOLDOUT_START || holdout.end !== V43_F066_PLUS_THREE_HOLDOUT_END ||
    holdout.independent_market_dates !== 50 || holdout.station_dates !== 1_000 ||
    development.holdout_rows_credited !== 0 || development.holdout_market_dates_credited !== 0
  ) throw new Error("plus-three evaluation identity or authority is invalid");
  const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  await Deno.writeFile(output, bytes, { createNew: true });
  return await sha256(bytes);
}

export function wholeDateBootstrap50(values: number[], seed: number) {
  if (
    values.length !== 50 || !Number.isSafeInteger(seed) || seed < 1 ||
    values.some((value) => !Number.isFinite(value))
  ) throw new Error("plus-three bootstrap requires exactly 50 finite whole-date clusters and a positive seed");
  const random = mulberry32(seed), means = new Array<number>(V43_F066_PLUS_THREE_BOOTSTRAP_SAMPLES);
  for (let sample = 0; sample < means.length; sample++) {
    let total = 0;
    for (let draw = 0; draw < values.length; draw++) total += values[Math.floor(random() * values.length)];
    means[sample] = total / values.length;
  }
  means.sort((left, right) => left - right);
  return {
    mean: mean(values),
    oneSided90Lower: means[Math.floor(means.length * 0.10)],
    oneSided95Lower: means[Math.floor(means.length * 0.05)],
  };
}

async function validateF066(value: unknown) {
  const artifact = object(value, "f066 artifact"), sha256 = text(artifact.artifact_sha256, "f066 SHA-256");
  await verifyHash(artifact, sha256, "f066 artifact");
  const coverage = object(artifact.coverage, "f066 coverage"), window = object(artifact.date_window, "f066 window");
  if (
    artifact.schema !== V43_HORIZON_SCHEMA || artifact.horizon !== "f066" ||
    artifact.source_profile !== "v43-f066" || artifact.source_product !== F066_SOURCE_PRODUCT ||
    artifact.evidence_class !== "adaptive_historical_holdout" || artifact.independent_oos !== false ||
    artifact.research_only !== true || artifact.recommendation_authority !== false ||
    artifact.order_authority !== false || artifact.capital_risk_authority !== false ||
    artifact.trading_authority !== false || artifact.production_activation !== false ||
    window.start !== "2026-01-07" || window.end !== "2026-04-16" || window.independent_market_dates !== 100 ||
    coverage.stations !== 20 || coverage.market_dates !== 100 || coverage.station_dates !== 2_000 ||
    coverage.complete !== true || !Array.isArray(artifact.rows) || artifact.rows.length !== 2_000
  ) throw new Error("f066 artifact identity, authority, or coverage is invalid");
  const rows = validateSourceRows(artifact.rows);
  return { sha256, rows };
}

async function validateOutcomes(value: unknown) {
  const artifact = object(value, "outcome artifact"), sha256 = text(artifact.artifact_sha256, "outcome SHA-256");
  await verifyHash(artifact, sha256, "outcome artifact");
  const coverage = object(artifact.coverage, "outcome coverage"),
    window = object(artifact.date_window, "outcome window");
  if (
    artifact.schema !== V43_OUTCOME_SCHEMA || artifact.evidence_class !== "adaptive_historical_holdout" ||
    artifact.independent_oos !== false || artifact.research_only !== true ||
    artifact.recommendation_authority !== false ||
    artifact.order_authority !== false || artifact.capital_risk_authority !== false ||
    artifact.trading_authority !== false || artifact.production_activation !== false ||
    window.start !== "2026-01-07" || window.end !== "2026-04-16" || window.independent_market_dates !== 100 ||
    coverage.stations !== 20 || coverage.market_dates !== 100 || coverage.station_dates !== 2_000 ||
    coverage.complete !== true || !Array.isArray(artifact.rows) || artifact.rows.length !== 2_000
  ) throw new Error("outcome artifact identity, authority, or coverage is invalid");
  const expectedDates = frozenDates(), expectedStations = new Set<string>(V43_STATION_IDS), seen = new Set<string>();
  const rows: OutcomeRow[] = artifact.rows.map((raw) => {
    const row = object(raw, "outcome row"), stationId = text(row.station_id, "outcome station");
    const marketDate = text(row.market_date, "outcome date"), tmaxF = Number(row.tmax_f);
    const key = `${marketDate}/${stationId}`;
    if (
      !expectedStations.has(stationId) || !expectedDates.has(marketDate) || !Number.isInteger(tmaxF) || seen.has(key)
    ) throw new Error("outcome row identity is invalid");
    seen.add(key);
    return { stationId, marketDate, tmaxF };
  });
  if (seen.size !== 2_000) throw new Error("outcome station/date coverage is incomplete");
  return { sha256, rows };
}

function validateSourceRows(values: unknown[]) {
  const expectedDates = frozenDates(), expectedStations = new Set<string>(V43_STATION_IDS), seen = new Set<string>();
  const rows: SourceRow[] = values.map((raw) => {
    const row = object(raw, "f066 row"), stationId = text(row.station_id, "f066 station");
    const marketDate = text(row.market_date, "f066 date"), q95MaxF = Number(row.q95_max_f);
    const key = `${marketDate}/${stationId}`;
    if (
      !expectedStations.has(stationId) || !expectedDates.has(marketDate) || !Number.isFinite(q95MaxF) ||
      q95MaxF < -100 || q95MaxF > 150 || row.source_profile !== "v43-f066" ||
      row.source_product !== F066_SOURCE_PRODUCT || row.source_run_date !== shiftDate(marketDate, -2) ||
      !SHA256.test(String(row.message_sha256 ?? "")) || seen.has(key)
    ) throw new Error("f066 row identity is invalid");
    seen.add(key);
    return { stationId, marketDate, q95MaxF };
  });
  if (seen.size !== 2_000) throw new Error("f066 station/date coverage is incomplete");
  return rows;
}

function groupMeans<T>(values: T[], key: (value: T) => string, select: (value: T) => number) {
  const groups = new Map<string, number[]>();
  for (const value of values) {
    const identity = key(value), rows = groups.get(identity) ?? [];
    rows.push(select(value));
    groups.set(identity, rows);
  }
  return new Map([...groups].map(([identity, rows]) => [identity, mean(rows)]));
}

function counts(values: string[]) {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function stationSeed(stationId: string) {
  let seed = 0;
  for (const character of stationId) seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  return seed;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function mean(values: number[]) {
  if (values.length === 0) throw new Error("mean requires observations");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function object(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value as Row;
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is malformed`);
  return value;
}

function childOfVarTmp(value: string, label: string) {
  const normalized = value.startsWith("/var/tmp/") ? value.replace(/\/+$/, "") : "";
  if (!normalized || normalized === "/var/tmp") throw new Error(`${label} must be a child of /var/tmp`);
  return normalized;
}

async function verifyHash(value: Row, expected: string, label: string) {
  if (!SHA256.test(expected)) throw new Error(`${label} SHA-256 is malformed`);
  const { artifact_sha256: _discard, ...unsigned } = value;
  if (await canonicalSha256(unsigned) !== expected) throw new Error(`${label} checksum does not reproduce`);
}

async function canonicalSha256(value: unknown) {
  return await sha256(new TextEncoder().encode(JSON.stringify(value)));
}

async function sha256(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function main(raw: string[]) {
  const args = parseArgs(raw);
  const [f066, outcomes] = await Promise.all([
    Deno.readTextFile(args.f066).then(JSON.parse),
    Deno.readTextFile(args.outcomes).then(JSON.parse),
  ]);
  const evaluation = await evaluateV43F066PlusThree({ f066, outcomes });
  await writeV43F066PlusThreeCreateOnce(args.output, evaluation);
  console.log(JSON.stringify({
    ok: true,
    schema: evaluation.schema,
    artifact_sha256: evaluation.artifact_sha256,
    holdout_window: evaluation.holdout_window,
    results: evaluation.results,
  }));
}

function parseArgs(raw: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < raw.length; index += 2) {
    const key = raw[index], value = raw[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error("arguments are malformed");
    values.set(key, value);
  }
  if (values.size !== 3 || !values.get("--f066") || !values.get("--outcomes") || !values.get("--output")) {
    throw new Error("plus-three evaluation requires f066, outcomes, and output");
  }
  return {
    f066: childOfVarTmp(values.get("--f066")!, "f066 input"),
    outcomes: childOfVarTmp(values.get("--outcomes")!, "outcome input"),
    output: childOfVarTmp(values.get("--output")!, "plus-three output"),
  };
}
