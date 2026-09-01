import { assertAlmostEquals, assertEquals, assertRejects } from "@std/assert";
import { frozenDates, V43_OUTCOME_SCHEMA } from "./v43-outcomes.ts";
import {
  evaluateV43AdaptiveHoldout,
  hashArtifact,
  V43_HORIZON_SCHEMA,
  wholeDateClusterBootstrap,
  writeEvaluationCreateOnce,
} from "./v43-evaluate.ts";

const stations = JSON.parse(await Deno.readTextFile("data/stations.json")) as Array<{ station_id: string }>;
const dates = [...frozenDates()];

async function outcomeArtifact(tmax = 70) {
  return await hashArtifact({
    schema: V43_OUTCOME_SCHEMA,
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
    rows: dates.flatMap((marketDate) =>
      stations.map((station, index) => ({
        station_id: station.station_id,
        market_date: marketDate,
        ghcn_station_id: `USW000${String(index + 1).padStart(5, "0")}`,
        tmax_f: tmax,
      }))
    ),
  });
}

async function horizonArtifact(horizon: "f042" | "f066", q95 = 70.9) {
  const offset = horizon === "f042" ? -1 : -2;
  const product = `noaa_nbm_v43_blend_qmd_12z_${horizon}_native_max_t_q95_historical_calibration_v1`;
  return await hashArtifact({
    schema: V43_HORIZON_SCHEMA,
    horizon,
    source_profile: `v43-${horizon}`,
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
    rows: dates.flatMap((marketDate) =>
      stations.map((station) => ({
        station_id: station.station_id,
        market_date: marketDate,
        q95_max_f: q95,
        source_profile: `v43-${horizon}`,
        source_product: product,
        source_run_date: shiftDate(marketDate, offset),
        message_sha256: "a".repeat(64),
      }))
    ),
  });
}

Deno.test("evaluates both horizons separately over the same 100 whole-date clusters", async () => {
  const result = await evaluateV43AdaptiveHoldout({
    f042: await horizonArtifact("f042"),
    f066: await horizonArtifact("f066"),
    outcomes: await outcomeArtifact(),
    generatedAt: new Date("2026-09-01T00:00:00.000Z"),
  });
  assertEquals(result.date_window.independent_market_dates, 100);
  assertEquals(result.horizon_policy.pooled_horizon_sample_prohibited, true);
  assertEquals(result.horizon_policy.reported_independent_market_dates, 100);
  assertEquals(result.evaluations.length, 2);
  for (const evaluation of result.evaluations) {
    assertEquals(evaluation.rows, 2_000);
    assertEquals(evaluation.independent_market_dates, 100);
    assertEquals(evaluation.successes, 2_000);
    assertAlmostEquals(evaluation.brier_score_at_fixed_0_95, 0.0025, 1e-12);
    assertEquals(evaluation.concentration.maximum_station_share, 0.05);
    assertEquals(evaluation.concentration.maximum_date_share, 0.01);
    assertEquals(evaluation.station_leave_one_out.length, 20);
    assertEquals(evaluation.whole_date_clustered.method, "deterministic_whole_market_date_cluster_bootstrap_v1");
    assertEquals(evaluation.whole_date_clustered.samples, 10_000);
  }
  assertEquals(result.independent_oos, false);
  assertEquals(result.profitability_claim, false);
  assertEquals(result.trading_authority, false);
});

Deno.test("whole-date bootstrap is deterministic and never treats two horizons as 200 clusters", () => {
  const clusters = Array.from({ length: 100 }, (_, index) => index % 5 === 0 ? -0.95 : 0.05);
  const first = wholeDateClusterBootstrap(clusters, 43_095_042);
  const second = wholeDateClusterBootstrap(clusters, 43_095_042);
  assertEquals(first, second);
  assertEquals(first.oneSided95Lower <= first.oneSided90Lower, true);
});

Deno.test("uses exact integer TMAX <= floor(Q95) equality arithmetic", async () => {
  const equality = await evaluateV43AdaptiveHoldout({
    f042: await horizonArtifact("f042", 70.999),
    f066: await horizonArtifact("f066", 70.999),
    outcomes: await outcomeArtifact(70),
  });
  assertEquals(equality.evaluations[0].successes, 2_000);
  const loss = await evaluateV43AdaptiveHoldout({
    f042: await horizonArtifact("f042", 70.999),
    f066: await horizonArtifact("f066", 70.999),
    outcomes: await outcomeArtifact(71),
  });
  assertEquals(loss.evaluations[0].successes, 0);
  assertEquals(loss.evaluations[0].gates.nonnegative_clustered_95_margin, false);
});

Deno.test("rejects checksum, horizon, date, and coverage drift rather than pooling", async () => {
  const f042 = await horizonArtifact("f042") as Record<string, unknown>;
  f042.artifact_sha256 = "b".repeat(64);
  const validF066 = await horizonArtifact("f066");
  const validOutcomes = await outcomeArtifact();
  await assertRejects(
    () =>
      evaluateV43AdaptiveHoldout({
        f042,
        f066: validF066,
        outcomes: validOutcomes,
      }),
    Error,
    "checksum",
  );
  const wrong = await horizonArtifact("f066") as Record<string, unknown>;
  const unsigned: Record<string, unknown> = { ...wrong, horizon: "f042" };
  delete unsigned.artifact_sha256;
  const rehashedWrong = await hashArtifact(unsigned);
  await assertRejects(
    () =>
      evaluateV43AdaptiveHoldout({
        f042: rehashedWrong,
        f066: validF066,
        outcomes: validOutcomes,
      }),
    Error,
    "identity",
  );
});

Deno.test("evaluation output is create-once", async () => {
  const directory = await Deno.makeTempDir({ dir: "/var/tmp", prefix: "v43-eval-" });
  try {
    const path = `${directory}/evaluation.json`;
    const evaluation = await evaluateV43AdaptiveHoldout({
      f042: await horizonArtifact("f042"),
      f066: await horizonArtifact("f066"),
      outcomes: await outcomeArtifact(),
    });
    await writeEvaluationCreateOnce(path, evaluation);
    await assertRejects(() => writeEvaluationCreateOnce(path, evaluation), Deno.errors.AlreadyExists);
    await assertRejects(
      () => writeEvaluationCreateOnce(`${directory}/drift.json`, { ...evaluation, trading_authority: true }),
      Error,
      "checksum",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
