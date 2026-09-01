import { frozenDates, V43_OUTCOME_SCHEMA, V43_STATION_IDS } from "./v43-outcomes.ts";

const HORIZON_SCHEMA = "noaa_nbm_v43_native_max_t_q95_adaptive_holdout_horizon_v1";
const EVALUATION_SCHEMA = "noaa_nbm_v43_native_max_t_q95_adaptive_holdout_evaluation_v1";
const SHA256 = /^[a-f0-9]{64}$/;
const SCORE = 0.95;
const BOOTSTRAP_SAMPLES = 10_000;
const BOOTSTRAP_SEED = 43_095_042;

type Horizon = "f042" | "f066";
type Row = Record<string, unknown>;

export const V43_HORIZON_SCHEMA = HORIZON_SCHEMA;
export const V43_EVALUATION_SCHEMA = EVALUATION_SCHEMA;

if (import.meta.main) await main(Deno.args);

export async function evaluateV43AdaptiveHoldout(input: {
  f042: unknown;
  f066: unknown;
  outcomes: unknown;
  generatedAt?: Date;
}) {
  const outcomes = await validateOutcomes(input.outcomes);
  const f042 = await validateHorizon(input.f042, "f042");
  const f066 = await validateHorizon(input.f066, "f066");
  const generatedAt = input.generatedAt ?? new Date();
  if (Number.isNaN(generatedAt.getTime())) throw new Error("evaluation generation clock is malformed");
  const stationIds = [...new Set(outcomes.rows.map((row) => row.stationId))].sort();
  const evaluations = [f042, f066].map((evidence) => evaluateHorizon(evidence, outcomes, stationIds));
  const unsigned = {
    schema: EVALUATION_SCHEMA,
    generated_at: generatedAt.toISOString(),
    evidence_class: "adaptive_historical_holdout",
    independent_oos: false,
    profitability_claim: false,
    research_only: true,
    provider_confirmed_fill_evidence: false,
    recommendation_authority: false,
    order_authority: false,
    capital_risk_authority: false,
    trading_authority: false,
    production_activation: false,
    active_trading_capability_changed: false,
    date_window: { start: "2026-01-07", end: "2026-04-16", independent_market_dates: 100 },
    horizon_policy: {
      horizons_evaluated_separately: true,
      pooled_horizon_sample_prohibited: true,
      reported_independent_market_dates: 100,
      prohibited_reported_market_dates: 200,
    },
    outcome_artifact_sha256: outcomes.sha256,
    horizon_artifact_sha256: { f042: f042.sha256, f066: f066.sha256 },
    evaluations,
    limitations: [
      "The Q95/f042/f066 family was selected after related NBM development results; this is an adaptive historical holdout, not independent OOS evidence.",
      "Both horizons use the same 100 official market-date outcome clusters and are never pooled as 200 dates.",
      "Calibration does not establish executable prices, provider-confirmed fills, realized profit, or trading authority.",
    ],
  };
  return { artifact_sha256: await canonicalSha256(unsigned), ...unsigned };
}

export async function writeEvaluationCreateOnce(path: string, evaluation: unknown) {
  const value = object(evaluation, "evaluation artifact");
  const expected = String(value.artifact_sha256 ?? "");
  await verifyHash(value, expected, "evaluation artifact");
  if (
    value.schema !== EVALUATION_SCHEMA || value.evidence_class !== "adaptive_historical_holdout" ||
    value.independent_oos !== false || value.profitability_claim !== false || value.research_only !== true ||
    value.recommendation_authority !== false || value.order_authority !== false ||
    value.capital_risk_authority !== false || value.trading_authority !== false ||
    value.production_activation !== false
  ) throw new Error("evaluation artifact identity or authority is invalid");
  const bytes = new TextEncoder().encode(`${JSON.stringify(evaluation, null, 2)}\n`);
  await Deno.writeFile(path, bytes, { createNew: true });
  return await sha256(bytes);
}

export async function hashArtifact(unsigned: Record<string, unknown>) {
  return { artifact_sha256: await canonicalSha256(unsigned), ...unsigned };
}

