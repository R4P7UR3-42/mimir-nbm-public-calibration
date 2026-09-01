import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { hashArtifact } from "./v43-evaluate.ts";
import { frozenDates, V43_OUTCOME_SCHEMA, V43_STATION_IDS } from "./v43-outcomes.ts";
import { V43_EXECUTION_PROXY_SCHEMA } from "./v43-execution-proxy.ts";
import { V43_F066_PLUS_THREE_IDENTITY } from "./v43-f066-plus-three-evaluate.ts";
import {
  evaluateV43F066PlusThreeEconomics,
  exactFeeEconomics,
  exactTakerFeeUnits,
  V43_F066_PLUS_THREE_ECONOMICS_SCHEMA,
  wholeDatePnlBootstrap,
  writeV43F066PlusThreeEconomicsCreateOnce,
} from "./v43-f066-plus-three-economics.ts";

const dates = [...frozenDates()];
const holdoutDates = dates.slice(50);
const bandFixtures = [
  ["2026-02-28", "KNYC", "0.9300", true],
  ["2026-04-04", "KDCA", "0.9600", true],
  ["2026-04-12", "KLAX", "0.9600", false],
  ["2026-04-13", "KLAX", "0.9600", true],
  ["2026-04-14", "KDCA", "0.9700", true],
  ["2026-04-14", "KATL", "0.9700", true],
] as const;

Deno.test("joins exact outcomes and fees, ranks at most three/date, and rejects promotion on 1/50 support", async () => {
  const inputs = await fixtures();
  const artifact = await evaluateV43F066PlusThreeEconomics(inputs);
  assertEquals(artifact.schema, V43_F066_PLUS_THREE_ECONOMICS_SCHEMA);
  assertEquals(artifact.quote_support, {
    exact_causal_quote_proxies: 67,
    exact_causal_compatible_public_trade_proxies: 67,
    frozen_price_band_rows: 6,
    frozen_price_band_compatible_public_trade_rows: 6,
    exact_depth_qualified_rows: 0,
    provider_confirmed_fills: 0,
  });
  assertEquals(artifact.price_band_diagnostic.rows, 6);
  assertEquals(artifact.price_band_diagnostic.wins, 5);
  assertEquals(artifact.price_band_diagnostic.losses, 1);
  assertEquals(artifact.price_band_diagnostic.net_proxy_pnl_dollars, "-0.7669");
  assertEquals(artifact.exact_edge_selection.candidates_before_daily_rank, 1);
  assertEquals(artifact.exact_edge_selection.selected_rows, 1);
  assertEquals(artifact.exact_edge_selection.independent_opportunity_dates, 50);
  assertEquals(artifact.exact_edge_selection.independent_supported_dates, 1);
  assertEquals(artifact.exact_edge_selection.support_fraction, "1/50");
  assertEquals(artifact.exact_edge_selection.net_proxy_pnl_dollars, "0.0654");
  assertEquals(artifact.exact_edge_selection.rows_detail[0].official_tmax_f, 72);
  assertEquals(artifact.exact_edge_selection.rows_detail[0].exact_fee_edge_dollars, "0.0154");
  assertEquals(artifact.exact_edge_selection.rows_detail[0].taker_fee_dollars, "0.0046");
  assertEquals(artifact.exact_edge_selection.whole_date_clustered.resampled_clusters_per_sample, 50);
  assertEquals(artifact.exact_edge_selection.whole_date_clustered.zero_pnl_dates_retained, 49);
  assertEquals(artifact.exact_edge_selection.whole_date_clustered.one_sided_90_lower_dollars_per_opportunity_date, 0);
  assertEquals(artifact.gates.positive_one_sided_90_clustered_net_proxy_pnl, false);
  assertEquals(artifact.gates.at_least_30_independent_supported_dates, false);
  assertEquals(artifact.decision.promotion_ready, false);
  assertEquals(artifact.executable_depth_evidence, false);
  assertEquals(artifact.provider_confirmed_fill_evidence, false);
  assertEquals(artifact.trading_authority, false);
});

