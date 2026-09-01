import { frozenDates, V43_OUTCOME_SCHEMA, V43_STATION_IDS } from "./v43-outcomes.ts";
import {
  V43_F066_PLUS_THREE_HOLDOUT_END,
  V43_F066_PLUS_THREE_HOLDOUT_START,
  V43_F066_PLUS_THREE_IDENTITY,
} from "./v43-f066-plus-three-evaluate.ts";
import { V43_EXECUTION_PROXY_SCHEMA } from "./v43-execution-proxy.ts";

export const V43_F066_PLUS_THREE_ECONOMICS_SCHEMA = "noaa_nbm_v43_f066_q95_floor_plus_3_exact_fee_economics_proxy_v1";
export const V43_F066_PLUS_THREE_ECONOMICS_IDENTITY = "noaa_nbm_v43_f066_q95_floor_plus_3_exact_fee_economics_proxy_v1";
export const V43_F066_PLUS_THREE_FIXED_PROBABILITY_UNITS = 9_500;
export const V43_F066_PLUS_THREE_MIN_PRICE_UNITS = 7_000;
export const V43_F066_PLUS_THREE_MAX_PRICE_UNITS = 9_700;
export const V43_F066_PLUS_THREE_MIN_EDGE_UNITS = 150;
export const V43_F066_PLUS_THREE_MAX_PER_DATE = 3;
export const V43_F066_PLUS_THREE_MIN_SUPPORTED_DATES = 30;
export const V43_F066_PLUS_THREE_ECONOMICS_BOOTSTRAP_SAMPLES = 10_000;
export const V43_F066_PLUS_THREE_ECONOMICS_BOOTSTRAP_SEED = 66_095_703;

const SHA256 = /^[a-f0-9]{64}$/;
const PRICE = /^(0|1)\.[0-9]{4}$/;
type Row = Record<string, unknown>;

interface ProxyRow {
  stationId: string;
  marketDate: string;
  ticker: string;
  thresholdF: number;
  priceUnits: number;
  compatiblePublicTrade: boolean;
  contractResult: "yes" | "no";
  contractExpirationF: number;
}

interface OutcomeRow {
  stationId: string;
  marketDate: string;
  tmaxF: number;
}