function evaluateHorizon(
  evidence: Awaited<ReturnType<typeof validateHorizon>>,
  outcomes: Awaited<ReturnType<typeof validateOutcomes>>,
  stationIds: string[],
) {
  const outcomeByKey = new Map(outcomes.rows.map((row) => [`${row.marketDate}/${row.stationId}`, row.tmaxF]));
  const scored = evidence.rows.map((row) => {
    const tmax = outcomeByKey.get(`${row.marketDate}/${row.stationId}`);
    if (tmax === undefined) throw new Error("horizon row has no exact official outcome");
    const threshold = Math.floor(row.q95MaxF);
    const success = tmax <= threshold ? 1 : 0;
    return { ...row, officialTmaxF: tmax, contractThreshold: threshold, success, margin: success - SCORE };
  });
  const byDate = groupMeans(scored, "marketDate", (row) => row.margin);
  const horizonSeed = BOOTSTRAP_SEED + (evidence.horizon === "f066" ? 1 : 0);
  const clustered = wholeDateClusterBootstrap([...byDate.values()], horizonSeed);
  const stationLoo = stationIds.map((excludedStation) => {
    const remainder = scored.filter((row) => row.stationId !== excludedStation);
    const means = [...groupMeans(remainder, "marketDate", (row) => row.margin).values()];
    const bootstrap = wholeDateClusterBootstrap(means, horizonSeed + stationSeed(excludedStation));
    return {
      excluded_station_id: excludedStation,
      station_dates: remainder.length,
      independent_market_dates: new Set(remainder.map((row) => row.marketDate)).size,
      one_sided_95_lower_margin: bootstrap.oneSided95Lower,
    };
  });
  const stationCounts = counts(scored.map((row) => row.stationId));
  const dateCounts = counts(scored.map((row) => row.marketDate));
  const brier = mean(scored.map((row) => (row.success - SCORE) ** 2));
  return {
    horizon: evidence.horizon,
    artifact_sha256: evidence.sha256,
    rows: scored.length,
    independent_market_dates: byDate.size,
    stations: stationIds.length,
    fixed_probability: SCORE,
    contract_arithmetic: "official_integer_tmax_f <= floor(native_q95_f)",
    successes: scored.reduce((sum, row) => sum + row.success, 0),
    observed_success_rate: mean(scored.map((row) => row.success)),
    brier_score_at_fixed_0_95: brier,
    whole_date_clustered: {
      mean_observed_minus_score: clustered.mean,
      one_sided_90_lower_margin: clustered.oneSided90Lower,
      one_sided_95_lower_margin: clustered.oneSided95Lower,
      method: "deterministic_whole_market_date_cluster_bootstrap_v1",
      seed: horizonSeed,
      samples: BOOTSTRAP_SAMPLES,
      resampled_clusters_per_sample: byDate.size,
    },
    concentration: {
      maximum_station_share: Math.max(...stationCounts.values()) / scored.length,
      maximum_date_share: Math.max(...dateCounts.values()) / scored.length,
    },
    station_leave_one_out: stationLoo,
    gates: {
      complete_100_dates: byDate.size === 100 && scored.length === 2_000,
      nonnegative_clustered_90_margin: clustered.oneSided90Lower >= 0,
      nonnegative_clustered_95_margin: clustered.oneSided95Lower >= 0,
      maximum_station_share_at_most_0_35: Math.max(...stationCounts.values()) / scored.length <= 0.35,
      maximum_date_share_at_most_0_05: Math.max(...dateCounts.values()) / scored.length <= 0.05,
      all_station_leave_one_out_95_nonnegative: stationLoo.every((row) => row.one_sided_95_lower_margin >= 0),
    },
  };
}