Deno.test("exact price and edge boundaries pass while adjacent values fail", () => {
  assertEquals(exactFeeEconomics("0.7000").in_frozen_price_band, true);
  assertEquals(exactFeeEconomics("0.9700").in_frozen_price_band, true);
  assertEquals(exactFeeEconomics("0.6999").in_frozen_price_band, false);
  assertEquals(exactFeeEconomics("0.9701").in_frozen_price_band, false);
  assertEquals(exactFeeEconomics("0.9304").exact_fee_edge_units, 150);
  assertEquals(exactFeeEconomics("0.9305").exact_fee_edge_units, 149);
  assertEquals(exactTakerFeeUnits(9_300), 46);
  assertThrows(() => exactFeeEconomics("0.93"), Error, "four-decimal");
  assertThrows(() => exactTakerFeeUnits(9_300, 2), Error, "one contract");
});

Deno.test("outcome linkage and checksum drift fail closed", async () => {
  const inputs = await fixtures();
  const mismatchUnsigned = structuredClone(inputs.outcomes) as Record<string, unknown>;
  delete mismatchUnsigned.artifact_sha256;
  const mismatchRow = (mismatchUnsigned.rows as Array<Record<string, unknown>>).find((row) =>
    row.market_date === "2026-02-28" && row.station_id === "KNYC"
  )!;
  mismatchRow.tmax_f = 74;
  const mismatch = await hashArtifact(mismatchUnsigned);
  await assertRejects(
    () => evaluateV43F066PlusThreeEconomics({ proxy: inputs.proxy, outcomes: mismatch }),
    Error,
    "does not agree",
  );

  const drift = structuredClone(inputs.proxy) as Record<string, unknown>;
  (drift.rows as Array<Record<string, unknown>>)[0].threshold_f = 99;
  await assertRejects(
    () => evaluateV43F066PlusThreeEconomics({ proxy: drift, outcomes: inputs.outcomes }),
    Error,
    "checksum",
  );
});

Deno.test("daily ranking keeps only the three highest-edge station-distinct rows then ticker", async () => {
  const inputs = await fixtures();
  const proxyUnsigned = structuredClone(inputs.proxy) as Record<string, unknown>;
  delete proxyUnsigned.artifact_sha256;
  const rows = (proxyUnsigned.rows as Array<Record<string, unknown>>).filter((row) => row.market_date === "2026-02-26")
    .slice(0, 4);
  for (const row of rows) {
    (row.quote_proxy as Record<string, unknown>).no_ask_proxy = "0.9000";
    (row.support as Record<string, unknown>).frozen_price_band_proxy = true;
  }
  (proxyUnsigned.metrics as Record<string, unknown>).frozen_price_band_quote_proxies = 10;
  const proxy = await hashArtifact(proxyUnsigned);
  const artifact = await evaluateV43F066PlusThreeEconomics({ proxy, outcomes: inputs.outcomes });
  const ranked = artifact.exact_edge_selection.rows_detail.filter((row) => row.market_date === "2026-02-26");
  assertEquals(artifact.exact_edge_selection.candidates_before_daily_rank, 5);
  assertEquals(artifact.exact_edge_selection.selected_rows, 4);
  assertEquals(ranked.length, 3);
  assertEquals(
    ranked.map((row) => row.ticker),
    rows.map((row) => String((row.contract as Record<string, unknown>).ticker)).sort().slice(0, 3),
  );
});

