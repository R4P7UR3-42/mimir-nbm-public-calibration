import { frozenDates, V43_STATION_IDS } from "./v43-outcomes.ts";
import { V43_EVALUATION_SCHEMA, V43_HORIZON_SCHEMA } from "./v43-evaluate.ts";
import {
  V43_F066_PLUS_THREE_BUFFER_F,
  V43_F066_PLUS_THREE_DEVELOPMENT_END,
  V43_F066_PLUS_THREE_EVALUATION_SCHEMA,
  V43_F066_PLUS_THREE_HOLDOUT_END,
  V43_F066_PLUS_THREE_HOLDOUT_START,
  V43_F066_PLUS_THREE_IDENTITY,
} from "./v43-f066-plus-three-evaluate.ts";

export const V43_EXECUTION_PROXY_SCHEMA = "noaa_nbm_v43_q95_public_execution_proxy_v2";
export const V43_EXECUTION_PROXY_MAX_REQUESTS = 8_401;
export const V43_EXECUTION_PROXY_DECISION_TIME_UTC = "20:05:00.000Z";
export const V43_EXECUTION_PROXY_WINDOW_SECONDS = 300;
export const V43_F066_PLUS_THREE_WINDOW_START_UTC = "14:00:00.000Z";
export const V43_F066_PLUS_THREE_WINDOW_END_UTC = "18:00:00.000Z";
export const V43_EXECUTION_PROXY_MAX_SERIES_PAGES = 10;
export const V43_EXECUTION_PROXY_MAX_TRADE_PAGES = 3;
const BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";
const SHA256 = /^[a-f0-9]{64}$/;
const CURSOR = /^[A-Za-z0-9_-]+$/;

type Row = Record<string, unknown>;
type Horizon = "f042" | "f066";
type ProxyPolicy = "f042-floor-q95" | "f066-floor-q95-plus-three";
type RequestKind = "ordinary" | "candlestick";

interface FrozenStation {
  stationId: string;
  seriesTicker: string;
  climateProductId: string;
  nwsOffice: string;
}

export const V43_EXECUTION_PROXY_STATIONS: readonly FrozenStation[] = [
  { stationId: "KOKC", seriesTicker: "KXHIGHTOKC", climateProductId: "OKC", nwsOffice: "OUN" },
  { stationId: "KHOU", seriesTicker: "KXHIGHTHOU", climateProductId: "HOU", nwsOffice: "HGX" },
  { stationId: "KSAT", seriesTicker: "KXHIGHTSATX", climateProductId: "SAT", nwsOffice: "EWX" },
  { stationId: "KNYC", seriesTicker: "KXHIGHNY", climateProductId: "NYC", nwsOffice: "OKX" },
  { stationId: "KBOS", seriesTicker: "KXHIGHTBOS", climateProductId: "BOS", nwsOffice: "BOX" },
  { stationId: "KPHL", seriesTicker: "KXHIGHPHIL", climateProductId: "PHL", nwsOffice: "PHI" },
  { stationId: "KDCA", seriesTicker: "KXHIGHTDC", climateProductId: "DCA", nwsOffice: "LWX" },
  { stationId: "KMDW", seriesTicker: "KXHIGHCHI", climateProductId: "MDW", nwsOffice: "LOT" },
  { stationId: "KATL", seriesTicker: "KXHIGHTATL", climateProductId: "ATL", nwsOffice: "FFC" },
  { stationId: "KAUS", seriesTicker: "KXHIGHAUS", climateProductId: "AUS", nwsOffice: "EWX" },
  { stationId: "KMIA", seriesTicker: "KXHIGHMIA", climateProductId: "MIA", nwsOffice: "MFL" },
  { stationId: "KDFW", seriesTicker: "KXHIGHTDAL", climateProductId: "DFW", nwsOffice: "FWD" },
  { stationId: "KDEN", seriesTicker: "KXHIGHDEN", climateProductId: "DEN", nwsOffice: "BOU" },
  { stationId: "KLAX", seriesTicker: "KXHIGHLAX", climateProductId: "LAX", nwsOffice: "LOX" },
  { stationId: "KSFO", seriesTicker: "KXHIGHTSFO", climateProductId: "SFO", nwsOffice: "MTR" },
  { stationId: "KSEA", seriesTicker: "KXHIGHTSEA", climateProductId: "SEA", nwsOffice: "SEW" },
  { stationId: "KPHX", seriesTicker: "KXHIGHTPHX", climateProductId: "PHX", nwsOffice: "PSR" },
  { stationId: "KLAS", seriesTicker: "KXHIGHTLV", climateProductId: "LAS", nwsOffice: "VEF" },
  { stationId: "KMSP", seriesTicker: "KXHIGHTMIN", climateProductId: "MSP", nwsOffice: "MPX" },
  { stationId: "KMSY", seriesTicker: "KXHIGHTNOLA", climateProductId: "MSY", nwsOffice: "LIX" },
] as const;

interface SourceRow {
  stationId: string;
  marketDate: string;
  q95MaxF: number;
  thresholdF: number;
}

interface FrozenSelection {
  station: FrozenStation;
  marketDate: string;
  q95MaxF: number;
  thresholdF: number;
  eventTicker: string;
  condition: "greater";
  side: "no";
  decisionAt: Date;
  tradeWindowEnd: Date;
  policy: ProxyPolicy;
}

interface RequestCapture {
  request_number: number;
  kind: RequestKind;
  path: string;
  response_sha256: string;
}

export class BoundedPublicKalshiClient {
  readonly captures: RequestCapture[] = [];
  private lastRequestStartedAt: number | null = null;
  private lastCandlestickStartedAt: number | null = null;

