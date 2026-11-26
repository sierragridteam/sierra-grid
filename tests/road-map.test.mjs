import { test } from "node:test";
import assert from "node:assert/strict";
import { roadMapEntries } from "../src/lib/views/road-map-model.ts";
const feature = (
  id,
  properties = {},
  geometry = { type: "Point", coordinates: [-120, 38] },
) => ({
  type: "Feature",
  geometry,
  properties: {
    id,
    headline: id,
    severity: "MINOR",
    severityRank: 1,
    source: { id: "caltrans", name: "Caltrans" },
    ...properties,
  },
});
const layer = (features) => ({ features });
test("a route closure notice never paints the full monitored route as a closure extent", () => {
  const road = feature(
    "road:example",
    {
      status: "CLOSED",
      road: { roadId: "example" },
      description: "Closed between source landmarks",
    },
    {
      type: "LineString",
      coordinates: [
        [-120, 38],
        [-119, 39],
      ],
    },
  );
  const marker = feature("cc:point", { category: "closed" });
  const entries = roadMapEntries({
    road_segment: layer([road]),
    chain_control: layer([marker]),
  });
  assert.equal(entries[0].kind, "restriction");
  // The closure point is as loud as the source rates it: a pass closure it rates MINOR is not an alarm.
  assert.equal(entries[0].tone, "brass");
  assert.equal(roadMapEntries({ chain_control: layer([feature("cc:severe", { category: "closed", severity: "SEVERE", severityRank: 3 })]) })[0].tone, "alarm");
  assert.deepEqual(entries[0].feature.geometry, marker.geometry);
  assert.equal(entries[1].kind, "route");
  assert.equal(entries[1].tone, "green");
  assert.equal(entries[1].status, "Closure notice attached to route");
  assert.deepEqual(entries[1].feature.geometry, road.geometry);
});
test("a closure point is seasonal only when the source says so", () => {
  const status = (properties) => roadMapEntries({ chain_control: layer([feature("cc:10-2514", { category: "closed", severity: "INFO", severityRank: 0, headline: "Highway 4: Ebbetts Pass winter closure", ...properties })]) })[0];
  const gate = status({ chainControl: { highway: "Highway 4", seasonal: true, closure: "Ebbetts Pass winter closure" } });
  assert.equal(gate.status, "Seasonal closure point");
  assert.equal(gate.label, "Highway 4: Ebbetts Pass winter closure");
  assert.equal(gate.tone, "brass");
  // No flag, a false one, or a flag on something that is not a closure: not seasonal.
  assert.equal(status({ chainControl: { highway: "Highway 108" } }).status, "Reported closure point");
  assert.equal(status({ chainControl: { seasonal: false } }).status, "Reported closure point");
  assert.equal(status({}).status, "Reported closure point");
  assert.equal(status({ category: "r2", chainControl: { level: "R2", seasonal: true } }).status, "R2");
});
test("current road map excludes scheduled work, keeps active unlocated incidents and never invents geometry", () => {
  const entries = roadMapEntries({
    road_incident: layer([
      feature("now", { status: "ACTIVE" }, null),
      feature("later", { status: "SCHEDULED" }),
      feature("resolved", { status: "RESOLVED" }),
    ]),
  });
  assert.deepEqual(
    entries.map((e) => e.feature.properties.id),
    ["now"],
  );
  assert.equal(entries[0].feature.geometry, null);
});
