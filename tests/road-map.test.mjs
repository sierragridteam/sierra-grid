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
  assert.equal(entries[0].tone, "alarm");
  assert.deepEqual(entries[0].feature.geometry, marker.geometry);
  assert.equal(entries[1].kind, "route");
  assert.equal(entries[1].tone, "green");
  assert.equal(entries[1].status, "Closure notice attached to route");
  assert.deepEqual(entries[1].feature.geometry, road.geometry);
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
