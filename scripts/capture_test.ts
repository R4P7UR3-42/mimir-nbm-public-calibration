import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  parseIndex,
  scheduledF066MarketDate,
  scheduledMarketDate,
  selectDecodedIdentity,
  sourceProfileIdentity,
  sourceRunDate,
  V43_HISTORICAL_MARKET_DATES,
  v43HistoricalMarketDateShard,
} from "./capture.ts";

Deno.test("scheduled capture derives the next market date from the UTC run date", () => {
  assertEquals(scheduledMarketDate(new Date("2026-09-01T20:20:00.000Z")), "2026-09-02");
  assertEquals(scheduledMarketDate(new Date("2026-12-31T23:59:59.999Z")), "2027-01-01");
  assertThrows(() => scheduledMarketDate(new Date("invalid")), Error, "clock");
});

Deno.test("scheduled f066 capture derives the market date two days after the UTC run date", () => {
  assertEquals(scheduledF066MarketDate(new Date("2026-09-01T20:35:00.000Z")), "2026-09-03");
  assertEquals(scheduledF066MarketDate(new Date("2026-12-31T23:59:59.999Z")), "2027-01-02");
  assertThrows(() => scheduledF066MarketDate(new Date("invalid")), Error, "clock");
});

Deno.test("workflow preserves bounded daily source-only capture contract", async () => {
  const workflow = await Deno.readTextFile(".github/workflows/one-date-canary.yml");
  for (
    const required of [
      'cron: "20 20 * * *"',
      "EVENT_NAME: ${{ github.event_name }}",
      "DISPATCH_MARKET_DATE: ${{ inputs.market_date }}",
      "scheduledMarketDate(new Date())",
      "--max-requests 2",
      ".source_only == true",
      ".trading_authority == false",
      ".request_policy.actual_requests == 2",
      "sha256sum -c SHA256SUMS",
      "retention-days: 30",
      "cancel-in-progress: false",
      "contents: write",
      "scripts/persist.ts preflight",
      "steps.persistence.outputs.capture_required == 'true'",
      "scripts/persist.ts preserve",
      'git push origin "HEAD:${GITHUB_REF_NAME}"',
      "evidence/${{ steps.market-date.outputs.market_date }}/provenance.json",
    ]
  ) assertStringIncludes(workflow, required);
  assertEquals(/^\s+push:/m.test(workflow), false);
});

Deno.test("f066 workflow is source-only, create-once, and isolated from f042", async () => {
  const workflow = await Deno.readTextFile(".github/workflows/f066-daily-source.yml");
  for (
    const required of [
      'cron: "35 20 * * *"',
      "scheduledF066MarketDate(new Date())",
      "--source-profile f066",
      "--max-requests 2",
      ".trading_authority == false",
      "scripts/persist.ts preflight",
      "scripts/persist.ts preserve",
      "evidence-f066/$MARKET_DATE",
      'git push origin "HEAD:${GITHUB_REF_NAME}"',
      "cancel-in-progress: false",
    ]
  ) assertStringIncludes(workflow, required);
  assertEquals(workflow.includes("evidence/$MARKET_DATE"), false);
  assertEquals(/^\s+push:/m.test(workflow), false);
});

Deno.test("persists the exact validated decoded GRIB identity", () => {
  const identity = selectDecodedIdentity({
    schema: "noaa_nbm_native_max_t_q95_decode_v1",
    eccodes_version: "2.48.0",
    data_date: "20260831",
    data_time: 1200,
    step_hours: 42,
    step_range: "24-42",
    percentile_value: 95,
    short_name: "max_2t",
    level_type: "heightAboveGround",
    level: 2,
    grid_type: "lambert",
    packing_type: "grid_complex_spatial_differencing",
    values: [],
  });
  assertEquals(identity, {
    data_date: "20260831",
    data_time: 1200,
    step_hours: 42,
    step_range: "24-42",
    percentile_value: 95,
    short_name: "max_2t",
    level_type: "heightAboveGround",
    level: 2,
  });
});

