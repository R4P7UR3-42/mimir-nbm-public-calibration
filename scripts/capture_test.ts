import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { parseIndex, scheduledMarketDate, selectDecodedIdentity } from "./capture.ts";

Deno.test("scheduled capture derives the next market date from the UTC run date", () => {
  assertEquals(scheduledMarketDate(new Date("2026-09-01T20:20:00.000Z")), "2026-09-02");
  assertEquals(scheduledMarketDate(new Date("2026-12-31T23:59:59.999Z")), "2027-01-01");
  assertThrows(() => scheduledMarketDate(new Date("invalid")), Error, "clock");
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
    ]
  ) assertStringIncludes(workflow, required);
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