export async function evaluateV43F066PlusThreeEconomics(input: { proxy: unknown; outcomes: unknown }) {
  const proxy = await validateProxy(input.proxy);
  const outcomes = await validateOutcomes(input.outcomes);
  const outcomeByKey = new Map(outcomes.rows.map((row) => [`${row.marketDate}/${row.stationId}`, row.tmaxF]));
  const bandRows = proxy.rows.map((row) => scoreRow(row, outcomeByKey));
  const eligible = bandRows.filter((row) => row.exact_fee_edge_units >= V43_F066_PLUS_THREE_MIN_EDGE_UNITS);
  const selected = rankAtMostThreePerDate(eligible);
  const opportunityDates = holdoutDates();
  const selectedPnlByDate = new Map(opportunityDates.map((date) => [date, 0]));
  for (const row of selected) {
    selectedPnlByDate.set(row.market_date, selectedPnlByDate.get(row.market_date)! + row.net_proxy_pnl_units);
  }
  const clustered = wholeDatePnlBootstrap(
    opportunityDates.map((date) => selectedPnlByDate.get(date)!),
    V43_F066_PLUS_THREE_ECONOMICS_BOOTSTRAP_SEED,
  );
  const selectedSupportedDates = new Set(selected.map((row) => row.market_date)).size;
  const bandNetUnits = bandRows.reduce((sum, row) => sum + row.net_proxy_pnl_units, 0);
  const selectedNetUnits = selected.reduce((sum, row) => sum + row.net_proxy_pnl_units, 0);
  const gates = {
    complete_exact_50_opportunity_dates: opportunityDates.length === 50,
    exact_fee_edge_at_least_0_015: selected.length > 0 &&
      selected.every((row) => row.exact_fee_edge_units >= V43_F066_PLUS_THREE_MIN_EDGE_UNITS),
    at_most_three_station_distinct_rows_per_date: selected.every((row, index) =>
      selected.filter((other) => other.market_date === row.market_date).length <= 3 &&
      selected.findIndex((other) => other.market_date === row.market_date && other.station_id === row.station_id) ===
        index
    ),
    positive_one_sided_90_clustered_net_proxy_pnl: clustered.oneSided90Lower > 0,
    at_least_30_independent_supported_dates: selectedSupportedDates >= V43_F066_PLUS_THREE_MIN_SUPPORTED_DATES,
    exact_executable_depth: false,
    provider_confirmed_fills: false,
    independent_oos: false,
  };
  const blockers = [
    ...(!gates.positive_one_sided_90_clustered_net_proxy_pnl ? ["NONPOSITIVE_CLUSTERED_90_NET_PROXY_PNL"] : []),
    ...(!gates.at_least_30_independent_supported_dates ? ["SPARSE_EXECUTABLE_PRICE_SUPPORT"] : []),
    "HISTORICAL_DEPTH_UNAVAILABLE",
    "PROVIDER_CONFIRMED_FILLS_ZERO",
    "ADAPTIVE_HISTORICAL_NOT_INDEPENDENT_OOS",
  ];
  const unsigned = {
    schema: V43_F066_PLUS_THREE_ECONOMICS_SCHEMA,
    identity: V43_F066_PLUS_THREE_ECONOMICS_IDENTITY,
    generated_at: proxy.generatedAt,
    evidence_class: "historical_public_exact_fee_economics_proxy",
    adaptive_historical: true,
    independent_oos: false,
    profitability_claim: false,
    calibrated_probability_claim: false,
    executable_depth_evidence: false,
    provider_confirmed_fill_evidence: false,
    realized_pnl_evidence: false,
    research_only: true,
    recommendation_authority: false,
    order_authority: false,
    capital_risk_authority: false,
    trading_authority: false,
    production_activation: false,
    input_artifacts: {
      execution_proxy_sha256: proxy.sha256,
      outcome_sha256: outcomes.sha256,
      frozen_policy_identity: V43_F066_PLUS_THREE_IDENTITY,
    },
    frozen_policy: {
      market_dates: {
        start: V43_F066_PLUS_THREE_HOLDOUT_START,
        end: V43_F066_PLUS_THREE_HOLDOUT_END,
        independent_opportunity_dates: 50,
      },
      condition: "greater",
      side: "no",
      threshold: "floor(native_f066_q95_f)+3F",
      fixed_probability: "0.9500",
      first_complete_candle_price_proxy_only: true,
      displayed_depth_required_but_historically_unavailable: true,
      price_min_inclusive: "0.7000",
      price_max_inclusive: "0.9700",
      exact_taker_fee: "ceil(0.07 * contracts * price * (1-price) * 10000) / 10000, one contract, one order",
      exact_fee_edge_min_inclusive: "0.0150",
      rank: "descending_exact_fee_edge_then_ticker",
      maximum_station_distinct_rows_per_date: V43_F066_PLUS_THREE_MAX_PER_DATE,
    },
    quote_support: {
      exact_causal_quote_proxies: proxy.causalQuoteCount,
      exact_causal_compatible_public_trade_proxies: proxy.compatibleCount,
      frozen_price_band_rows: bandRows.length,
      frozen_price_band_compatible_public_trade_rows: bandRows.filter((row) => row.compatible_public_trade).length,
      exact_depth_qualified_rows: 0,
      provider_confirmed_fills: 0,
    },
    price_band_diagnostic: {
      rows: bandRows.length,
      wins: bandRows.filter((row) => row.success).length,
      losses: bandRows.filter((row) => !row.success).length,
      independent_supported_dates: new Set(bandRows.map((row) => row.market_date)).size,
      net_proxy_pnl_units: bandNetUnits,
      net_proxy_pnl_dollars: formatUnits(bandNetUnits),
      rows_detail: bandRows,
    },
    exact_edge_selection: {
      candidates_before_daily_rank: eligible.length,
      selected_rows: selected.length,
      independent_opportunity_dates: opportunityDates.length,
      independent_supported_dates: selectedSupportedDates,
      support_fraction: `${selectedSupportedDates}/${opportunityDates.length}`,
      net_proxy_pnl_units: selectedNetUnits,
      net_proxy_pnl_dollars: formatUnits(selectedNetUnits),
      rows_detail: selected,
      whole_date_clustered: {
        method: "deterministic_whole_market_date_net_pnl_bootstrap_v1",
        seed: V43_F066_PLUS_THREE_ECONOMICS_BOOTSTRAP_SEED,
        samples: V43_F066_PLUS_THREE_ECONOMICS_BOOTSTRAP_SAMPLES,
        resampled_clusters_per_sample: 50,
        zero_pnl_dates_retained: 50 - selectedSupportedDates,
        mean_net_proxy_pnl_dollars_per_opportunity_date: clustered.mean / 10_000,
        one_sided_90_lower_dollars_per_opportunity_date: clustered.oneSided90Lower / 10_000,
        one_sided_95_lower_dollars_per_opportunity_date: clustered.oneSided95Lower / 10_000,
      },
    },
    gates,
    decision: {
      promotion_ready: false,
      blockers,
    },
    limitations: [
      "The public candle is a one-minute price proxy without displayed depth or within-minute quote ordering.",
      "Public trades are execution-plausibility proxies, not provider-confirmed member fills.",
      "The +3F rule is adaptive historical evidence and is not independent OOS calibration.",
      "Only one of 50 opportunity dates passes exact fee edge; sparse support cannot establish conservative net EV.",
      "Proxy P&L is diagnostic and is neither realized P&L nor trading authority.",
    ],
  };
  return { artifact_sha256: await canonicalSha256(unsigned), ...unsigned };
}

