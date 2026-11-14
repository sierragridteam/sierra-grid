import { test } from "node:test";
import assert from "node:assert/strict";
import { parseState, changeView, stateUrl } from "../src/lib/state.ts";
const now = Date.parse("2026-11-08T12:00:00Z");
test("domain defaults differ until a user chooses an explicit interval", () => {
  const roads = parseState(new URL("https://grid.test/roads/"), now);
  assert.equal(roads.mode, "now");
  assert.equal(changeView(roads, "changes", now).mode, "history");
  assert.equal(changeView(roads, "weather", now).mode, "future");
  const pinned = {
    ...roads,
    timeExplicit: true,
    node: "a".repeat(64),
    compare: "b".repeat(64),
  };
  const next = changeView(pinned, "WILDFIRE", now + 1000);
  assert.equal(next.mode, "now");
  assert.equal(next.from, pinned.from);
  assert.equal(next.to, pinned.to);
  assert.equal(next.node, pinned.node);
  assert.equal(next.compare, pinned.compare);
});
test("shared URLs roundtrip selected population, interval, mode and source record", () => {
  const state = {
    ...parseState(new URL("https://grid.test/mesh/"), now),
    timeExplicit: true,
    mode: "history",
    node: "a".repeat(64),
    compare: "b".repeat(64),
    record: "calfire:with:colons",
  };
  assert.deepEqual(
    parseState(new URL(stateUrl(state), "https://grid.test"), now),
    state,
  );
});
test("the weather town travels only on the pages that use it", () => {
  const weather = { ...parseState(new URL("https://grid.test/weather/"), now), weatherLocation: "arnold" };
  assert.equal(parseState(new URL(stateUrl(weather), "https://grid.test"), now).weatherLocation, "arnold");
  assert.equal(new URL(stateUrl({ ...weather, topic: "sources" }), "https://grid.test").search, "");
  assert.equal(new URL(stateUrl({ ...weather, topic: "roads" }), "https://grid.test").searchParams.has("weatherLocation"), false);
});
test("URLs carry only state that differs from the destination's own defaults", () => {
  const overview = parseState(new URL("https://grid.test/"), now);
  assert.equal(stateUrl(overview), "/");
  assert.equal(stateUrl({ ...overview, weatherLocation: "arnold" }), "/?weatherLocation=arnold");
  const events = { ...parseState(new URL("https://grid.test/events/"), now), layer: "POWER" };
  assert.equal(stateUrl(events), "/events/?layer=POWER");
  assert.equal(parseState(new URL(stateUrl(events), "https://grid.test"), now).layer, "POWER");
  // A non-explicit lens is recomputed on arrival, so it is not written down.
  assert.equal(new URL(stateUrl(changeView(events, "mesh", now)), "https://grid.test").search, "");
});
test("malformed state cannot inject arbitrary keys or produce invalid dates/metric", () => {
  const state = parseState(
    new URL(
      "https://grid.test/mesh/?from=invalid&to=oops&metric=__proto__&node=bad&place=%22%3E",
    ),
    now,
  );
  assert.equal(state.metric, "batteryVolts");
  assert.equal(state.node, "");
  assert.equal(state.place, "ebbetts-pass");
  assert.ok(Number.isFinite(Date.parse(state.from)));
  assert.doesNotThrow(() =>
    parseState(new URL("https://grid.test/?q=%7Bbroken"), now),
  );
});
test("legacy B query links retain their explicit historical intent", () => {
  const q = encodeURIComponent(
    JSON.stringify({
      topic: "weather",
      mode: "history",
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-02T00:00:00Z",
    }),
  );
  const state = parseState(new URL("https://grid.test/?q=" + q), now);
  assert.equal(state.topic, "weather");
  assert.equal(state.mode, "history");
  assert.equal(state.timeExplicit, true);
});

test("Grid always queries the corridor and removes arbitrary API place scope from shared links", () => {
  const state = parseState(
    new URL("https://grid.test/roads/?place=calaveras-county"),
    now,
  );
  assert.equal(state.place, "ebbetts-pass");
  assert.equal(
    new URL(stateUrl(state), "https://grid.test").searchParams.has("place"),
    false,
  );
});
