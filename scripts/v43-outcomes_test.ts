import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  acquireV43OfficialOutcomes,
  frozenDates,
  normalizeDailySummaries,
  parseIsdCatalog,
  writeOutcomeArtifactCreateOnce,
} from "./v43-outcomes.ts";

const stations = JSON.parse(await Deno.readTextFile("data/stations.json"));

function catalog(historyEnd = "20261231") {
  return [
    "USAF,WBAN,STATION NAME,CTRY,STATE,ICAO,LAT,LON,ELEV(M),BEGIN,END",
    ...stations.map((row: Record<string, unknown>, index: number) =>
      `${String(index + 1).padStart(6, "0")},${
        String(index + 1).padStart(5, "0")
      },X,US,,${row.station_id},${row.latitude},${row.longitude},0,20000101,${historyEnd}`
    ),
  ].join("\n");
}

function outcomes() {
  return [...frozenDates()].flatMap((date) =>
    stations.map((row: Record<string, unknown>, index: number) => ({
      STATION: `USW000${String(index + 1).padStart(5, "0")}`,
      DATE: date,
      TMAX: "70",
      LATITUDE: row.latitude,
      LONGITUDE: row.longitude,
    }))
  );
}

Deno.test("acquires exactly two no-retry official outcome sources with complete authority-free coverage", async () => {
  const calls: string[] = [];
  const artifact = await acquireV43OfficialOutcomes({
    stations,
    generatedAt: new Date("2026-09-01T00:00:00.000Z"),
    fetchImpl: (input) => {
      calls.push(String(input));
      return Promise.resolve(calls.length === 1 ? new Response(catalog(), { status: 200 }) : Response.json(outcomes()));
    },
  });
  assertEquals(calls.length, 2);
  assertEquals(artifact.coverage, { stations: 20, market_dates: 100, station_dates: 2_000, complete: true });
  assertEquals(artifact.request_policy, {
    maximum_requests: 2,
    actual_requests: 2,
    no_retry: true,
    terminal_http_429: true,
  });
  assertEquals(artifact.independent_oos, false);
  assertEquals(artifact.trading_authority, false);
  assertEquals(artifact.rows.length, 2_000);
});

Deno.test("outcome acquisition treats 429 and every non-200 as terminal without retry", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      acquireV43OfficialOutcomes({
        stations,
        fetchImpl: () => {
          calls += 1;
          return Promise.resolve(new Response("", { status: 429 }));
        },
      }),
    Error,
    "terminal HTTP 429",
  );
  assertEquals(calls, 1);
});

Deno.test("requires exact station mapping and all 2,000 unique integer outcomes", () => {
  const mappings = parseIsdCatalog(catalog(), stations);
  assertEquals(mappings.size, 20);
  assertEquals(normalizeDailySummaries(outcomes(), stations, mappings).length, 2_000);
  const missing = outcomes().slice(1);
  assertThrows(() => normalizeDailySummaries(missing, stations, mappings), Error, "incomplete");
  const duplicate = [...outcomes(), outcomes()[0]];
  assertThrows(() => normalizeDailySummaries(duplicate, stations, mappings), Error, "duplicate");
  const fractional = outcomes();
  fractional[0].TMAX = "70.5";
  assertThrows(() => normalizeDailySummaries(fractional, stations, mappings), Error, "integer TMAX");
  assertThrows(() => parseIsdCatalog(catalog().replace(",00001,", ",99999,"), stations), Error, "invalid");
});

Deno.test("accepts a stale ISD history end only after exact complete daily-summary proof", () => {
  const mappings = parseIsdCatalog(catalog("20250827"), stations);
  assertEquals(mappings.size, 20);
  assertEquals(mappings.get("KOKC")?.historyEnd, "20250827");
  assertEquals(normalizeDailySummaries(outcomes(), stations, mappings).length, 2_000);
  assertThrows(
    () => normalizeDailySummaries(outcomes().slice(1), stations, mappings),
    Error,
    "coverage is incomplete",
  );
  const missingCoordinates = outcomes();
  delete missingCoordinates[0].LATITUDE;
  assertThrows(
    () => normalizeDailySummaries(missingCoordinates, stations, mappings),
    Error,
    "latitude conflicts",
  );
});

Deno.test("selects the uniquely latest exact WBAN and rejects an equally current conflict", () => {
  const older = catalog("20240101").split("\n").slice(1);
  const combined = `${catalog("20250827")}\n${older.join("\n")}`;
  assertEquals(parseIsdCatalog(combined, stations).get("KOKC")?.historyEnd, "20250827");
  const conflict = `${catalog("20250827")}\n000999,00999,X,US,,KOKC,35.393,-97.601,0,20000101,20250827`;
  assertThrows(() => parseIsdCatalog(conflict, stations), Error, "ambiguous");
});

Deno.test("outcome artifact output is create-once", async () => {
  const directory = await Deno.makeTempDir({ dir: "/var/tmp", prefix: "v43-outcomes-" });
  try {
    const path = `${directory}/outcomes.json`;
    let calls = 0;
    const artifact = await acquireV43OfficialOutcomes({
      stations,
      fetchImpl: () => Promise.resolve(++calls === 1 ? new Response(catalog()) : Response.json(outcomes())),
    });
    await writeOutcomeArtifactCreateOnce(path, artifact);
    await assertRejects(() => writeOutcomeArtifactCreateOnce(path, artifact), Deno.errors.AlreadyExists);
    await assertRejects(
      () => writeOutcomeArtifactCreateOnce(`${directory}/drift.json`, { ...artifact, trading_authority: true }),
      Error,
      "checksum",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