async function validateHorizon(value: unknown, horizon: Horizon) {
  const artifact = object(value, `${horizon} artifact`);
  const sha256 = String(artifact.artifact_sha256 ?? "");
  await verifyHash(artifact, sha256, `${horizon} artifact`);
  const coverage = object(artifact.coverage, `${horizon} coverage`);
  const dateWindow = object(artifact.date_window, `${horizon} date window`);
  const sourceProfile = `v43-${horizon}`;
  const sourceProduct = horizon === "f042"
    ? "noaa_nbm_v43_blend_qmd_12z_f042_native_max_t_q95_historical_calibration_v1"
    : "noaa_nbm_v43_blend_qmd_12z_f066_native_max_t_q95_historical_calibration_v1";
  if (
    artifact.schema !== HORIZON_SCHEMA || artifact.horizon !== horizon ||
    artifact.source_profile !== sourceProfile || artifact.source_product !== sourceProduct ||
    artifact.evidence_class !== "adaptive_historical_holdout" || artifact.independent_oos !== false ||
    artifact.research_only !== true || artifact.recommendation_authority !== false ||
    artifact.order_authority !== false || artifact.capital_risk_authority !== false ||
    artifact.trading_authority !== false || artifact.production_activation !== false ||
    dateWindow.start !== "2026-01-07" || dateWindow.end !== "2026-04-16" ||
    dateWindow.independent_market_dates !== 100 || coverage.stations !== 20 || coverage.market_dates !== 100 ||
    coverage.station_dates !== 2_000 || coverage.complete !== true || !Array.isArray(artifact.rows) ||
    artifact.rows.length !== 2_000
  ) throw new Error(`${horizon} artifact identity, authority, or coverage is invalid`);
  const rows = validateEvidenceRows(artifact.rows, horizon);
  return { horizon, sha256, rows };
}

async function validateOutcomes(value: unknown) {
  const artifact = object(value, "outcome artifact");
  const sha256 = String(artifact.artifact_sha256 ?? "");
  await verifyHash(artifact, sha256, "outcome artifact");
  const coverage = object(artifact.coverage, "outcome coverage");
  const dateWindow = object(artifact.date_window, "outcome date window");
  if (
    artifact.schema !== V43_OUTCOME_SCHEMA || artifact.evidence_class !== "adaptive_historical_holdout" ||
    artifact.independent_oos !== false || artifact.research_only !== true || artifact.trading_authority !== false ||
    artifact.recommendation_authority !== false || artifact.order_authority !== false ||
    artifact.capital_risk_authority !== false || artifact.production_activation !== false ||
    dateWindow.start !== "2026-01-07" || dateWindow.end !== "2026-04-16" ||
    dateWindow.independent_market_dates !== 100 || coverage.stations !== 20 || coverage.market_dates !== 100 ||
    coverage.station_dates !== 2_000 || coverage.complete !== true || !Array.isArray(artifact.rows) ||
    artifact.rows.length !== 2_000
  ) throw new Error("outcome artifact identity, authority, or coverage is invalid");
  const expectedDates = frozenDates(), seen = new Set<string>(), rows = [];
  for (const raw of artifact.rows) {
    const row = object(raw, "outcome row");
    const stationId = String(row.station_id ?? ""), marketDate = String(row.market_date ?? "");
    const tmaxF = Number(row.tmax_f);
    if (!/^K[A-Z0-9]{3}$/.test(stationId) || !expectedDates.has(marketDate) || !Number.isInteger(tmaxF)) {
      throw new Error("outcome row identity or integer TMAX is invalid");
    }
    const key = `${marketDate}/${stationId}`;
    if (seen.has(key)) throw new Error("outcome rows duplicate a station/date");
    seen.add(key);
    rows.push({ stationId, marketDate, tmaxF });
  }
  if (seen.size !== 2_000 || !exactStations(rows.map((row) => row.stationId))) {
    throw new Error("outcome rows do not contain exact station/date coverage");
  }
  return { sha256, rows };
}

