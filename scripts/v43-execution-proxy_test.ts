import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { frozenDates, V43_STATION_IDS } from "./v43-outcomes.ts";
import { hashArtifact, V43_EVALUATION_SCHEMA, V43_HORIZON_SCHEMA } from "./v43-evaluate.ts";
import {
  BoundedPublicKalshiClient,
  exportV43ExecutionProxy,
  V43_EXECUTION_PROXY_MAX_REQUESTS,
  V43_EXECUTION_PROXY_SCHEMA,
  V43_EXECUTION_PROXY_STATIONS,
  writeExecutionProxyCreateOnce,
} from "./v43-execution-proxy.ts";
import {
  V43_F066_PLUS_THREE_EVALUATION_SCHEMA,
  V43_F066_PLUS_THREE_HOLDOUT_END,
  V43_F066_PLUS_THREE_HOLDOUT_START,
  V43_F066_PLUS_THREE_IDENTITY,
} from "./v43-f066-plus-three-evaluate.ts";

const dates = [...frozenDates()];

Deno.test("exports exact 20-series public quote/trade proxies without credentials, depth, or fill credit", async () => {
  const { source, evaluation } = await inputArtifacts();
  let clock = 0, calls = 0, lastRequestAt: number | null = null, lastCandleAt: number | null = null;
  const client = new BoundedPublicKalshiClient(
    V43_EXECUTION_PROXY_MAX_REQUESTS,
    (request, init) => {
      calls += 1;
      const url = new URL(request instanceof Request ? request.url : String(request));
      const headers = new Headers(init?.headers);
      assertEquals(headers.has("authorization"), false);
      assertEquals([...headers.keys()].some((name) => name.toLowerCase().startsWith("kalshi-access")), false);
      if (lastRequestAt !== null) assertEquals(clock - lastRequestAt >= 1_000, true);
      lastRequestAt = clock;
      if (url.pathname.includes("/candlesticks")) {
        if (lastCandleAt !== null) assertEquals(clock - lastCandleAt >= 1_000, true);
        lastCandleAt = clock;
      }
      return Promise.resolve(jsonResponse(providerPayload(url)));
    },
    () => clock,
    (milliseconds) => {
      clock += milliseconds;
      return Promise.resolve();
    },
  );
  const artifact = await exportV43ExecutionProxy({
    source,
    evaluation,
    client,
    generatedAt: new Date("2026-09-01T12:00:00.000Z"),
  });
  assertEquals(artifact.schema, V43_EXECUTION_PROXY_SCHEMA);
  assertEquals(artifact.metrics, {
    station_dates: 2_000,
    exact_contracts_selected: 2_000,
    exact_settlements_bound: 2_000,
    causal_quote_proxies: 2_000,
    compatible_public_trade_proxies: 2_000,
    frozen_price_band_quote_proxies: 0,
    exact_prospective_selections_reconstructed: 0,
    provider_confirmed_fills: 0,
  });
  assertEquals(artifact.request_policy.actual_requests, 4_041);
  assertEquals(calls, 4_041);
  assertEquals(artifact.provider_confirmed_fill_evidence, false);
  assertEquals(artifact.executable_depth_evidence, false);
  assertEquals(artifact.rows.length, 2_000);
  const first = artifact.rows[0] as Record<string, unknown>;
  const quote = first.quote_proxy as Record<string, unknown>;
  const trades = first.public_trades as Record<string, unknown>;
  assertEquals(first.condition, "greater");
  assertEquals(first.side, "no");
  assertEquals(first.decision_at, "2026-01-06T20:05:00.000Z");
  assertEquals(quote.no_ask_proxy, "0.9000");
  assertEquals(quote.displayed_depth, null);
  assertEquals((trades.trades as unknown[]).length, 1);
  assertEquals(trades.exposes_taker_side_and_price, true);
  assertEquals(trades.exposes_resting_depth_identity, false);

  const directory = await Deno.makeTempDir({ dir: "/var/tmp", prefix: "v43-execution-proxy-" });
  try {
    const output = `${directory}/artifact.json`;
    await writeExecutionProxyCreateOnce(output, artifact);
    await assertRejects(() => writeExecutionProxyCreateOnce(output, artifact), Deno.errors.AlreadyExists);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("selection ignores attractive final quotes and outcomes and reports missing exact strikes", async () => {
  const { source, evaluation } = await inputArtifacts();
  const client = new BoundedPublicKalshiClient(
    V43_EXECUTION_PROXY_MAX_REQUESTS,
    (request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      if (url.pathname === "/trade-api/v2/historical/cutoff") return Promise.resolve(jsonResponse(cutoff()));
      if (url.pathname === "/trade-api/v2/historical/markets") {
        const station = stationForSeries(url.searchParams.get("series_ticker")!);
        const rows = station.stationId === "KOKC"
          ? dates.map((date) =>
            market(station.seriesTicker, date, 71, {
              ticker: `${eventTicker(station.seriesTicker, date)}-T71-ATTRACTIVE`,
              yes_ask_dollars: "0.0100",
              result: "yes",
            })
          )
          : dates.map((date) => market(station.seriesTicker, date));
        return Promise.resolve(jsonResponse({ markets: rows, cursor: "" }));
      }
      if (url.pathname === "/trade-api/v2/events") {
        assertEquals(url.searchParams.get("status"), "settled");
        const station = stationForSeries(url.searchParams.get("series_ticker")!);
        const rows = dates.map((date) => event(station, date));
        if (station.stationId === "KHOU") {
          for (const row of rows) {
            row.settlement_sources[0].url =
              "https://forecast.weather.gov/product.php?site=HGX&product=CLI&issuedby=IAH";
          }
        }
        return Promise.resolve(jsonResponse({ events: rows, cursor: "" }));
      }
      return Promise.resolve(jsonResponse(providerPayload(url)));
    },
    () => 0,
    () => Promise.resolve(),
  );
  const artifact = await exportV43ExecutionProxy({ source, evaluation, client });
  assertEquals(artifact.metrics.exact_contracts_selected, 1_900);
  assertEquals(artifact.metrics.exact_settlements_bound, 1_900);
  const missing = artifact.rows.filter((row) => row.station_id === "KOKC") as Array<Record<string, unknown>>;
  assertEquals(missing.length, 100);
  assertEquals(missing.every((row) => row.contract === null && row.quote_proxy === null), true);
  assertEquals(
    missing.every((row) => (row.blockers as string[]).includes("EXACT_GREATER_CONTRACT_MISSING")),
    true,
  );
});

Deno.test("HTTP 429 reports the failed ordinal/path without retry or successful capture", async () => {
  assertThrows(
    () => new BoundedPublicKalshiClient(V43_EXECUTION_PROXY_MAX_REQUESTS - 1),
    Error,
    `max_requests=${V43_EXECUTION_PROXY_MAX_REQUESTS}`,
  );
  let attempts = 0;
  const client = new BoundedPublicKalshiClient(
    V43_EXECUTION_PROXY_MAX_REQUESTS,
    () => {
      attempts += 1;
      return Promise.resolve(new Response("rate limited", { status: 429 }));
    },
    () => 0,
    () => Promise.resolve(),
  );
  await assertRejects(
    () => client.request("/historical/markets", { series_ticker: "KXHIGHNY", limit: "1000" }),
    Error,
    "HTTP 429 is terminal; attempted_request=1 path=/trade-api/v2/historical/markets?series_ticker=KXHIGHNY&limit=1000",
  );
  assertEquals(attempts, 1);
  assertEquals(client.requestCount, 0);
  assertEquals(client.captures, []);
});

Deno.test("repeated discovery cursors and checksum drift fail closed", async () => {
  const { source, evaluation } = await inputArtifacts();
  const drift = structuredClone(source) as Record<string, unknown>;
  (drift.rows as Array<Record<string, unknown>>)[0].q95_max_f = 99;
  const noNetwork = new BoundedPublicKalshiClient(
    V43_EXECUTION_PROXY_MAX_REQUESTS,
    () => Promise.reject(new Error("network should not run")),
  );
  await assertRejects(
    () => exportV43ExecutionProxy({ source: drift, evaluation, client: noNetwork }),
    Error,
    "checksum",
  );

  let marketPages = 0;
  const looping = new BoundedPublicKalshiClient(
    V43_EXECUTION_PROXY_MAX_REQUESTS,
    (request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      if (url.pathname === "/trade-api/v2/historical/cutoff") return Promise.resolve(jsonResponse(cutoff()));
      marketPages += 1;
      return Promise.resolve(jsonResponse({ markets: [], cursor: "same_cursor" }));
    },
    () => 0,
    () => Promise.resolve(),
  );
  await assertRejects(
    () => exportV43ExecutionProxy({ source, evaluation, client: looping }),
    Error,
    "repeated a cursor",
  );
  assertEquals(marketPages, 2);
});

Deno.test("failed complete-date or clustered-90 calibration stops before any Kalshi request", async () => {
  const { source, evaluation } = await inputArtifacts();
  const unsigned = structuredClone(evaluation) as Record<string, unknown>;
  delete unsigned.artifact_sha256;
  const horizon = (unsigned.evaluations as Array<Record<string, unknown>>)[0];
  horizon.gates = { complete_100_dates: true, nonnegative_clustered_90_margin: false };
  const failed = await hashArtifact(unsigned);
  let fetches = 0;
  const client = new BoundedPublicKalshiClient(V43_EXECUTION_PROXY_MAX_REQUESTS, () => {
    fetches += 1;
    return Promise.reject(new Error("network must not run for failed calibration"));
  });
  await assertRejects(
    () => exportV43ExecutionProxy({ source, evaluation: failed, client }),
    Error,
    "calibration preflight failed",
  );
  assertEquals(fetches, 0);
  assertEquals(client.requestCount, 0);
});

Deno.test("f066 is checksum-validated then rejected before network rather than inheriting f042 semantics", async () => {
  const { source, evaluation } = await inputArtifacts("f066");
  let fetches = 0;
  const client = new BoundedPublicKalshiClient(V43_EXECUTION_PROXY_MAX_REQUESTS, () => {
    fetches += 1;
    return Promise.reject(new Error("network must not run for unsupported f066"));
  });
  await assertRejects(
    () => exportV43ExecutionProxy({ source, evaluation, client }),
    Error,
    "f066 plus-three holdout window",
  );
  assertEquals(fetches, 0);
  assertEquals(client.requestCount, 0);
});

Deno.test("f066 plus-three proxy uses only the exact 50-date holdout, +3 strike, and strict 14Z-18Z window", async () => {
  const { source, evaluation } = await f066PlusThreeInputArtifacts();
  const holdoutDates = dates.filter((date) => date >= V43_F066_PLUS_THREE_HOLDOUT_START);
  let clock = 0, candlestickCalls = 0;
  const client = new BoundedPublicKalshiClient(
    V43_EXECUTION_PROXY_MAX_REQUESTS,
    (request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      if (url.pathname === "/trade-api/v2/historical/cutoff") return Promise.resolve(jsonResponse(cutoff()));
      if (url.pathname === "/trade-api/v2/historical/markets") {
        const station = stationForSeries(url.searchParams.get("series_ticker")!);
        return Promise.resolve(jsonResponse({
          markets: holdoutDates.map((date) => market(station.seriesTicker, date, 73)),
          cursor: "",
        }));
      }
      if (url.pathname === "/trade-api/v2/events") {
        const station = stationForSeries(url.searchParams.get("series_ticker")!);
        return Promise.resolve(jsonResponse({ events: holdoutDates.map((date) => event(station, date)), cursor: "" }));
      }
      if (url.pathname.includes("/candlesticks")) {
        candlestickCalls += 1;
        const ticker = decodeURIComponent(url.pathname.split("/").at(-2)!);
        const start = Number(url.searchParams.get("start_ts"));
        const end = Number(url.searchParams.get("end_ts"));
        assertEquals(new Date((start - 1) * 1_000).toISOString().slice(11), "14:00:00.000Z");
        assertEquals(new Date((end + 1) * 1_000).toISOString().slice(11), "18:00:00.000Z");
        return Promise.resolve(jsonResponse({
          ticker,
          candlesticks: [
            candle(start + 119, "0.0800"),
            candle(start + 59, "0.1000"),
          ],
        }));
      }
      if (url.pathname === "/trade-api/v2/historical/trades") {
        const ticker = url.searchParams.get("ticker")!, start = Number(url.searchParams.get("min_ts")) + 1;
        assertEquals(new Date(start * 1_000).toISOString().slice(11), "14:00:00.000Z");
        assertEquals(new Date(Number(url.searchParams.get("max_ts")) * 1_000).toISOString().slice(11), "18:00:00.000Z");
        return Promise.resolve(jsonResponse({
          trades: [{
            trade_id: `trade-${ticker}`,
            ticker,
            count_fp: "1.00",
            yes_price_dollars: "0.1200",
            no_price_dollars: "0.8800",
            taker_side: "no",
            created_time: new Date((start + 90) * 1_000).toISOString(),
          }],
          cursor: "",
        }));
      }
      throw new Error(`unexpected f066 test URL ${url}`);
    },
    () => clock,
    (milliseconds) => {
      clock += milliseconds;
      return Promise.resolve();
    },
  );
  const artifact = await exportV43ExecutionProxy({ source, evaluation, client });
  assertEquals(artifact.horizon, "f066");
  assertEquals(artifact.supported_policy_identity, V43_F066_PLUS_THREE_IDENTITY);
  assertEquals(artifact.metrics.station_dates, 1_000);
  assertEquals(artifact.request_policy.actual_requests, 2_041);
  assertEquals(candlestickCalls, 1_000);
  assertEquals(artifact.executable_depth_evidence, false);
  assertEquals(artifact.provider_confirmed_fill_evidence, false);
  assertEquals(artifact.frozen_policy.threshold, "floor(native_q95_f)+3F");
  const first = artifact.rows[0] as Record<string, unknown>;
  const quote = first.quote_proxy as Record<string, unknown>;
  const support = first.support as Record<string, unknown>;
  assertEquals(first.market_date, V43_F066_PLUS_THREE_HOLDOUT_START);
  assertEquals(first.threshold_f, 73);
  assertEquals(first.decision_at, "2026-02-25T14:00:00.000Z");
  assertEquals(first.trade_window_end_exclusive, "2026-02-25T18:00:00.000Z");
  assertEquals(quote.no_ask_proxy, "0.9000");
  assertEquals(quote.candle_end_at, "2026-02-25T14:01:00.000Z");
  assertEquals(quote.displayed_depth, null);
  assertEquals(support.displayed_depth_verified, false);
  assertEquals(support.exact_prospective_selection_reconstructed, false);
});

Deno.test("f066 plus-three rejects adjacent policy identity and boundary candles before granting proxy support", async () => {
  const { source, evaluation } = await f066PlusThreeInputArtifacts();
  const adjacentUnsigned = structuredClone(evaluation) as Record<string, unknown>;
  delete adjacentUnsigned.artifact_sha256;
  (adjacentUnsigned.threshold_policy as Record<string, unknown>).buffer_f = 2;
  const adjacent = await hashArtifact(adjacentUnsigned);
  let fetches = 0;
  const noNetwork = new BoundedPublicKalshiClient(V43_EXECUTION_PROXY_MAX_REQUESTS, () => {
    fetches += 1;
    return Promise.reject(new Error("network must not run"));
  });
  await assertRejects(
    () => exportV43ExecutionProxy({ source, evaluation: adjacent, client: noNetwork }),
    Error,
    "evaluation identity",
  );
  assertEquals(fetches, 0);

  const holdoutDates = dates.filter((date) => date >= V43_F066_PLUS_THREE_HOLDOUT_START);
  const boundary = new BoundedPublicKalshiClient(
    V43_EXECUTION_PROXY_MAX_REQUESTS,
    (request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      if (url.pathname === "/trade-api/v2/historical/cutoff") return Promise.resolve(jsonResponse(cutoff()));
      if (url.pathname === "/trade-api/v2/historical/markets") {
        const station = stationForSeries(url.searchParams.get("series_ticker")!);
        return Promise.resolve(jsonResponse({
          markets: holdoutDates.map((date) => market(station.seriesTicker, date, 73)),
          cursor: "",
        }));
      }
      if (url.pathname === "/trade-api/v2/events") {
        const station = stationForSeries(url.searchParams.get("series_ticker")!);
        return Promise.resolve(jsonResponse({ events: holdoutDates.map((date) => event(station, date)), cursor: "" }));
      }
      if (url.pathname.includes("/candlesticks")) {
        const ticker = decodeURIComponent(url.pathname.split("/").at(-2)!);
        const outside = Number(url.searchParams.get("end_ts")) + 1;
        return Promise.resolve(jsonResponse({ ticker, candlesticks: [candle(outside, "0.1000")] }));
      }
      throw new Error(`unexpected boundary test URL ${url}`);
    },
    () => 0,
    () => Promise.resolve(),
  );
  await assertRejects(
    () => exportV43ExecutionProxy({ source, evaluation, client: boundary }),
    Error,
    "candlestick timestamp is invalid",
  );
});

async function inputArtifacts(horizon: "f042" | "f066" = "f042") {
  const profile = `v43-${horizon}`, offset = horizon === "f042" ? -1 : -2;
  const product = `noaa_nbm_v43_blend_qmd_12z_${horizon}_native_max_t_q95_historical_calibration_v1`;
  const rows = dates.flatMap((marketDate) =>
    V43_STATION_IDS.map((stationId) => ({
      station_id: stationId,
      market_date: marketDate,
      q95_max_f: "70.9",
      source_profile: profile,
      source_product: product,
      source_run_date: shiftDate(marketDate, offset),
      message_sha256: "a".repeat(64),
    }))
  );
  const source = await hashArtifact({
    schema: V43_HORIZON_SCHEMA,
    horizon,
    source_profile: profile,
    source_product: product,
    evidence_class: "adaptive_historical_holdout",
    independent_oos: false,
    research_only: true,
    recommendation_authority: false,
    order_authority: false,
    capital_risk_authority: false,
    trading_authority: false,
    production_activation: false,
    date_window: { start: "2026-01-07", end: "2026-04-16", independent_market_dates: 100 },
    coverage: { stations: 20, market_dates: 100, station_dates: 2_000, complete: true },
    rows,
  });
  const evaluation = await hashArtifact({
    schema: V43_EVALUATION_SCHEMA,
    generated_at: "2026-09-01T00:00:00.000Z",
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
    horizon_policy: { horizons_evaluated_separately: true },
    outcome_artifact_sha256: "b".repeat(64),
    horizon_artifact_sha256: {
      f042: horizon === "f042" ? source.artifact_sha256 : "c".repeat(64),
      f066: horizon === "f066" ? source.artifact_sha256 : "c".repeat(64),
    },
    evaluations: [{
      horizon,
      artifact_sha256: source.artifact_sha256,
      rows: 2_000,
      independent_market_dates: 100,
      gates: { complete_100_dates: true, nonnegative_clustered_90_margin: true },
    }],
    limitations: [],
  });
  return { source, evaluation };
}

async function f066PlusThreeInputArtifacts() {
  const { source } = await inputArtifacts("f066");
  const evaluation = await hashArtifact({
    schema: V43_F066_PLUS_THREE_EVALUATION_SCHEMA,
    identity: V43_F066_PLUS_THREE_IDENTITY,
    generated_at: "2026-09-01T00:00:00.000Z",
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
    source_artifact_sha256: source.artifact_sha256,
    outcome_artifact_sha256: "b".repeat(64),
    threshold_policy: {
      arithmetic: "official_integer_tmax_f <= floor(native_f066_q95_f) + 3",
      buffer_f: 3,
      fixed_probability: 0.95,
      adjacent_plus_2_identity_accepted: false,
    },
    development_window: {
      start: "2026-01-07",
      end: "2026-02-25",
      station_dates_inspected: 1_000,
      market_dates_inspected: 50,
      holdout_rows_credited: 0,
      holdout_market_dates_credited: 0,
    },
    holdout_window: {
      start: V43_F066_PLUS_THREE_HOLDOUT_START,
      end: V43_F066_PLUS_THREE_HOLDOUT_END,
      station_dates: 1_000,
      independent_market_dates: 50,
      stations: 20,
    },
    gates: {
      complete_exact_50_dates: true,
      nonnegative_clustered_90_margin: true,
      nonnegative_clustered_95_margin: true,
      maximum_station_share_at_most_0_05: true,
      maximum_date_share_at_most_0_02: true,
      all_station_leave_one_out_90_nonnegative: true,
      all_station_leave_one_out_95_nonnegative: true,
    },
  });
  return { source, evaluation };
}

function candle(end: number, yesBid: string) {
  return {
    end_period_ts: end,
    yes_bid: { open: yesBid, low: yesBid, high: yesBid, close: yesBid },
    yes_ask: { open: "0.1200", low: "0.1200", high: "0.1200", close: "0.1200" },
    price: { previous: "0.1100" },
    volume: "0.00",
    open_interest: "10.00",
  };
}

function providerPayload(url: URL) {
  if (url.pathname === "/trade-api/v2/historical/cutoff") return cutoff();
  if (url.pathname === "/trade-api/v2/historical/markets") {
    const station = stationForSeries(url.searchParams.get("series_ticker")!);
    return { markets: dates.map((date) => market(station.seriesTicker, date)), cursor: "" };
  }
  if (url.pathname === "/trade-api/v2/events") {
    const station = stationForSeries(url.searchParams.get("series_ticker")!);
    return { events: dates.map((date) => event(station, date)), cursor: "" };
  }
  if (url.pathname.includes("/candlesticks")) {
    const ticker = decodeURIComponent(url.pathname.split("/").at(-2)!);
    const end = Number(url.searchParams.get("end_ts"));
    return {
      ticker,
      candlesticks: [{
        end_period_ts: end,
        yes_bid: { open: "0.1000", low: "0.1000", high: "0.1000", close: "0.1000" },
        yes_ask: { open: "0.1200", low: "0.1200", high: "0.1200", close: "0.1200" },
        price: { previous: "0.1100" },
        volume: "0.00",
        open_interest: "10.00",
      }],
    };
  }
  if (url.pathname === "/trade-api/v2/historical/trades") {
    const ticker = url.searchParams.get("ticker")!, start = Number(url.searchParams.get("min_ts")) + 1;
    return {
      trades: [{
        trade_id: `trade-${ticker}`,
        ticker,
        count_fp: "1.00",
        yes_price_dollars: "0.1200",
        no_price_dollars: "0.8800",
        taker_side: "no",
        created_time: new Date((start + 30) * 1_000).toISOString(),
      }],
      cursor: "",
    };
  }
  throw new Error(`unexpected test URL ${url}`);
}

function cutoff() {
  return {
    market_settled_ts: "2026-07-02T00:00:00Z",
    trades_created_ts: "2026-07-02T00:00:00Z",
    orders_updated_ts: "2026-07-02T00:00:00Z",
  };
}

function market(seriesTicker: string, marketDate: string, threshold = 70, overrides: Record<string, unknown> = {}) {
  const event = eventTicker(seriesTicker, marketDate), next = shiftDate(marketDate, 1);
  return {
    ticker: `${event}-T${threshold}`,
    event_ticker: event,
    market_type: "binary",
    strike_type: "greater",
    floor_strike: threshold,
    cap_strike: null,
    status: "finalized",
    open_time: `${shiftDate(marketDate, -1)}T15:00:00.000Z`,
    close_time: `${next}T04:59:00.000Z`,
    settlement_ts: `${next}T13:00:00.000Z`,
    expiration_value: "69.00",
    result: "no",
    yes_ask_dollars: "0.9900",
    ...overrides,
  };
}

function event(station: typeof V43_EXECUTION_PROXY_STATIONS[number], marketDate: string) {
  return {
    event_ticker: eventTicker(station.seriesTicker, marketDate),
    series_ticker: station.seriesTicker,
    settlement_sources: [{
      name: "NWS Climatological Report",
      url:
        `https://forecast.weather.gov/product.php?site=${station.nwsOffice}&product=CLI&issuedby=${station.climateProductId}`,
    }],
  };
}

function stationForSeries(series: string) {
  const station = V43_EXECUTION_PROXY_STATIONS.find((row) => row.seriesTicker === series);
  if (!station) throw new Error(`unknown series ${series}`);
  return station;
}

function eventTicker(series: string, date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][
    value.getUTCMonth()
  ];
  return `${series}-${String(value.getUTCFullYear()).slice(-2)}${month}${String(value.getUTCDate()).padStart(2, "0")}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