  constructor(
    readonly maxRequests: number,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly nowMs: () => number = () => performance.now(),
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    if (maxRequests !== V43_EXECUTION_PROXY_MAX_REQUESTS) {
      throw new Error(`public execution proxy requires max_requests=${V43_EXECUTION_PROXY_MAX_REQUESTS}`);
    }
  }

  get requestCount() {
    return this.captures.length;
  }

  async request(path: string, params: Record<string, string> = {}, kind: RequestKind = "ordinary") {
    if (!path.startsWith("/") || path.includes("..")) throw new Error("public request path is unsafe");
    if (this.requestCount >= this.maxRequests) throw new Error("public execution proxy request budget exhausted");
    const now = this.nowMs();
    const ordinaryWait = this.lastRequestStartedAt === null ? 0 : this.lastRequestStartedAt + 1_000 - now;
    const candleWait = kind === "candlestick" && this.lastCandlestickStartedAt !== null
      ? this.lastCandlestickStartedAt + 1_000 - now
      : 0;
    const wait = Math.max(0, ordinaryWait, candleWait);
    if (wait > 0) await this.sleep(wait);
    const startedAt = this.nowMs();
    this.lastRequestStartedAt = startedAt;
    if (kind === "candlestick") this.lastCandlestickStartedAt = startedAt;

    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const attemptedRequestNumber = this.requestCount + 1;
    const attemptedPath = `${url.pathname}${url.search}`;
    const response = await this.fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
    const attempt = `attempted_request=${attemptedRequestNumber} path=${attemptedPath}`;
    if (response.status === 429) throw new Error(`Kalshi HTTP 429 is terminal; ${attempt}`);
    if (!response.ok) throw new Error(`Kalshi HTTP ${response.status}; ${attempt}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error(`Kalshi JSON is malformed; ${attempt}`);
    }
    const value = object(payload, `Kalshi response ${path}`);
    this.captures.push({
      request_number: this.requestCount + 1,
      kind,
      path: `${url.pathname}${url.search}`,
      response_sha256: await sha256(bytes),
    });
    return { payload: value, responseSha256: this.captures.at(-1)!.response_sha256 };
  }
}

export async function exportV43ExecutionProxy(input: {
  source: unknown;
  evaluation: unknown;
  client: BoundedPublicKalshiClient;
  generatedAt?: Date;
}) {
  const source = await validateSourceAndEvaluation(input.source, input.evaluation);
  const frozenSelections = freezeSelections(source.rows, source.policy);
  const expectedEventsBySeries = groupExpectedEvents(frozenSelections);
  const marketPages: Row[] = [], eventPages: Row[] = [];
  const markets: Row[] = [], events: Row[] = [];

  const cutoff = await input.client.request("/historical/cutoff");
  validateCutoff(cutoff.payload);
  for (const station of V43_EXECUTION_PROXY_STATIONS) {
    const discoveredMarkets = await discoverPages({
      client: input.client,
      path: "/historical/markets",
      collection: "markets",
      params: { series_ticker: station.seriesTicker, limit: "1000" },
      seriesTicker: station.seriesTicker,
      pageCaptures: marketPages,
    });
    markets.push(...discoveredMarkets);
    const discoveredEvents = await discoverPages({
      client: input.client,
      path: "/events",
      collection: "events",
      params: {
        series_ticker: station.seriesTicker,
        status: "settled",
        limit: "200",
        with_nested_markets: "false",
      },
      seriesTicker: station.seriesTicker,
      pageCaptures: eventPages,
      expectedIdentities: expectedEventsBySeries.get(station.seriesTicker),
    });
    events.push(...discoveredEvents);
  }

  const selected = await attachProviderIdentities(frozenSelections, markets, events);
  const rows: Row[] = [];
  for (const selection of selected) {
    if (!selection.contract || !selection.settlement || !selection.marketAvailableForWindow) {
      rows.push(rowWithoutNetworkEvidence(selection));
      continue;
    }
    const quote = await fetchQuoteProxy(
      input.client,
      selection.contract.ticker,
      selection.frozen.decisionAt,
      selection.frozen.tradeWindowEnd,
      selection.frozen.policy,
    );
    const trades = await fetchPublicTrades(
      input.client,
      selection.contract.ticker,
      selection.frozen.decisionAt,
      selection.frozen.tradeWindowEnd,
    );
    const compatibleTrades = quote.no_ask_proxy === null
      ? []
      : trades.trades.filter((trade) =>
        Number(trade.no_price_dollars) <= Number(quote.no_ask_proxy) && Number(trade.count_fp) >= 1
      );
    const frozenPriceBandProxy = source.policy === "f066-floor-q95-plus-three" && quote.supported &&
      Number(quote.no_ask_proxy) >= 0.70 && Number(quote.no_ask_proxy) <= 0.97;
    rows.push({
      ...baseRow(selection),
      quote_proxy: quote,
      public_trades: trades,
      support: {
        exact_contract_selected: true,
        exact_settlement_bound: true,
        causal_quote_proxy: quote.supported,
        displayed_depth_verified: false,
        exact_prospective_selection_reconstructed: false,
        frozen_price_band_proxy: frozenPriceBandProxy,
        compatible_public_trade: compatibleTrades.length > 0,
        compatible_public_trade_count: compatibleTrades.length,
        provider_confirmed_fill: false,
      },
    });
  }

  const generatedAt = input.generatedAt ?? new Date();
  if (Number.isNaN(generatedAt.getTime())) throw new Error("execution proxy generation clock is malformed");
  const metric = (name: string) => rows.filter((row) => object(row.support, "row support")[name] === true).length;
  const unsigned = {
    schema: V43_EXECUTION_PROXY_SCHEMA,
    generated_at: generatedAt.toISOString(),
    evidence_class: "historical_public_execution_proxy",
    research_only: true,
    independent_oos: false,
    profitability_claim: false,
    executable_depth_evidence: false,
    provider_confirmed_fill_evidence: false,
    recommendation_authority: false,
    order_authority: false,
    capital_risk_authority: false,
    trading_authority: false,
    production_activation: false,
    credential_required: false,
    production_database_access: false,
    horizon: source.horizon,
    supported_horizon: source.horizon,
    supported_policy_identity: source.policy === "f042-floor-q95"
      ? "noaa_nbm_v43_f042_q95_floor_public_execution_proxy_v1"
      : V43_F066_PLUS_THREE_IDENTITY,
    calibration_preflight: {
      complete_100_dates: source.policy === "f042-floor-q95",
      complete_exact_50_holdout_dates: source.policy === "f066-floor-q95-plus-three",
      nonnegative_clustered_90_margin: true,
      passed_before_network: true,
    },
    source_artifact_sha256: source.sourceSha256,
    evaluation_artifact_sha256: source.evaluationSha256,
    frozen_policy: {
      market_dates: source.policy === "f042-floor-q95"
        ? { start: "2026-01-07", end: "2026-04-16", independent_dates: 100 }
        : { start: V43_F066_PLUS_THREE_HOLDOUT_START, end: V43_F066_PLUS_THREE_HOLDOUT_END, independent_dates: 50 },
      stations: 20,
      station_dates: source.rows.length,
      selection_before_quote_outcomes: true,
      condition: "greater",
      side: "no",
      threshold: source.policy === "f042-floor-q95" ? "floor(native_q95_f)" : "floor(native_q95_f)+3F",
      decision_time: source.policy === "f042-floor-q95"
        ? `prior_market_date_${V43_EXECUTION_PROXY_DECISION_TIME_UTC}`
        : `prior_market_date_[${V43_F066_PLUS_THREE_WINDOW_START_UTC},${V43_F066_PLUS_THREE_WINDOW_END_UTC})`,
      quote_period_minutes: 1,
      quote_lookback_seconds: source.policy === "f042-floor-q95" ? V43_EXECUTION_PROXY_WINDOW_SECONDS : null,
      public_trade_window_seconds: source.policy === "f042-floor-q95"
        ? V43_EXECUTION_PROXY_WINDOW_SECONDS
        : 4 * 60 * 60,
      no_ask_derivation: source.policy === "f042-floor-q95"
        ? "1.0000 - latest_complete_yes_bid_close"
        : "1.0000 - first_in_window_complete_yes_bid_close",
      no_ask_evidence_class: "one_minute_top_of_book_proxy_without_depth",
      displayed_depth_required_for_f066_prospective_rule: source.policy === "f066-floor-q95-plus-three",
      first_depth_qualified_quote_reconstructed: false,
    },
    request_policy: {
      maximum_requests: V43_EXECUTION_PROXY_MAX_REQUESTS,
      actual_requests: input.client.requestCount,
      maximum_reads_per_second: 1,
      maximum_candlestick_reads_per_second: 1,
      maximum_series_pages: V43_EXECUTION_PROXY_MAX_SERIES_PAGES,
      maximum_trade_pages_per_ticker: V43_EXECUTION_PROXY_MAX_TRADE_PAGES,
      no_retry: true,
      terminal_http_429: true,
      cursor_loop_defense: true,
    },
    historical_cutoff: cutoff.payload,
    historical_cutoff_response_sha256: cutoff.responseSha256,
    discovery: { market_pages: marketPages, event_pages: eventPages },
    metrics: {
      station_dates: rows.length,
      exact_contracts_selected: metric("exact_contract_selected"),
      exact_settlements_bound: metric("exact_settlement_bound"),
      causal_quote_proxies: metric("causal_quote_proxy"),
      compatible_public_trade_proxies: metric("compatible_public_trade"),
      frozen_price_band_quote_proxies: metric("frozen_price_band_proxy"),
      exact_prospective_selections_reconstructed: metric("exact_prospective_selection_reconstructed"),
      provider_confirmed_fills: 0,
    },
    evidence_boundaries: {
      candle_is_fill_evidence: false,
      public_trade_is_member_fill_evidence: false,
      public_trade_exposes_taker_side_and_price: true,
      public_trade_exposes_resting_depth_identity: false,
      historical_depth_available: false,
      exact_f066_first_depth_qualified_selection_available: false,
      f066_price_band_proxy_is_exact_net_ev: false,
    },
    rows,
  };
  return { artifact_sha256: await canonicalSha256(unsigned), ...unsigned };
}

export async function writeExecutionProxyCreateOnce(path: string, artifact: unknown) {
  const output = childOfVarTmp(path, "execution proxy output");
  if (!output.endsWith(".json")) throw new Error("execution proxy output must be JSON");
  const value = object(artifact, "execution proxy artifact");
  const expected = text(value.artifact_sha256, "execution proxy artifact SHA-256");
  await verifyArtifactHash(value, expected, "execution proxy artifact");
  if (
    value.schema !== V43_EXECUTION_PROXY_SCHEMA || value.research_only !== true ||
    value.executable_depth_evidence !== false || value.provider_confirmed_fill_evidence !== false ||
    value.recommendation_authority !== false || value.order_authority !== false ||
    value.capital_risk_authority !== false || value.trading_authority !== false ||
    value.production_activation !== false || value.production_database_access !== false
  ) throw new Error("execution proxy artifact authority is invalid");
  const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  await Deno.writeFile(output, bytes, { createNew: true });
  return await sha256(bytes);
}

export function freezeSelections(rows: SourceRow[], policy: ProxyPolicy = "f042-floor-q95"): FrozenSelection[] {
  const stationById = new Map(V43_EXECUTION_PROXY_STATIONS.map((station) => [station.stationId, station]));
  return rows.map((row) => {
    const station = stationById.get(row.stationId);
    if (!station) throw new Error(`station ${row.stationId} has no exact Kalshi series identity`);
    const priorDate = shiftDate(row.marketDate, -1);
    const decisionAt = new Date(
      `${priorDate}T${
        policy === "f042-floor-q95" ? V43_EXECUTION_PROXY_DECISION_TIME_UTC : V43_F066_PLUS_THREE_WINDOW_START_UTC
      }`,
    );
    const tradeWindowEnd = policy === "f042-floor-q95"
      ? new Date(decisionAt.getTime() + V43_EXECUTION_PROXY_WINDOW_SECONDS * 1_000)
      : new Date(`${priorDate}T${V43_F066_PLUS_THREE_WINDOW_END_UTC}`);
    return {
      station,
      marketDate: row.marketDate,
      q95MaxF: row.q95MaxF,
      thresholdF: row.thresholdF,
      eventTicker: `${station.seriesTicker}-${kalshiDate(row.marketDate)}`,
      condition: "greater",
      side: "no",
      decisionAt,
      tradeWindowEnd,
      policy,
    };
  });
}

async function discoverPages(options: {
  client: BoundedPublicKalshiClient;
  path: string;
  collection: "markets" | "events";
  params: Record<string, string>;
  seriesTicker: string;
  pageCaptures: Row[];
  expectedIdentities?: Set<string>;
}) {
  const rows: Row[] = [], seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 1; page <= V43_EXECUTION_PROXY_MAX_SERIES_PAGES; page++) {
    const response = await options.client.request(options.path, {
      ...options.params,
      ...(cursor ? { cursor } : {}),
    });
    const pageRows = array(response.payload[options.collection], `${options.collection} page`).map((row) =>
      object(row, `${options.collection} row`)
    );
    rows.push(...pageRows);
    options.pageCaptures.push({
      series_ticker: options.seriesTicker,
      page,
      rows: pageRows.length,
      response_sha256: response.responseSha256,
    });
    const responseCursor = parseCursor(response.payload.cursor);
    if (responseCursor && seenCursors.has(responseCursor)) {
      throw new Error(`${options.collection} pagination repeated a cursor for ${options.seriesTicker}`);
    }
    if (responseCursor) seenCursors.add(responseCursor);
    cursor = responseCursor;
    if (!cursor) return rows;
    if (options.expectedIdentities) {
      const found = new Set(rows.map((row) => String(row.event_ticker ?? "")));
      if ([...options.expectedIdentities].every((identity) => found.has(identity))) return rows;
    }
  }
  if (cursor) throw new Error(`${options.collection} pagination exceeded its page cap for ${options.seriesTicker}`);
  return rows;
}

async function attachProviderIdentities(selections: FrozenSelection[], markets: Row[], events: Row[]) {
  const marketsByKey = new Map<string, Row[]>();
  for (const market of markets) {
    const key = `${String(market.event_ticker ?? "")}/${String(market.strike_type ?? "")}/${
      String(market.floor_strike ?? "")
    }`;
    const values = marketsByKey.get(key) ?? [];
    values.push(market);
    marketsByKey.set(key, values);
  }
  const eventsByTicker = new Map<string, Row[]>();
  for (const event of events) {
    const ticker = String(event.event_ticker ?? "");
    const values = eventsByTicker.get(ticker) ?? [];
    values.push(event);
    eventsByTicker.set(ticker, values);
  }
  const results = [];
  for (const frozen of selections) {
    const candidates = marketsByKey.get(`${frozen.eventTicker}/greater/${frozen.thresholdF}`) ?? [];
    if (candidates.length > 1) {
      throw new Error(`duplicate exact contract for ${frozen.eventTicker}/${frozen.thresholdF}`);
    }
    const eventCandidates = eventsByTicker.get(frozen.eventTicker) ?? [];
    if (eventCandidates.length > 1) throw new Error(`duplicate exact event ${frozen.eventTicker}`);
    const contract = candidates.length === 1 ? await exactContract(candidates[0], frozen) : null;
    const settlement = eventCandidates.length === 1 ? await exactSettlement(eventCandidates[0], frozen) : null;
    const marketAvailableForWindow = contract !== null &&
      (frozen.policy === "f042-floor-q95"
        ? new Date(contract.open_time).getTime() <= frozen.decisionAt.getTime() &&
          frozen.decisionAt.getTime() < new Date(contract.close_time).getTime()
        : new Date(contract.open_time).getTime() < frozen.tradeWindowEnd.getTime() &&
          frozen.decisionAt.getTime() < new Date(contract.close_time).getTime());
    results.push({ frozen, contract, settlement, marketAvailableForWindow });
  }
  return results;
}

async function exactContract(market: Row, frozen: FrozenSelection) {
  const ticker = text(market.ticker, "market ticker");
  const openTime = timestamp(market.open_time, `${ticker} open time`);
  const closeTime = timestamp(market.close_time, `${ticker} close time`);
  const settledAt = timestamp(market.settlement_ts, `${ticker} settlement time`);
  if (
    market.event_ticker !== frozen.eventTicker || market.strike_type !== "greater" ||
    Number(market.floor_strike) !== frozen.thresholdF || market.market_type !== "binary" ||
    market.status !== "finalized" || (market.result !== "yes" && market.result !== "no") ||
    !ticker.startsWith(`${frozen.eventTicker}-T`) || settledAt.getTime() <= closeTime.getTime()
  ) throw new Error(`exact contract identity failed for ${frozen.eventTicker}/${frozen.thresholdF}`);
  return {
    ticker,
    event_ticker: frozen.eventTicker,
    strike_type: "greater",
    floor_strike: frozen.thresholdF,
    open_time: openTime.toISOString(),
    close_time: closeTime.toISOString(),
    settlement_time: settledAt.toISOString(),
    result: market.result,
    expiration_value: String(market.expiration_value ?? ""),
    raw_market_sha256: await canonicalSha256(market),
  };
}

async function exactSettlement(event: Row, frozen: FrozenSelection) {
  if (event.event_ticker !== frozen.eventTicker || event.series_ticker !== frozen.station.seriesTicker) {
    return null;
  }
  if (!Array.isArray(event.settlement_sources) || event.settlement_sources.length !== 1) return null;
  const sourceValue = event.settlement_sources[0];
  if (!sourceValue || typeof sourceValue !== "object" || Array.isArray(sourceValue)) return null;
  const source = sourceValue as Row;
  if (typeof source.name !== "string" || !source.name || typeof source.url !== "string" || !source.url) return null;
  const name = source.name, urlText = source.url;
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" || url.hostname !== "forecast.weather.gov" ||
    url.searchParams.get("product")?.toUpperCase() !== "CLI" ||
    url.searchParams.get("issuedby")?.toUpperCase() !== frozen.station.climateProductId ||
    url.searchParams.get("site")?.toUpperCase() !== frozen.station.nwsOffice
  ) return null;
  return {
    source_name: name,
    source_url: urlText,
    nws_office: frozen.station.nwsOffice,
    product: "CLI",
    issuedby: frozen.station.climateProductId,
    station_id: frozen.station.stationId,
    raw_event_sha256: await canonicalSha256(event),
  };
}

async function fetchQuoteProxy(
  client: BoundedPublicKalshiClient,
  ticker: string,
  decisionAt: Date,
  windowEnd: Date,
  policy: ProxyPolicy,
) {
  const decisionSeconds = Math.floor(decisionAt.getTime() / 1_000);
  const windowEndSeconds = Math.floor(windowEnd.getTime() / 1_000);
  const startSeconds = policy === "f042-floor-q95"
    ? decisionSeconds - V43_EXECUTION_PROXY_WINDOW_SECONDS
    : decisionSeconds + 1;
  const endSeconds = policy === "f042-floor-q95" ? decisionSeconds : windowEndSeconds - 1;
  const response = await client.request(
    `/historical/markets/${encodeURIComponent(ticker)}/candlesticks`,
    {
      start_ts: String(startSeconds),
      end_ts: String(endSeconds),
      period_interval: "1",
    },
    "candlestick",
  );
  if (response.payload.ticker !== ticker) throw new Error(`candlestick ticker mismatch for ${ticker}`);
  const seen = new Set<number>();
  const candles = array(response.payload.candlesticks, `${ticker} candlesticks`).map((raw) => {
    const candle = object(raw, `${ticker} candle`), end = Number(candle.end_period_ts);
    if (
      !Number.isSafeInteger(end) || end < startSeconds || end > endSeconds ||
      (policy === "f066-floor-q95-plus-three" && (end <= decisionSeconds || end >= windowEndSeconds)) || seen.has(end)
    ) {
      throw new Error(`candlestick timestamp is invalid for ${ticker}`);
    }
    seen.add(end);
    return candle;
  }).sort((left, right) => Number(left.end_period_ts) - Number(right.end_period_ts));
  const selected = policy === "f042-floor-q95" ? candles.at(-1) ?? null : candles.find((candle) => {
    const value = decimalField(object(candle.yes_bid, `${ticker} YES bid`), "close");
    return value !== null;
  }) ?? null;
  const age = selected
    ? policy === "f042-floor-q95"
      ? decisionSeconds - Number(selected.end_period_ts)
      : Number(selected.end_period_ts) - decisionSeconds
    : null;
  const yesBid = selected ? decimalField(object(selected.yes_bid, `${ticker} YES bid`), "close") : null;
  const yesAsk = selected ? decimalField(object(selected.yes_ask, `${ticker} YES ask`), "close") : null;
  const noAsk = yesBid === null ? null : complement(yesBid);
  return {
    evidence_class: "one_minute_top_of_book_proxy_without_depth",
    period_semantics: "OHLC for the one-minute period ending at end_period_ts",
    selection_semantics: policy === "f042-floor-q95"
      ? "latest_complete_candle_at_or_before_fixed_decision"
      : "first_complete_candle_with_yes_bid_close_strictly_inside_frozen_window",
    selected_at_or_before_decision: policy === "f042-floor-q95",
    selected_strictly_inside_window: policy === "f066-floor-q95-plus-three",
    supported: selected !== null && age !== null &&
      (policy === "f042-floor-q95" ? age <= V43_EXECUTION_PROXY_WINDOW_SECONDS : age < 4 * 60 * 60) && noAsk !== null,
    decision_at: decisionAt.toISOString(),
    candle_end_at: selected ? new Date(Number(selected.end_period_ts) * 1_000).toISOString() : null,
    age_seconds: policy === "f042-floor-q95" ? age : null,
    seconds_after_window_start: policy === "f066-floor-q95-plus-three" ? age : null,
    yes_bid_close: yesBid,
    yes_ask_close: yesAsk,
    no_ask_proxy: noAsk,
    displayed_depth: null,
    volume: selected ? nonnegativeDecimalField(selected, "volume") : null,
    open_interest: selected ? nonnegativeDecimalField(selected, "open_interest") : null,
    response_sha256: response.responseSha256,
  };
}

async function fetchPublicTrades(
  client: BoundedPublicKalshiClient,
  ticker: string,
  start: Date,
  end: Date,
) {
  const trades: Row[] = [], pageHashes: string[] = [], seenCursors = new Set<string>(), seenTrades = new Set<string>();
  let cursor: string | null = null;
  for (let page = 1; page <= V43_EXECUTION_PROXY_MAX_TRADE_PAGES; page++) {
    const response = await client.request("/historical/trades", {
      ticker,
      min_ts: String(Math.floor(start.getTime() / 1_000) - 1),
      max_ts: String(Math.floor(end.getTime() / 1_000)),
      limit: "1000",
      ...(cursor ? { cursor } : {}),
    });
    pageHashes.push(response.responseSha256);
    for (const raw of array(response.payload.trades, `${ticker} trades`)) {
      const trade = object(raw, `${ticker} trade`), tradeId = text(trade.trade_id, "trade ID");
      const created = timestamp(trade.created_time, `${tradeId} created time`);
      if (trade.ticker !== ticker || seenTrades.has(tradeId)) throw new Error(`trade identity failed for ${ticker}`);
      seenTrades.add(tradeId);
      if (created < start || created >= end) continue;
      const count = positiveDecimal(trade.count_fp, `${tradeId} count`);
      const yesPrice = unitDecimal(trade.yes_price_dollars, `${tradeId} YES price`);
      const noPrice = unitDecimal(trade.no_price_dollars, `${tradeId} NO price`);
      if (Math.abs(Number(yesPrice) + Number(noPrice) - 1) > 0.000_001) {
        throw new Error(`trade prices do not complement for ${tradeId}`);
      }
      const takerSide = text(trade.taker_side, `${tradeId} taker side`);
      if (takerSide !== "yes" && takerSide !== "no") throw new Error(`trade taker side is invalid for ${tradeId}`);
      trades.push({
        trade_id: tradeId,
        created_time: created.toISOString(),
        count_fp: count,
        yes_price_dollars: yesPrice,
        no_price_dollars: noPrice,
        taker_side: takerSide,
        raw_trade_sha256: await canonicalSha256(trade),
      });
    }
    const responseCursor = parseCursor(response.payload.cursor);
    if (responseCursor && seenCursors.has(responseCursor)) {
      throw new Error(`trade pagination repeated a cursor for ${ticker}`);
    }
    if (responseCursor) seenCursors.add(responseCursor);
    cursor = responseCursor;
    if (!cursor) break;
    if (page === V43_EXECUTION_PROXY_MAX_TRADE_PAGES) {
      throw new Error(`trade pagination exceeded its page cap for ${ticker}`);
    }
  }
  trades.sort((left, right) =>
    String(left.created_time).localeCompare(String(right.created_time)) ||
    String(left.trade_id).localeCompare(String(right.trade_id))
  );
  return {
    evidence_class: "public_exchange_trade_proxy_not_member_fill",
    window_start: start.toISOString(),
    window_end_exclusive: end.toISOString(),
    trades,
    pages: pageHashes.length,
    response_sha256_by_page: pageHashes,
    exposes_taker_side_and_price: true,
    exposes_resting_depth_identity: false,
    provider_confirmed_member_fill: false,
  };
}

function rowWithoutNetworkEvidence(selection: Awaited<ReturnType<typeof attachProviderIdentities>>[number]) {
  const blockers = [
    ...(!selection.contract ? ["EXACT_GREATER_CONTRACT_MISSING"] : []),
    ...(!selection.settlement ? ["EXACT_NWS_SETTLEMENT_IDENTITY_MISSING"] : []),
    ...(selection.contract && !selection.marketAvailableForWindow ? ["MARKET_UNAVAILABLE_DURING_FROZEN_WINDOW"] : []),
  ];
  return {
    ...baseRow(selection),
    blockers,
    quote_proxy: null,
    public_trades: null,
    support: {
      exact_contract_selected: selection.contract !== null,
      exact_settlement_bound: selection.settlement !== null,
      causal_quote_proxy: false,
      displayed_depth_verified: false,
      exact_prospective_selection_reconstructed: false,
      frozen_price_band_proxy: false,
      compatible_public_trade: false,
      compatible_public_trade_count: 0,
      provider_confirmed_fill: false,
    },
  };
}

function baseRow(selection: Awaited<ReturnType<typeof attachProviderIdentities>>[number]) {
  return {
    station_id: selection.frozen.station.stationId,
    series_ticker: selection.frozen.station.seriesTicker,
    market_date: selection.frozen.marketDate,
    q95_max_f: selection.frozen.q95MaxF,
    threshold_f: selection.frozen.thresholdF,
    condition: selection.frozen.condition,
    side: selection.frozen.side,
    expected_event_ticker: selection.frozen.eventTicker,
    decision_at: selection.frozen.decisionAt.toISOString(),
    trade_window_end_exclusive: selection.frozen.tradeWindowEnd.toISOString(),
    contract: selection.contract,
    settlement: selection.settlement,
    market_available_for_frozen_window: selection.marketAvailableForWindow,
  };
}

async function validateSourceAndEvaluation(sourceValue: unknown, evaluationValue: unknown) {
  const source = object(sourceValue, "v4.3 source artifact");
  const evaluation = object(evaluationValue, "v4.3 evaluation artifact");
  const sourceSha256 = text(source.artifact_sha256, "source SHA-256");
  const evaluationSha256 = text(evaluation.artifact_sha256, "evaluation SHA-256");
  await verifyArtifactHash(source, sourceSha256, "source artifact");
  await verifyArtifactHash(evaluation, evaluationSha256, "evaluation artifact");
  const horizon = source.horizon;
  if (horizon !== "f042" && horizon !== "f066") throw new Error("source horizon is invalid");
  const expectedProduct = horizon === "f042"
    ? "noaa_nbm_v43_blend_qmd_12z_f042_native_max_t_q95_historical_calibration_v1"
    : "noaa_nbm_v43_blend_qmd_12z_f066_native_max_t_q95_historical_calibration_v1";
  const coverage = object(source.coverage, "source coverage"), dateWindow = object(source.date_window, "source window");
  if (
    source.schema !== V43_HORIZON_SCHEMA || source.source_profile !== `v43-${horizon}` ||
    source.source_product !== expectedProduct ||
    source.evidence_class !== "adaptive_historical_holdout" || source.research_only !== true ||
    source.trading_authority !== false || coverage.stations !== 20 || coverage.market_dates !== 100 ||
    coverage.station_dates !== 2_000 || coverage.complete !== true || dateWindow.start !== "2026-01-07" ||
    dateWindow.end !== "2026-04-16" || dateWindow.independent_market_dates !== 100 ||
    !Array.isArray(source.rows) || source.rows.length !== 2_000
  ) throw new Error("v4.3 source identity or coverage is invalid");

  const policy: ProxyPolicy = horizon === "f042" ? "f042-floor-q95" : "f066-floor-q95-plus-three";
  if (policy === "f042-floor-q95") {
    const evaluationWindow = object(evaluation.date_window, "evaluation window");
    const linked = object(evaluation.horizon_artifact_sha256, "evaluation horizon hashes");
    const horizonEvaluations = array(evaluation.evaluations, "evaluation horizons")
      .map((value) => object(value, "horizon evaluation"))
      .filter((value) => value.horizon === horizon);
    if (
      evaluation.schema !== V43_EVALUATION_SCHEMA || evaluation.research_only !== true ||
      evaluation.trading_authority !== false || evaluationWindow.start !== "2026-01-07" ||
      evaluationWindow.end !== "2026-04-16" || linked[horizon] !== sourceSha256 || horizonEvaluations.length !== 1
    ) throw new Error("v4.3 source/evaluation identity or linkage is invalid");
    const selectedEvaluation = horizonEvaluations[0], gates = object(selectedEvaluation.gates, "horizon gates");
    if (
      selectedEvaluation.artifact_sha256 !== sourceSha256 || selectedEvaluation.rows !== 2_000 ||
      selectedEvaluation.independent_market_dates !== 100 || gates.complete_100_dates !== true ||
      gates.nonnegative_clustered_90_margin !== true
    ) {
      throw new Error(
        "v4.3 calibration preflight failed: complete 100 dates and nonnegative clustered 90 margin are required",
      );
    }
  } else {
    validateF066PlusThreeEvaluation(evaluation, sourceSha256);
  }

  const dates = frozenDates(), expectedStations = new Set<string>(V43_STATION_IDS), seen = new Set<string>();
  const rows: SourceRow[] = source.rows.map((raw) => {
    const row = object(raw, "source row"), stationId = text(row.station_id, "source station");
    const marketDate = text(row.market_date, "source market date"), q95MaxF = Number(row.q95_max_f);
    const key = `${stationId}/${marketDate}`;
    if (
      !expectedStations.has(stationId) || !dates.has(marketDate) || !Number.isFinite(q95MaxF) ||
      q95MaxF < -100 || q95MaxF > 150 || row.source_profile !== `v43-${horizon}` ||
      row.source_product !== expectedProduct ||
      row.source_run_date !== shiftDate(marketDate, horizon === "f042" ? -1 : -2) ||
      !SHA256.test(String(row.message_sha256 ?? "")) || seen.has(key)
    ) throw new Error("source row identity is invalid");
    seen.add(key);
    return {
      stationId,
      marketDate,
      q95MaxF,
      thresholdF: Math.floor(q95MaxF) + (policy === "f066-floor-q95-plus-three" ? V43_F066_PLUS_THREE_BUFFER_F : 0),
    };
  });
  if (seen.size !== 2_000) throw new Error("source station/date coverage is incomplete");
  const selectedRows = policy === "f066-floor-q95-plus-three"
    ? rows.filter((row) =>
      row.marketDate >= V43_F066_PLUS_THREE_HOLDOUT_START && row.marketDate <= V43_F066_PLUS_THREE_HOLDOUT_END
    )
    : rows;
  if (
    policy === "f066-floor-q95-plus-three" &&
    (selectedRows.length !== 1_000 || new Set(selectedRows.map((row) => row.marketDate)).size !== 50 ||
      selectedRows.some((row) => row.marketDate <= V43_F066_PLUS_THREE_DEVELOPMENT_END))
  ) throw new Error("f066 plus-three execution proxy requires the exact untouched 50-date holdout");
  return { horizon: horizon as Horizon, policy, sourceSha256, evaluationSha256, rows: selectedRows };
}

function validateF066PlusThreeEvaluation(evaluation: Row, sourceSha256: string) {
  const holdout = object(evaluation.holdout_window, "f066 plus-three holdout window");
  const development = object(evaluation.development_window, "f066 plus-three development window");
  const threshold = object(evaluation.threshold_policy, "f066 plus-three threshold policy");
  const gates = object(evaluation.gates, "f066 plus-three gates");
  const requiredGates = [
    "complete_exact_50_dates",
    "nonnegative_clustered_90_margin",
    "nonnegative_clustered_95_margin",
    "maximum_station_share_at_most_0_05",
    "maximum_date_share_at_most_0_02",
    "all_station_leave_one_out_90_nonnegative",
    "all_station_leave_one_out_95_nonnegative",
  ];
  if (
    evaluation.schema !== V43_F066_PLUS_THREE_EVALUATION_SCHEMA ||
    evaluation.identity !== V43_F066_PLUS_THREE_IDENTITY || evaluation.source_artifact_sha256 !== sourceSha256 ||
    evaluation.evidence_class !== "adaptive_historical_holdout" || evaluation.adaptive_selection !== true ||
    evaluation.independent_oos !== false || evaluation.profitability_claim !== false ||
    evaluation.execution_evidence !== false || evaluation.provider_confirmed_fill_evidence !== false ||
    evaluation.research_only !== true || evaluation.recommendation_authority !== false ||
    evaluation.order_authority !== false || evaluation.capital_risk_authority !== false ||
    evaluation.trading_authority !== false || evaluation.production_activation !== false ||
    threshold.arithmetic !== "official_integer_tmax_f <= floor(native_f066_q95_f) + 3" ||
    threshold.buffer_f !== V43_F066_PLUS_THREE_BUFFER_F || threshold.fixed_probability !== 0.95 ||
    threshold.adjacent_plus_2_identity_accepted !== false ||
    development.start !== "2026-01-07" || development.end !== V43_F066_PLUS_THREE_DEVELOPMENT_END ||
    development.holdout_rows_credited !== 0 || development.holdout_market_dates_credited !== 0 ||
    holdout.start !== V43_F066_PLUS_THREE_HOLDOUT_START || holdout.end !== V43_F066_PLUS_THREE_HOLDOUT_END ||
    holdout.station_dates !== 1_000 || holdout.independent_market_dates !== 50 || holdout.stations !== 20
  ) throw new Error("f066 plus-three evaluation identity, linkage, or authority is invalid");
  if (requiredGates.some((gate) => gates[gate] !== true)) {
    throw new Error("f066 plus-three calibration preflight requires every frozen 50-date holdout gate");
  }
}

function validateCutoff(payload: Row) {
  const requiredAfter = new Date("2026-04-18T00:00:00.000Z");
  for (const field of ["market_settled_ts", "trades_created_ts"] as const) {
    if (timestamp(payload[field], `historical cutoff ${field}`) <= requiredAfter) {
      throw new Error(`historical cutoff does not cover the frozen window: ${field}`);
    }
  }
}

function groupExpectedEvents(selections: FrozenSelection[]) {
  const grouped = new Map<string, Set<string>>();
  for (const selection of selections) {
    const values = grouped.get(selection.station.seriesTicker) ?? new Set<string>();
    values.add(selection.eventTicker);
    grouped.set(selection.station.seriesTicker, values);
  }
  return grouped;
}

function decimalField(value: Row, name: string) {
  const raw = value[`${name}_dollars`] ?? value[`${name}_fp`] ?? value[name];
  if (raw === null || raw === undefined || raw === "") return null;
  return unitDecimal(raw, name);
}

function nonnegativeDecimalField(value: Row, name: string) {
  const raw = value[`${name}_fp`] ?? value[name];
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} is not nonnegative`);
  return String(raw);
}

function unitDecimal(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`${label} is not a unit price`);
  return parsed.toFixed(4);
}