function validateEvidenceRows(values: unknown[], horizon: Horizon) {
  const expectedDates = frozenDates(), seen = new Set<string>(), rows = [];
  const sourceProfile = `v43-${horizon}`;
  const sourceProduct = horizon === "f042"
    ? "noaa_nbm_v43_blend_qmd_12z_f042_native_max_t_q95_historical_calibration_v1"
    : "noaa_nbm_v43_blend_qmd_12z_f066_native_max_t_q95_historical_calibration_v1";
  for (const raw of values) {
    const row = object(raw, `${horizon} row`);
    const stationId = String(row.station_id ?? ""), marketDate = String(row.market_date ?? "");
    const q95MaxF = Number(row.q95_max_f), runDate = String(row.source_run_date ?? "");
    const expectedRunDate = shiftDate(marketDate, horizon === "f042" ? -1 : -2);
    if (
      !/^K[A-Z0-9]{3}$/.test(stationId) || !expectedDates.has(marketDate) || !Number.isFinite(q95MaxF) ||
      q95MaxF < -100 || q95MaxF > 150 || row.source_profile !== sourceProfile || row.source_product !== sourceProduct ||
      runDate !== expectedRunDate || !SHA256.test(String(row.message_sha256 ?? ""))
    ) throw new Error(`${horizon} row identity is invalid`);
    const key = `${marketDate}/${stationId}`;
    if (seen.has(key)) throw new Error(`${horizon} rows duplicate a station/date`);
    seen.add(key);
    rows.push({ stationId, marketDate, q95MaxF });
  }
  if (seen.size !== 2_000 || !exactStations(rows.map((row) => row.stationId))) {
    throw new Error(`${horizon} rows do not contain exact station/date coverage`);
  }
  return rows;
}

export function wholeDateClusterBootstrap(values: number[], seed: number) {
  if (
    values.length !== 100 || !Number.isSafeInteger(seed) || seed < 1 || values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("whole-date cluster bootstrap requires 100 finite clusters and a positive integer seed");
  }
  const random = mulberry32(seed);
  const means = new Array<number>(BOOTSTRAP_SAMPLES);
  for (let sample = 0; sample < BOOTSTRAP_SAMPLES; sample++) {
    let total = 0;
    for (let draw = 0; draw < values.length; draw++) total += values[Math.floor(random() * values.length)];
    means[sample] = total / values.length;
  }
  means.sort((left, right) => left - right);
  return {
    mean: mean(values),
    oneSided90Lower: means[Math.floor(BOOTSTRAP_SAMPLES * 0.10)],
    oneSided95Lower: means[Math.floor(BOOTSTRAP_SAMPLES * 0.05)],
  };
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

function stationSeed(stationId: string) {
  let seed = 0;
  for (const character of stationId) seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  return seed;
}

function groupMeans<T extends Record<string, unknown>>(
  values: T[],
  key: keyof T,
  select: (value: T) => number,
) {
  const groups = new Map<string, number[]>();
  for (const value of values) {
    const group = String(value[key]);
    const rows = groups.get(group) ?? [];
    rows.push(select(value));
    groups.set(group, rows);
  }
  return new Map([...groups].map(([group, rows]) => [group, mean(rows)]));
}

function counts(values: string[]) {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function exactStations(values: string[]) {
  const actual = [...new Set(values)].sort();
  return JSON.stringify(actual) === JSON.stringify([...V43_STATION_IDS].sort());
}

function mean(values: number[]) {
  if (values.length === 0) throw new Error("mean requires observations");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function verifyHash(artifact: Row, expected: string, label: string) {
  if (!SHA256.test(expected)) throw new Error(`${label} SHA-256 is malformed`);
  const { artifact_sha256: _discard, ...unsigned } = artifact;
  if (await canonicalSha256(unsigned) !== expected) throw new Error(`${label} checksum does not reproduce`);
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
  if (args.size !== 4) throw new Error("v4.3 evaluation arguments are malformed");
  const paths = ["--f042", "--f066", "--outcomes", "--output"].map((key) => args.get(key) ?? "");
  if (paths.some((path) => !path)) throw new Error("v4.3 evaluation arguments are incomplete");
  const [f042, f066, outcomes] = await Promise.all(
    paths.slice(0, 3).map(async (path) => JSON.parse(await Deno.readTextFile(path))),
  );
  const evaluation = await evaluateV43AdaptiveHoldout({ f042, f066, outcomes });
  await writeEvaluationCreateOnce(paths[3], evaluation);
  console.log(JSON.stringify({ schema: evaluation.schema, artifact_sha256: evaluation.artifact_sha256 }));
}

function parseArgs(raw: string[]) {
  const args = new Map<string, string>();
  for (let index = 0; index < raw.length; index += 2) {
    const key = raw[index], value = raw[index + 1];
    if (!key?.startsWith("--") || value === undefined || args.has(key)) throw new Error("arguments are malformed");
    args.set(key, value);
  }
  return args;
}
