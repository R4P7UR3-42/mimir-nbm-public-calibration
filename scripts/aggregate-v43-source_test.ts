import { assertEquals, assertRejects } from "@std/assert";
import { aggregateV43HistoricalSource } from "./aggregate-v43-source.ts";
import { sourceProfileIdentity, sourceRunDate, V43_HISTORICAL_MARKET_DATES } from "./capture.ts";

Deno.test("aggregates one exact checksum-bound 2,000-row horizon without authority", async () => {
  const root = await Deno.makeTempDir({ dir: "/var/tmp", prefix: "nbm-v43-aggregate-test-" });
  try {
    const input = `${root}/input`;
    const output = `${root}/f042.json`;
    await writeFixture(input, "v43-f042");
    const result = await aggregateV43HistoricalSource({ inputRoot: input, output, sourceProfile: "v43-f042" });
    assertEquals(result.horizon, "f042");
    assertEquals(result.rows, 2_000);
    const artifact = JSON.parse(await Deno.readTextFile(output));
    const { artifact_sha256: artifactSha, ...payload } = artifact;
    assertEquals(artifactSha, await sha256(new TextEncoder().encode(JSON.stringify(payload))));
    assertEquals(artifact.schema, "noaa_nbm_v43_native_max_t_q95_adaptive_holdout_horizon_v1");
    assertEquals(artifact.source_profile, "v43-f042");
    assertEquals(
      artifact.source_product,
      "noaa_nbm_v43_blend_qmd_12z_f042_native_max_t_q95_historical_calibration_v1",
    );
    assertEquals(artifact.evidence_class, "adaptive_historical_holdout");
    assertEquals(artifact.independent_oos, false);
    assertEquals(artifact.research_only, true);
    assertEquals(artifact.recommendation_authority, false);
    assertEquals(artifact.order_authority, false);
    assertEquals(artifact.capital_risk_authority, false);
    assertEquals(artifact.trading_authority, false);
    assertEquals(artifact.production_activation, false);
    assertEquals(artifact.date_window, {
      start: "2026-01-07",
      end: "2026-04-16",
      independent_market_dates: 100,
    });
    assertEquals(artifact.coverage, { stations: 20, market_dates: 100, station_dates: 2_000, complete: true });
    assertEquals(artifact.rows.length, 2_000);
    assertEquals(artifact.rows[0].source_run_date, "2026-01-06");

    const changedDate = V43_HISTORICAL_MARKET_DATES[0];
    const evidencePath = `${input}/${changedDate}/evidence.json`;
    const evidence = JSON.parse(await Deno.readTextFile(evidencePath));
    evidence.source.source_profile = "v43-f066";
    const changedBytes = new TextEncoder().encode(`${JSON.stringify(evidence, null, 2)}\n`);
    await Deno.writeFile(evidencePath, changedBytes);
    await Deno.writeTextFile(
      `${input}/${changedDate}/SHA256SUMS`,
      `${await sha256(changedBytes)}  evidence.json\n`,
    );
    await assertRejects(
      () =>
        aggregateV43HistoricalSource({
          inputRoot: input,
          output: `${root}/mixed.json`,
          sourceProfile: "v43-f042",
        }),
      Error,
      "source identity or authority",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function writeFixture(root: string, sourceProfile: "v43-f042" | "v43-f066") {
  const stations = JSON.parse(await Deno.readTextFile("data/stations.json")) as Array<{
    station_id: string;
    latitude: number;
    longitude: number;
  }>;
  const profile = sourceProfileIdentity(sourceProfile);
  for (const marketDate of V43_HISTORICAL_MARKET_DATES) {
    const dateRoot = `${root}/${marketDate}`;
    await Deno.mkdir(dateRoot, { recursive: true });
    const runDate = sourceRunDate(marketDate, sourceProfile);
    const messageSha = await sha256(new TextEncoder().encode(`${sourceProfile}:${marketDate}`));
    const evidence = {
      schema: profile.captureSchema,
      generated_at: "2026-09-01T00:00:00.000Z",
      research_only: true,
      source_only: true,
      historical_calibration_only: true,
      source_regime: profile.historicalRegime,
      credential_required: false,
      private_data_access: false,
      executable_quote_evidence: false,
      outcome_evidence: false,
      provider_confirmed_fill_evidence: false,
      recommendation_authority: false,
      order_authority: false,
      capital_risk_authority: false,
      trading_authority: false,
      production_activation: false,
      active_trading_capability_changed: false,
      automatic_production_activation: false,
      source: {
        source_profile: sourceProfile,
        source_product: profile.sourceProduct,
        market_date: marketDate,
        run_initialized_at: `${runDate}T12:00:00.000Z`,
        message_sha256: messageSha,
      },
      request_policy: { maximum_requests: 2, actual_requests: 2, no_retry: true, terminal_http_429: true },
      coverage: { stations: 20, complete: true },
      rows: stations.map((station, index) => ({
        station_id: station.station_id,
        grid_latitude: station.latitude,
        grid_longitude: station.longitude,
        distance_km: index / 100,
        q95_max_f: `${70 + (index % 20)}`,
      })),
    };
    const bytes = new TextEncoder().encode(`${JSON.stringify(evidence, null, 2)}\n`);
    await Deno.writeFile(`${dateRoot}/evidence.json`, bytes, { createNew: true });
    await Deno.writeTextFile(`${dateRoot}/SHA256SUMS`, `${await sha256(bytes)}  evidence.json\n`, {
      createNew: true,
    });
  }
}

async function sha256(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