export function exactTakerFeeUnits(priceUnits: number, contracts = 1) {
  if (
    !Number.isSafeInteger(priceUnits) || priceUnits < 0 || priceUnits > 10_000 ||
    !Number.isSafeInteger(contracts) || contracts !== 1
  ) throw new Error("exact taker fee requires one contract and a unit price in ten-thousandths");
  const numerator = 7n * BigInt(contracts) * BigInt(priceUnits) * BigInt(10_000 - priceUnits);
  return Number((numerator + 999_999n) / 1_000_000n);
}

export function exactFeeEconomics(price: string) {
  const priceUnits = priceToUnits(price);
  const feeUnits = exactTakerFeeUnits(priceUnits);
  return {
    price_units: priceUnits,
    in_frozen_price_band: priceUnits >= V43_F066_PLUS_THREE_MIN_PRICE_UNITS &&
      priceUnits <= V43_F066_PLUS_THREE_MAX_PRICE_UNITS,
    taker_fee_units: feeUnits,
    exact_fee_edge_units: V43_F066_PLUS_THREE_FIXED_PROBABILITY_UNITS - priceUnits - feeUnits,
  };
}

export function wholeDatePnlBootstrap(values: number[], seed: number) {
  if (
    values.length !== 50 || values.some((value) => !Number.isSafeInteger(value)) ||
    !Number.isSafeInteger(seed) || seed < 1
  ) throw new Error("economics bootstrap requires exactly 50 integer whole-date P&L clusters and a positive seed");
  const random = mulberry32(seed), means = new Array<number>(V43_F066_PLUS_THREE_ECONOMICS_BOOTSTRAP_SAMPLES);
  for (let sample = 0; sample < means.length; sample++) {
    let total = 0;
    for (let draw = 0; draw < values.length; draw++) total += values[Math.floor(random() * values.length)];
    means[sample] = total / values.length;
  }
  means.sort((left, right) => left - right);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    oneSided90Lower: means[Math.floor(means.length * 0.10)],
    oneSided95Lower: means[Math.floor(means.length * 0.05)],
  };
}

export async function writeV43F066PlusThreeEconomicsCreateOnce(path: string, artifact: unknown) {
  const output = childOfVarTmp(path, "economics output");
  if (!output.endsWith(".json")) throw new Error("economics output must be JSON");
  const value = object(artifact, "economics artifact");
  const expected = text(value.artifact_sha256, "economics artifact SHA-256");
  await verifyHash(value, expected, "economics artifact");
  const decision = object(value.decision, "economics decision");
  if (
    value.schema !== V43_F066_PLUS_THREE_ECONOMICS_SCHEMA ||
    value.identity !== V43_F066_PLUS_THREE_ECONOMICS_IDENTITY || value.independent_oos !== false ||
    value.profitability_claim !== false || value.executable_depth_evidence !== false ||
    value.provider_confirmed_fill_evidence !== false || value.realized_pnl_evidence !== false ||
    value.research_only !== true || value.recommendation_authority !== false || value.order_authority !== false ||
    value.capital_risk_authority !== false || value.trading_authority !== false ||
    value.production_activation !== false || decision.promotion_ready !== false
  ) throw new Error("economics artifact identity or authority is invalid");
  const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  await Deno.writeFile(output, bytes, { createNew: true });
  return await sha256(bytes);
}