Deno.test("selects one exact Q95 row and adjacent byte interval", () => {
  const selected = parseIndex(
    [
      "262:491762996:d=2026083112:TMP:2 m above ground:24-42 hour max fcst:90% level",
      "263:494035444:d=2026083112:TMP:2 m above ground:24-42 hour max fcst:95% level",
      "264:496317844:d=2026083112:TMP:2 m above ground:24-42 hour max fcst:100% level",
    ].join("\n"),
    "2026-08-31",
  );
  assertEquals(selected.rangeStart, 494_035_444);
  assertEquals(selected.rangeEnd, 496_317_843);
  assertEquals(selected.messageLength, 2_282_400);
});

Deno.test("rejects Q90, duplicate, suffix drift, and terminal target", () => {
  const exact = "263:494035444:d=2026083112:TMP:2 m above ground:24-42 hour max fcst:95% level";
  assertThrows(() => parseIndex(exact, "2026-08-31"), Error, "terminal");
  assertThrows(() => parseIndex(`${exact}\n${exact}\n264:496317844:x`, "2026-08-31"), Error, "exactly one");
  assertThrows(() => parseIndex(`${exact}:drift\n264:496317844:x`, "2026-08-31"), Error, "exactly one");
});

Deno.test("selects only the exact f066 Q95 identity", () => {
  const selected = parseIndex(
    [
      "262:484430000:d=2026083012:TMP:2 m above ground:48-66 hour max fcst:90% level",
      "263:486715692:d=2026083012:TMP:2 m above ground:48-66 hour max fcst:95% level",
      "264:489000829:d=2026083012:TMP:2 m above ground:48-66 hour max fcst:100% level",
    ].join("\n"),
    "2026-08-30",
    "f066",
  );
  assertEquals(selected.rangeStart, 486_715_692);
  assertEquals(selected.rangeEnd, 489_000_828);
  assertEquals(selected.messageLength, 2_285_137);
  assertThrows(
    () =>
      parseIndex(
        "263:486715692:d=2026083012:TMP:2 m above ground:24-42 hour max fcst:95% level\n264:489000829:x",
        "2026-08-30",
        "f066",
      ),
    Error,
    "exactly one",
  );
});

Deno.test("freezes exactly 100 common v4.3 market dates in four bounded shards", () => {
  assertEquals(V43_HISTORICAL_MARKET_DATES.length, 100);
  assertEquals(V43_HISTORICAL_MARKET_DATES[0], "2026-01-07");
  assertEquals(V43_HISTORICAL_MARKET_DATES.at(-1), "2026-04-16");
  assertEquals(v43HistoricalMarketDateShard(1), V43_HISTORICAL_MARKET_DATES.slice(0, 25));
  assertEquals(v43HistoricalMarketDateShard(4), V43_HISTORICAL_MARKET_DATES.slice(75, 100));
  assertThrows(() => v43HistoricalMarketDateShard(0), Error, "one through four");
  assertThrows(() => v43HistoricalMarketDateShard(5), Error, "one through four");
});

Deno.test("v4.3 market dates map to exact prior-day f042 and two-day-prior f066 runs", () => {
  assertEquals(sourceRunDate("2026-01-07", "v43-f042"), "2026-01-06");
  assertEquals(sourceRunDate("2026-01-07", "v43-f066"), "2026-01-05");
  assertEquals(sourceRunDate("2026-04-16", "v43-f042"), "2026-04-15");
  assertEquals(sourceRunDate("2026-04-16", "v43-f066"), "2026-04-14");
  assertThrows(() => sourceRunDate("2026-01-06", "v43-f042"), Error, "frozen 100-date window");
  assertThrows(() => sourceRunDate("2026-04-17", "v43-f066"), Error, "frozen 100-date window");
});

