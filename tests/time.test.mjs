import { test } from "node:test";
import assert from "node:assert/strict";
import { regionalTime, localInput, parseLocalInput } from "../src/lib/time.ts";
import { temperature } from "../src/lib/weather-display.ts";
test("Pacific date inputs cross UTC dates and reject missing spring-forward times", () => {
  assert.equal(localInput("2026-11-08T02:30:00Z"), "2026-11-07T18:30");
  assert.equal(
    parseLocalInput("2026-11-07T18:30"),
    Date.parse("2026-11-08T02:30:00Z"),
  );
  assert.ok(Number.isNaN(parseLocalInput("2026-03-08T02:30")));
  assert.equal(
    parseLocalInput("2026-11-01T01:30"),
    Date.parse("2026-11-01T08:30:00Z"),
  );
  assert.equal(regionalTime("2026-11-08T21:00:00Z").includes("13:00 PT"), true);
});
test("temperature conversion preserves zero and negative numeric measurements", () => {
  assert.equal(temperature(0, "F"), 32);
  assert.equal(temperature(-40, "F"), -40);
  assert.equal(temperature(18, "F"), 64.4);
  assert.equal(temperature(18, "C"), 18);
});