function scoreRow(row: ProxyRow, outcomeByKey: Map<string, number>) {
  const tmaxF = outcomeByKey.get(`${row.marketDate}/${row.stationId}`);
  if (tmaxF === undefined) throw new Error("price-band proxy row has no exact official outcome");
  const feeUnits = exactTakerFeeUnits(row.priceUnits);
  const edgeUnits = V43_F066_PLUS_THREE_FIXED_PROBABILITY_UNITS - row.priceUnits - feeUnits;
  const success = tmaxF <= row.thresholdF;
  if (row.contractExpirationF !== tmaxF || row.contractResult !== (success ? "no" : "yes")) {
    throw new Error("exact official outcome does not agree with the finalized contract result");
  }
  const pnlUnits = success ? 10_000 - row.priceUnits - feeUnits : -row.priceUnits - feeUnits;
  return {
    market_date: row.marketDate,
    station_id: row.stationId,
    ticker: row.ticker,
    threshold_f: row.thresholdF,
    official_tmax_f: tmaxF,
    side: "no",
    success,
    no_ask_proxy: formatUnits(row.priceUnits),
    price_units: row.priceUnits,
    taker_fee_units: feeUnits,
    taker_fee_dollars: formatUnits(feeUnits),
    exact_fee_edge_units: edgeUnits,
    exact_fee_edge_dollars: formatUnits(edgeUnits),
    compatible_public_trade: row.compatiblePublicTrade,
    displayed_depth: null,
    provider_confirmed_fill: false,
    net_proxy_pnl_units: pnlUnits,
    net_proxy_pnl_dollars: formatUnits(pnlUnits),
  };
}

function rankAtMostThreePerDate<
  T extends { market_date: string; station_id: string; ticker: string; exact_fee_edge_units: number },
>(
  rows: T[],
) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const values = grouped.get(row.market_date) ?? [];
    if (values.some((value) => value.station_id === row.station_id)) {
      throw new Error("economics rank has duplicate station/date support");
    }
    values.push(row);
    grouped.set(row.market_date, values);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([, values]) =>
    values.sort((left, right) =>
      right.exact_fee_edge_units - left.exact_fee_edge_units || left.ticker.localeCompare(right.ticker)
    ).slice(0, V43_F066_PLUS_THREE_MAX_PER_DATE)
  );
}

