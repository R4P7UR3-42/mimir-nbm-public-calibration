import { assertEquals, assertThrows } from "@std/assert";
import { parseIndex } from "./capture.ts";

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
