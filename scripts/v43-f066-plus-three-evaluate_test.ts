import { assertAlmostEquals, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { frozenDates, V43_OUTCOME_SCHEMA } from "./v43-outcomes.ts";
import { hashArtifact, V43_HORIZON_SCHEMA } from "./v43-evaluate.ts";
import {
  evaluateV43F066PlusThree,
  V43_F066_PLUS_THREE_BOOTSTRAP_SEED,
  V43_F066_PLUS_THREE_EVALUATION_SCHEMA,
  V43_F066_PLUS_THREE_IDENTITY,
  wholeDateBootstrap50,
  writeV43F066PlusThreeCreateOnce,
} from "./v43-f066-plus-three-evaluate.ts";

const dates = [...frozenDates()];
const stations = JSON.parse(await Deno.readTextFile("data/stations.json")) as Array<{ station_id: string }>;

Deno.test("evaluates only the untouched 50-date/1000-row plus-three holdout", async () => {
  const result = await evaluateV43F066PlusThree({
    f066: await horizonArtifact("f066", 70.9),
    outcomes: await outcomeArtifact(70),
    generatedAt: new Date("2026-09-01T18:00:00.000Z"),
  });
  assertEquals(result.schema, V43_F066_PLUS_THREE_EVALUATION_SCHEMA);
  assertEquals(result.identity, V43_F066_PLUS_THREE_IDENTITY);
  assertEquals(result.development_window, {
    start: "2026-01-07",
    end: "2026-02-25",
    station_dates_inspected: 1_000,
    market_dates_inspected: 50,
    holdout_rows_credited: 0,
    holdout_market_dates_credited: 0,
  });
  assertEquals(result.holdout_window, {
    start: "2026-02-26",
    end: "2026-04-16",
    station_dates: 1_000,
    independent_market_dates: 50,
    stations: 20,
  });
  assertEquals(result.cluster_policy.reported_independent_market_dates, 50);
  assertEquals(result.cluster_policy.prohibited_100_date_inflation, true);
  assertEquals(result.cluster_policy.prohibited_200_date_inflation, true);
  assertEquals(result.results.rows, 1_000);
  assertEquals(result.results.successes, 1_000);
  assertAlmostEquals(result.results.brier_score_at_fixed_0_95, 0.0025, 1e-12);
  assertEquals(result.results.whole_date_clustered.resampled_clusters_per_sample, 50);
  assertEquals(result.results.concentration.maximum_station_share, 0.05);
  assertEquals(result.results.concentration.maximum_date_share, 0.02);
  assertEquals(result.results.station_leave_one_out.length, 20);
  assertEquals(result.results.station_leave_one_out.every((row) => row.station_dates === 950), true);
  assertEquals(result.results.station_leave_one_out.every((row) => row.independent_market_dates === 50), true);
  assertEquals(result.adaptive_selection, true);
  assertEquals(result.independent_oos, false);
  assertEquals(result.profitability_claim, false);
  assertEquals(result.trading_authority, false);
});

Deno.test("exact floor-Q95-plus-3 boundary passes and the immediately higher outcome fails", async () => {
  const f066 = await horizonArtifact("f066", 70.999);
  const equality = await evaluateV43F066PlusThree({ f066, outcomes: await outcomeArtifact(73) });
  assertEquals(equality.results.successes, 1_000);
  const loss = await evaluateV43F066PlusThree({ f066, outcomes: await outcomeArtifact(74) });
  assertEquals(loss.results.successes, 0);
  assertEquals(loss.results.failures, 1_000);
  assertEquals(loss.gates.nonnegative_clustered_90_margin, false);
  assertEquals(loss.gates.nonnegative_clustered_95_margin, false);
});

Deno.test("plus-two is a rejected identity even when the artifact is checksum-valid", async () => {
  const result = await evaluateV43F066PlusThree({
    f066: await horizonArtifact("f066"),
    outcomes: await outcomeArtifact(),
  });
  const unsigned = structuredClone(result) as Record<string, unknown>;
  delete unsigned.artifact_sha256;
  (unsigned.threshold_policy as Record<string, unknown>).buffer_f = 2;
  const plusTwo = await hashArtifact(unsigned);
  const directory = await Deno.makeTempDir({ dir: "/var/tmp", prefix: "f066-plus-two-" });
  try {
    await assertRejects(
      () => writeV43F066PlusThreeCreateOnce(`${directory}/plus-two.json`, plusTwo),
      Error,
      "identity",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("rejects f042, raw-rule, checksum, and coverage drift", async () => {
  const outcomes = await outcomeArtifact(), valid = await horizonArtifact("f066");
  const f042 = await horizonArtifact("f042");
  await assertRejects(
    () => evaluateV43F066PlusThree({ f066: f042, outcomes }),
    Error,
    "f066 artifact identity",
  );

  const rawUnsigned = structuredClone(valid) as Record<string, unknown>;
  delete rawUnsigned.artifact_sha256;
  rawUnsigned.source_product = "noaa_nbm_raw_f066_q95_v1";
  const raw = await hashArtifact(rawUnsigned);
  await assertRejects(
    () => evaluateV43F066PlusThree({ f066: raw, outcomes }),
    Error,
    "f066 artifact identity",
  );

  const checksum = structuredClone(valid) as Record<string, unknown>;
  checksum.artifact_sha256 = "b".repeat(64);
  await assertRejects(
    () => evaluateV43F066PlusThree({ f066: checksum, outcomes }),
    Error,
    "checksum",
  );

  const coverageUnsigned = structuredClone(valid) as Record<string, unknown>;
  delete coverageUnsigned.artifact_sha256;
  (coverageUnsigned.coverage as Record<string, unknown>).station_dates = 1_999;
  const coverage = await hashArtifact(coverageUnsigned);
  await assertRejects(
    () => evaluateV43F066PlusThree({ f066: coverage, outcomes }),
    Error,
    "coverage",
  );
});

Deno.test("50-date bootstrap is deterministic and refuses inflated cluster counts", () => {
  const clusters = Array.from({ length: 50 }, (_, index) => index % 10 === 0 ? -0.95 : 0.05);
  const first = wholeDateBootstrap50(clusters, V43_F066_PLUS_THREE_BOOTSTRAP_SEED);
  const second = wholeDateBootstrap50(clusters, V43_F066_PLUS_THREE_BOOTSTRAP_SEED);
  assertEquals(first, second);
  assertEquals(first.oneSided95Lower <= first.oneSided90Lower, true);
  assertThrows(
    () => wholeDateBootstrap50([...clusters, ...clusters], V43_F066_PLUS_THREE_BOOTSTRAP_SEED),
    Error,
    "exactly 50",
  );
});

Deno.test("plus-three evaluation output is checksum-bound and create-once under var/tmp", async () => {
  const result = await evaluateV43F066PlusThree({
    f066: await horizonArtifact("f066"),
    outcomes: await outcomeArtifact(),
  });
  const directory = await Deno.makeTempDir({ dir: "/var/tmp", prefix: "f066-plus-three-" });
  try {
    const output = `${directory}/evaluation.json`;
    await writeV43F066PlusThreeCreateOnce(output, result);
    await assertRejects(() => writeV43F066PlusThreeCreateOnce(output, result), Deno.errors.AlreadyExists);
    await assertRejects(
      () => writeV43F066PlusThreeCreateOnce("/tmp/unsafe.json", result),
      Error,
      "child of /var/tmp",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

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

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