async function validateProxy(value: unknown) {
  const artifact = object(value, "execution proxy artifact"),
    sha256Value = text(
      artifact.artifact_sha256,
      "execution proxy SHA-256",
    );
  await verifyHash(artifact, sha256Value, "execution proxy artifact");
  const metrics = object(artifact.metrics, "execution proxy metrics");
  const boundaries = object(artifact.evidence_boundaries, "execution proxy boundaries");
  const policy = object(artifact.frozen_policy, "execution proxy policy");
  const dates = object(policy.market_dates, "execution proxy market dates");
  const requestPolicy = object(artifact.request_policy, "execution proxy request policy");
  if (
    artifact.schema !== V43_EXECUTION_PROXY_SCHEMA || artifact.horizon !== "f066" ||
    artifact.supported_policy_identity !== V43_F066_PLUS_THREE_IDENTITY || artifact.evidence_class !==
      "historical_public_execution_proxy" ||
    artifact.research_only !== true || artifact.independent_oos !== false ||
    artifact.profitability_claim !== false || artifact.executable_depth_evidence !== false ||
    artifact.provider_confirmed_fill_evidence !== false || artifact.recommendation_authority !== false ||
    artifact.order_authority !== false || artifact.capital_risk_authority !== false ||
    artifact.trading_authority !== false || artifact.production_activation !== false ||
    boundaries.historical_depth_available !== false ||
    boundaries.exact_f066_first_depth_qualified_selection_available !== false ||
    boundaries.f066_price_band_proxy_is_exact_net_ev !== false ||
    dates.start !== V43_F066_PLUS_THREE_HOLDOUT_START || dates.end !== V43_F066_PLUS_THREE_HOLDOUT_END ||
    dates.independent_dates !== 50 || policy.condition !== "greater" || policy.side !== "no" ||
    policy.threshold !== "floor(native_q95_f)+3F" || policy.station_dates !== 1_000 ||
    policy.first_depth_qualified_quote_reconstructed !== false ||
    requestPolicy.maximum_reads_per_second !== 1 || requestPolicy.maximum_candlestick_reads_per_second !== 1 ||
    requestPolicy.no_retry !== true || requestPolicy.terminal_http_429 !== true ||
    !Array.isArray(artifact.rows) || artifact.rows.length !== 1_000
  ) throw new Error("execution proxy identity, evidence boundary, or authority is invalid");
  const expectedDates = new Set(holdoutDates()), expectedStations = new Set<string>(V43_STATION_IDS);
  const seen = new Set<string>(), bandRows: ProxyRow[] = [];
  let causalQuoteCount = 0, compatibleCount = 0;
  for (const raw of artifact.rows) {
    const row = object(raw, "execution proxy row"), support = object(row.support, "execution proxy row support");
    const stationId = text(row.station_id, "execution proxy station"),
      marketDate = text(
        row.market_date,
        "execution proxy date",
      );
    const key = `${marketDate}/${stationId}`, q95 = Number(row.q95_max_f), threshold = Number(row.threshold_f);
    if (
      !expectedDates.has(marketDate) || !expectedStations.has(stationId) || seen.has(key) || !Number.isFinite(q95) ||
      !Number.isSafeInteger(threshold) || threshold !== Math.floor(q95) + 3 || row.condition !== "greater" ||
      row.side !== "no" || support.displayed_depth_verified !== false ||
      support.exact_prospective_selection_reconstructed !== false || support.provider_confirmed_fill !== false
    ) throw new Error("execution proxy row identity or evidence boundary is invalid");
    seen.add(key);
    if (support.causal_quote_proxy === true) {
      causalQuoteCount += 1;
      const quote = object(row.quote_proxy, "execution proxy quote"),
        contract = object(
          row.contract,
          "execution proxy contract",
        );
      if (
        quote.displayed_depth !== null || quote.supported !== true ||
        contract.result !== "yes" && contract.result !== "no"
      ) throw new Error("execution proxy causal quote or outcome identity is invalid");
      const economics = exactFeeEconomics(text(quote.no_ask_proxy, "execution proxy NO ask"));
      const inBand = economics.in_frozen_price_band;
      if (support.frozen_price_band_proxy !== inBand) throw new Error("execution proxy price-band flag is invalid");
      if (support.compatible_public_trade === true) compatibleCount += 1;
      if (inBand) {
        bandRows.push({
          stationId,
          marketDate,
          ticker: text(contract.ticker, "execution proxy ticker"),
          thresholdF: threshold,
          priceUnits: economics.price_units,
          compatiblePublicTrade: support.compatible_public_trade === true,
          contractResult: contract.result,
          contractExpirationF: Number(contract.expiration_value),
        });
      }
    } else if (support.frozen_price_band_proxy !== false) {
      throw new Error("unsupported execution proxy row cannot receive price-band credit");
    }
  }
  if (
    seen.size !== 1_000 || metrics.station_dates !== 1_000 || metrics.causal_quote_proxies !== causalQuoteCount ||
    metrics.compatible_public_trade_proxies !== compatibleCount || metrics.frozen_price_band_quote_proxies !==
      bandRows.length ||
    metrics.exact_prospective_selections_reconstructed !== 0 ||
    metrics.provider_confirmed_fills !== 0
  ) throw new Error("execution proxy metrics do not reproduce from rows");
  return {
    sha256: sha256Value,
    generatedAt: text(artifact.generated_at, "execution proxy generated time"),
    causalQuoteCount,
    compatibleCount,
    rows: bandRows,
  };
}