function positiveDecimal(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} is not positive`);
  return String(value);
}

function complement(value: string) {
  return (1 - Number(value)).toFixed(4);
}

function parseCursor(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !CURSOR.test(value)) throw new Error("pagination cursor is malformed");
  return value;
}

function kalshiDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][
    date.getUTCMonth()
  ];
  return `${String(date.getUTCFullYear()).slice(-2)}${month}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function timestamp(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is malformed`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is malformed`);
  return date;
}

function object(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value as Row;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value;
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

async function verifyArtifactHash(value: Row, expected: string, label: string) {
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

async function main(raw: string[]) {
  const args = parseArgs(raw);
  const [source, evaluation] = await Promise.all([
    Deno.readTextFile(childOfVarTmp(args.source, "source input")).then(JSON.parse),
    Deno.readTextFile(childOfVarTmp(args.evaluation, "evaluation input")).then(JSON.parse),
  ]);
  const client = new BoundedPublicKalshiClient(args.maxRequests);
  const artifact = await exportV43ExecutionProxy({ source, evaluation, client });
  await writeExecutionProxyCreateOnce(args.output, artifact);
  console.log(JSON.stringify({
    ok: true,
    schema: artifact.schema,
    artifact_sha256: artifact.artifact_sha256,
    requests: client.requestCount,
    metrics: artifact.metrics,
  }));
}

function parseArgs(raw: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < raw.length; index += 2) {
    const key = raw[index], value = raw[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error("arguments are malformed");
    values.set(key, value);
  }
  if (values.size !== 4 || !values.get("--source") || !values.get("--evaluation") || !values.get("--output")) {
    throw new Error("execution proxy requires source, evaluation, output, and max-requests");
  }
  const maxRequests = Number(values.get("--max-requests"));
  if (!Number.isSafeInteger(maxRequests)) throw new Error("max-requests is malformed");
  return {
    source: values.get("--source")!,
    evaluation: values.get("--evaluation")!,
    output: childOfVarTmp(values.get("--output")!, "execution proxy output"),
    maxRequests,
  };
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    Deno.exit(1);
  }
}