Deno.test("whole-date bootstrap refuses sparse-row inflation and output is create-once", async () => {
  const values = Array(50).fill(0) as number[];
  values[0] = 654;
  assertEquals(wholeDatePnlBootstrap(values, 66_095_703), wholeDatePnlBootstrap(values, 66_095_703));
  assertThrows(() => wholeDatePnlBootstrap(values.slice(0, 49), 66_095_703), Error, "exactly 50");

  const artifact = await evaluateV43F066PlusThreeEconomics(await fixtures());
  const directory = await Deno.makeTempDir({ dir: "/var/tmp", prefix: "f066-economics-" });
  try {
    const output = `${directory}/artifact.json`;
    await writeV43F066PlusThreeEconomicsCreateOnce(output, artifact);
    await assertRejects(
      () => writeV43F066PlusThreeEconomicsCreateOnce(output, artifact),
      Deno.errors.AlreadyExists,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function fixtures() {
  const outcomesRows = dates.flatMap((marketDate) =>
    V43_STATION_IDS.map((stationId) => ({
      station_id: stationId,
      market_date: marketDate,
      ghcn_station_id: `GHCN-${stationId}`,
      tmax_f: marketDate === "2026-04-12" && stationId === "KLAX" ? 74 : 72,
    }))
  );
  const outcomes = await hashArtifact({
    schema: V43_OUTCOME_SCHEMA,
    generated_at: "2026-09-01T00:00:00.000Z",
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
    rows: outcomesRows,
  });
  const bandByKey = new Map(bandFixtures.map((row) => [`${row[0]}/${row[1]}`, row]));
  let outsideBandRemaining = 61;
  const proxyRows = holdoutDates.flatMap((marketDate) =>
    V43_STATION_IDS.map((stationId) => {
      const fixture = bandByKey.get(`${marketDate}/${stationId}`),
        causal = fixture !== undefined || outsideBandRemaining > 0;
      if (!fixture && outsideBandRemaining > 0) outsideBandRemaining -= 1;
      const price = fixture?.[2] ?? "0.9900", success = fixture?.[3] ?? true;
      return {
        station_id: stationId,
        series_ticker: `SERIES-${stationId}`,
        market_date: marketDate,
        q95_max_f: 70.9,
        threshold_f: 73,
        condition: "greater",
        side: "no",
        expected_event_ticker: `EVENT-${marketDate}-${stationId}`,
        decision_at: `${shiftDate(marketDate, -1)}T14:00:00.000Z`,
        trade_window_end_exclusive: `${shiftDate(marketDate, -1)}T18:00:00.000Z`,
        contract: causal
          ? {
            ticker: `TICKER-${marketDate}-${stationId}`,
            result: success ? "no" : "yes",
            expiration_value: success ? "72.00" : "74.00",
          }
          : null,
        settlement: {},
        market_available_for_frozen_window: causal,
        quote_proxy: causal ? { supported: true, no_ask_proxy: price, displayed_depth: null } : null,
        public_trades: causal ? {} : null,
        support: {
          exact_contract_selected: causal,
          exact_settlement_bound: true,
          causal_quote_proxy: causal,
          displayed_depth_verified: false,
          exact_prospective_selection_reconstructed: false,
          frozen_price_band_proxy: fixture !== undefined,
          compatible_public_trade: causal,
          compatible_public_trade_count: causal ? 1 : 0,
          provider_confirmed_fill: false,
        },
      };
    })
  );
  assertEquals(outsideBandRemaining, 0);
  const proxy = await hashArtifact({
    schema: V43_EXECUTION_PROXY_SCHEMA,
    generated_at: "2026-09-01T06:00:00.000Z",
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
    horizon: "f066",
    supported_horizon: "f066",
    supported_policy_identity: V43_F066_PLUS_THREE_IDENTITY,
    source_artifact_sha256: "a".repeat(64),
    evaluation_artifact_sha256: "b".repeat(64),
    frozen_policy: {
      market_dates: { start: "2026-02-26", end: "2026-04-16", independent_dates: 50 },
      stations: 20,
      station_dates: 1_000,
      condition: "greater",
      side: "no",
      threshold: "floor(native_q95_f)+3F",
      first_depth_qualified_quote_reconstructed: false,
    },
    request_policy: {
      maximum_requests: 8_401,
      actual_requests: 218,
      maximum_reads_per_second: 1,
      maximum_candlestick_reads_per_second: 1,
      no_retry: true,
      terminal_http_429: true,
    },
    metrics: {
      station_dates: 1_000,
      exact_contracts_selected: 67,
      exact_settlements_bound: 1_000,
      causal_quote_proxies: 67,
      compatible_public_trade_proxies: 67,
      frozen_price_band_quote_proxies: 6,
      exact_prospective_selections_reconstructed: 0,
      provider_confirmed_fills: 0,
    },
    evidence_boundaries: {
      historical_depth_available: false,
      exact_f066_first_depth_qualified_selection_available: false,
      f066_price_band_proxy_is_exact_net_ev: false,
    },
    rows: proxyRows,
  });
  return { proxy, outcomes };
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