async function validateOutcomes(value: unknown) {
  const artifact = object(value, "outcome artifact"), sha256Value = text(artifact.artifact_sha256, "outcome SHA-256");
  await verifyHash(artifact, sha256Value, "outcome artifact");
  const coverage = object(artifact.coverage, "outcome coverage"),
    window = object(
      artifact.date_window,
      "outcome window",
    );
  if (
    artifact.schema !== V43_OUTCOME_SCHEMA || artifact.evidence_class !== "adaptive_historical_holdout" ||
    artifact.research_only !== true || artifact.recommendation_authority !== false ||
    artifact.order_authority !== false || artifact.capital_risk_authority !== false ||
    artifact.trading_authority !== false || artifact.production_activation !== false || coverage.stations !== 20 ||
    coverage.market_dates !== 100 || coverage.station_dates !== 2_000 || coverage.complete !== true ||
    window.start !== "2026-01-07" || window.end !== "2026-04-16" || window.independent_market_dates !== 100 ||
    !Array.isArray(artifact.rows) || artifact.rows.length !== 2_000
  ) throw new Error("outcome artifact identity, authority, or coverage is invalid");
  const expectedDates = frozenDates(), expectedStations = new Set<string>(V43_STATION_IDS), seen = new Set<string>();
  const rows: OutcomeRow[] = artifact.rows.map((raw) => {
    const row = object(raw, "outcome row"),
      stationId = text(row.station_id, "outcome station"),
      marketDate = text(
        row.market_date,
        "outcome date",
      );
    const tmaxF = Number(row.tmax_f), key = `${marketDate}/${stationId}`;
    if (
      !expectedDates.has(marketDate) || !expectedStations.has(stationId) || !Number.isSafeInteger(tmaxF) ||
      seen.has(key)
    ) throw new Error("outcome row identity is invalid");
    seen.add(key);
    return { stationId, marketDate, tmaxF };
  });
  if (seen.size !== 2_000) throw new Error("outcome row coverage is incomplete");
  return { sha256: sha256Value, rows };
}

function holdoutDates() {
  return [...frozenDates()].filter((date) =>
    date >= V43_F066_PLUS_THREE_HOLDOUT_START && date <= V43_F066_PLUS_THREE_HOLDOUT_END
  ).sort();
}

function priceToUnits(value: string) {
  if (!PRICE.test(value)) throw new Error("NO ask proxy must be an exact four-decimal unit price");
  const units = Number(value[0]) * 10_000 + Number(value.slice(2));
  if (!Number.isSafeInteger(units) || units < 0 || units > 10_000) throw new Error("NO ask proxy is outside [0,1]");
  return units;
}

function formatUnits(value: number) {
  if (!Number.isSafeInteger(value)) throw new Error("monetary units must be an integer");
  return `${value < 0 ? "-" : ""}${(Math.abs(value) / 10_000).toFixed(4)}`;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

async function verifyHash(value: Row, expected: string, label: string) {
  if (!SHA256.test(expected)) throw new Error(`${label} SHA-256 is malformed`);
  const { artifact_sha256: _discard, ...unsigned } = value;
  if (await canonicalSha256(unsigned) !== expected) throw new Error(`${label} checksum does not reproduce`);
}

async function canonicalSha256(value: unknown) {
  return await sha256(new TextEncoder().encode(JSON.stringify(value)));
}

async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

async function main(raw: string[]) {
  const args = raw[0] === "--" ? raw.slice(1) : raw;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error("arguments are malformed");
    values.set(key, value);
  }
  if (values.size !== 3 || !values.get("--proxy") || !values.get("--outcomes") || !values.get("--output")) {
    throw new Error("economics evaluation requires proxy, outcomes, and output");
  }
  const [proxy, outcomes] = await Promise.all([
    Deno.readTextFile(childOfVarTmp(values.get("--proxy")!, "proxy input")).then(JSON.parse),
    Deno.readTextFile(childOfVarTmp(values.get("--outcomes")!, "outcome input")).then(JSON.parse),
  ]);
  const artifact = await evaluateV43F066PlusThreeEconomics({ proxy, outcomes });
  await writeV43F066PlusThreeEconomicsCreateOnce(values.get("--output")!, artifact);
  console.log(JSON.stringify({
    ok: true,
    schema: artifact.schema,
    artifact_sha256: artifact.artifact_sha256,
    promotion_ready: artifact.decision.promotion_ready,
    support_fraction: artifact.exact_edge_selection.support_fraction,
  }));
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    Deno.exit(1);
  }
}
