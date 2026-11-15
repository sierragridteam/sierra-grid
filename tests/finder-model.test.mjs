import { test } from "node:test";
import assert from "node:assert/strict";

const m = await import("../src/lib/finder-model.ts");
const hit = (kind, id, title = id) => ({ kind, id, title, detail: "", match: null, apiPath: "", url: "", event: null });

test("results are grouped by kind in page order, with every match counted", () => {
  const a = m.finderAnswer({
    // The service's order (roads before events); the page leads with reports.
    hits: [hit("ROAD", "hwy4-a"), hit("ROAD", "hwy4-b"), hit("EVENT", "e1"), hit("EVENT", "e2"), hit("CAMERA", "c1")],
    totals: [{ kind: "ROAD", matches: 2 }, { kind: "EVENT", matches: 22 }, { kind: "MESH_NODE", matches: 0 }, { kind: "CAMERA", matches: 1 }, { kind: "SCANNER", matches: 0 }],
    unavailable: [],
  });
  assert.deepEqual(a.groups.map(g => [g.kind, g.title, g.hits.length, g.total, g.more]), [
    ["EVENT", "Reports", 2, 22, "Showing the best 2 of 22"],
    ["ROAD", "Roads", 2, 2, ""],
    ["CAMERA", "Road cameras", 1, 1, ""],
  ]);
  assert.equal(a.summary, "25 matches: 22 reports, 2 roads and 1 camera");
  assert.equal(a.empty, false);
  assert.equal(a.unsearched, "");
});

test("one match of one kind reads as a sentence", () => {
  const a = m.finderAnswer({ hits: [hit("MESH_NODE", "n1")], totals: [{ kind: "MESH_NODE", matches: 1 }], unavailable: [] });
  assert.equal(a.summary, "1 match: 1 mesh node");
});

test("a kind that could not be searched is said, and is not counted as none", () => {
  const a = m.finderAnswer({ hits: [hit("EVENT", "e1")], totals: [{ kind: "EVENT", matches: 1 }], unavailable: ["CAMERA"] });
  assert.match(a.unsearched, /^Road cameras could not be searched just now\./);
  assert.match(a.unsearched, /does not mean nothing matches/);
  // And when it is all there is: not "nothing matches", the page shows the note.
  const only = m.finderAnswer({ hits: [], totals: [], unavailable: ["CAMERA"] });
  assert.equal(only.empty, true);
  assert.notEqual(only.unsearched, "");
});

test("places and unknown kinds are not shown: Grid has no page for them", () => {
  const a = m.finderAnswer({ hits: [hit("PLACE", "arnold"), hit("EVENT", "e1")], totals: [{ kind: "PLACE", matches: 1 }, { kind: "EVENT", matches: 1 }], unavailable: [] });
  assert.deepEqual(a.groups.map(g => g.kind), ["EVENT"]);
  assert.equal(a.summary, "1 match: 1 report");
});

test("a total the service left out or under-reported never undercounts what is shown", () => {
  const a = m.finderAnswer({ hits: [hit("EVENT", "e1"), hit("EVENT", "e2")], totals: [{ kind: "EVENT", matches: 1 }], unavailable: [] });
  assert.equal(a.groups[0].total, 2);
  assert.equal(a.groups[0].more, "");
  const b = m.finderAnswer({ hits: [hit("ROAD", "r1")], totals: [], unavailable: [] });
  assert.equal(b.groups[0].total, 1);
});

test("nothing found says what was searched and never that conditions are clear", () => {
  const e = m.finderEmpty("volcano", "2026-07-07T00:19:16Z");
  assert.equal(e.title, "Nothing matches “volcano”");
  assert.match(e.body, /^No report kept since July 6, 2026, mesh node, road, camera or scanner feed has those words/);
  assert.match(e.body, /does not establish clear conditions\.$/);
  assert.doesNotMatch(m.finderEmpty("x", null).body, /since/);
});

test("reports and mesh nodes can be listed in full; the link says how many and in what order", () => {
  assert.deepEqual([...m.listedKinds], ["EVENT", "MESH_NODE"]);
  assert.equal(m.allOfKind("EVENT", 1234), "All 1,234 reports, newest first");
  assert.equal(m.allOfKind("MESH_NODE", 7), "All 7 mesh nodes, newest first");
  // A mesh node is a report on the mesh layer; the reports list never mixes the two.
  assert.deepEqual([...m.kindLayers("MESH_NODE")], ["MESH"]);
  assert.equal(m.kindLayers("EVENT").includes("MESH"), false);
  assert.equal(m.kindLayers("EVENT").includes("ROAD_INCIDENT"), true);
  // Every layer the service counts as a report, or the link's total and the list would differ.
  assert.deepEqual([...m.kindLayers("EVENT")].sort(), ["BURN_STATUS", "EARTHQUAKE", "EVACUATION", "POWER", "ROAD_INCIDENT", "WEATHER_ALERT", "WILDFIRE"]);
  assert.deepEqual(m.kindNoun("MESH_NODE"), { one: "mesh node", many: "mesh nodes" });
});

test("an empty full list says past reports were searched too, and never that conditions are clear", () => {
  const e = m.listEmpty("EVENT", "volcano", "2026-07-07T00:19:16Z");
  assert.equal(e.title, "No report matches “volcano”");
  assert.match(e.body, /^No report, current or past, kept since July 6, 2026 has those words\./);
  assert.match(e.body, /does not establish clear conditions\.$/);
  assert.match(m.listEmpty("MESH_NODE", "x", null).body, /^No mesh node has those words\./);
});