Deno.test("v4.3 capture, decoder, product, and regime identities cannot pool", () => {
  const f042 = sourceProfileIdentity("v43-f042");
  const f066 = sourceProfileIdentity("v43-f066");
  const currentF042 = sourceProfileIdentity("f042");
  const currentF066 = sourceProfileIdentity("f066");
  assertEquals(f042, {
    captureSchema: "noaa_nbm_v43_native_max_t_q95_f042_historical_source_v1",
    decodeSchema: "noaa_nbm_v43_native_max_t_q95_f042_decode_v1",
    sourceProduct: "noaa_nbm_v43_blend_qmd_12z_f042_native_max_t_q95_historical_calibration_v1",
    historicalRegime: "noaa_nbm_v4_3_20250528_20260504",
  });
  assertEquals(f066, {
    captureSchema: "noaa_nbm_v43_native_max_t_q95_f066_historical_source_v1",
    decodeSchema: "noaa_nbm_v43_native_max_t_q95_f066_decode_v1",
    sourceProduct: "noaa_nbm_v43_blend_qmd_12z_f066_native_max_t_q95_historical_calibration_v1",
    historicalRegime: "noaa_nbm_v4_3_20250528_20260504",
  });
  assertEquals(
    new Set([f042.captureSchema, f066.captureSchema, currentF042.captureSchema, currentF066.captureSchema]).size,
    4,
  );
  assertEquals(
    new Set([f042.sourceProduct, f066.sourceProduct, currentF042.sourceProduct, currentF066.sourceProduct]).size,
    4,
  );
});

Deno.test("python decoder preserves both disjoint v4.3 schemas", async () => {
  const decoder = await Deno.readTextFile("scripts/decode.py");
  assertStringIncludes(decoder, '"v43-f042": ("noaa_nbm_v43_native_max_t_q95_f042_decode_v1", 42, "24-42")');
  assertStringIncludes(decoder, '"v43-f066": ("noaa_nbm_v43_native_max_t_q95_f066_decode_v1", 66, "48-66")');
});

Deno.test("selects only exact v4.3 horizon identities", () => {
  const f042 = parseIndex(
    [
      "433:550000000:d=2026010612:TMP:2 m above ground:24-42 hour max fcst:95% level",
      "434:552000000:x",
    ].join("\n"),
    "2026-01-06",
    "v43-f042",
  );
  const f066 = parseIndex(
    [
      "433:560000000:d=2026010512:TMP:2 m above ground:48-66 hour max fcst:95% level",
      "434:562000000:x",
    ].join("\n"),
    "2026-01-05",
    "v43-f066",
  );
  assertEquals(f042.rangeStart, 550_000_000);
  assertEquals(f066.rangeStart, 560_000_000);
  assertThrows(
    () =>
      parseIndex(
        "433:560000000:d=2026010512:TMP:2 m above ground:48-66 hour max fcst:95% level\n434:562000000:x",
        "2026-01-05",
        "v43-f042",
      ),
    Error,
    "exactly one",
  );
});

Deno.test("v4.3 workflow is manual, bounded, credential-free, and artifact-only", async () => {
  const workflow = await Deno.readTextFile(".github/workflows/v43-historical-source.yml");
  for (
    const required of [
      "workflow_dispatch:",
      "max-parallel: 2",
      "profile: [v43-f042, v43-f066]",
      "v43HistoricalMarketDateShard",
      "--max-requests 2",
      ".request_policy.actual_requests == 2",
      ".historical_calibration_only == true",
      ".executable_quote_evidence == false",
      ".outcome_evidence == false",
      ".trading_authority == false",
      "retention-days: 30",
      "contents: read",
      "TMPDIR: /var/tmp",
    ]
  ) assertStringIncludes(workflow, required);
  assertEquals(workflow.includes("git push"), false);
  assertEquals(/^\s+schedule:/m.test(workflow), false);
  assertEquals(/^\s+secrets:/m.test(workflow), false);
});
