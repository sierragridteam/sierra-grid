import { test } from "node:test";
import assert from "node:assert/strict";
import { roadRecord, sourceChanges, sourceSince } from "../src/lib/record-model.ts";
import { burnReadings, reportProfile } from "../src/lib/report-profile.ts";
import { isReading, typeLabel } from "../src/lib/event-model.ts";

const rev = (revision, observedAt, event, kind = "CHANGE") => ({ revision, kind, observedAt, ingestedAt: observedAt, event: { revision, status: "ACTIVE", severity: "INFO", ...event } });
const health = (id, name, status, since, error = "") => ({ id: `source:${id}`, layer: "SOURCE_HEALTH", areaLabel: name, sourceHealth: { sourceId: id, status, since, error } });

test("source changes are the status turns, newest first, without where recording began", () => {
  const changes = sourceChanges([
    rev(3, "2026-11-16T10:00:00Z", health("nws", "National Weather Service", "OK", "2026-11-16T10:00:00Z")),
    rev(2, "2026-11-16T08:00:00Z", health("nws", "National Weather Service", "UNAVAILABLE", "2026-11-16T08:00:00Z", "HTTP 503")),
    rev(1, "2026-11-15T00:00:00Z", health("nws", "National Weather Service", "OK", "2026-11-15T00:00:00Z")),
    rev(2, "2026-11-16T09:00:00Z", health("pge", "PG&E", "STALE", "2026-11-16T09:00:00Z", "stamp is 2h old")),
  ]);
  assert.deepEqual(changes.map((c) => [c.label, c.detail, c.tone]), [
    ["National Weather Service is readable again", undefined, "ok"],
    ["PG&E went stale", "stamp is 2h old", "elevated"],
    ["National Weather Service went unavailable", "HTTP 503", "alarm"],
  ]);
});

test("since when each source has held its status comes from its health event", () => {
  const since = sourceSince([
    { ...health("nws", "NWS", "OK", "2026-11-16T10:00:00Z"), status: "ACTIVE" },
    { ...health("old", "Retired feed", "OK", "2026-11-01T10:00:00Z"), status: "RESOLVED" },
    { id: "burn:x", layer: "BURN_STATUS", status: "ACTIVE" },
  ]);
  assert.deepEqual([...since.keys()], ["nws"]);
  assert.equal(since.get("nws").since, Date.parse("2026-11-16T10:00:00Z"));
});

const chain = (id, level, from, to, extra = {}) => ({ id, layer: "CHAIN_CONTROL", effective: "2026-11-16T14:10:00Z", chainControl: { level, highway: "Highway 4", from: { place: from }, to: { place: to } }, ...extra });
const road = (status, congestion, beyond = []) => ({ id: "road:hwy4-arnold-bearvalley", layer: "ROAD_SEGMENT", roadSegment: { name: "Hwy 4", section: "Arnold to Bear Valley", status, congestion, beyond } });

test("the road record reads a storm in order: posted, extended, raised, lifted", () => {
  const record = roadRecord([
    rev(3, "2026-11-17T06:00:00Z", chain("cc:hwy4:r3", "R3", "Bear Valley", "Mount Reba Road", { status: "RESOLVED" })),
    rev(1, "2026-11-16T20:00:00Z", chain("cc:hwy4:r3", "R3", "Bear Valley", "Mount Reba Road", { effective: "2026-11-16T19:50:00Z" })),
    rev(3, "2026-11-16T20:00:00Z", chain("cc:hwy4:r2", "R2", "Camp Connell", "Mount Reba Road", { status: "RESOLVED" })),
    rev(2, "2026-11-16T16:00:00Z", chain("cc:hwy4:r2", "R2", "Camp Connell", "Mount Reba Road")),
    rev(1, "2026-11-16T14:20:00Z", chain("cc:hwy4:r2", "R2", "Poison Springs", "Mount Reba Road")),
  ]);
  assert.deepEqual(record.map((e) => [e.label, e.detail]), [
    ["R3 lifted", "Hwy 4, Bear Valley to Mount Reba Road"],
    ["R2 lifted", "Hwy 4, Camp Connell to Mount Reba Road"],
    ["R3 posted", "Hwy 4, Bear Valley to Mount Reba Road"],
    ["R2 now Camp Connell to Mount Reba Road", "Hwy 4 · was Poison Springs to Mount Reba Road"],
    ["R2 posted", "Hwy 4, Poison Springs to Mount Reba Road"],
  ]);
  assert.equal(record[4].at, Date.parse("2026-11-16T14:10:00Z"), "posted at the source's time, not when Grid saw it");
  assert.equal(record[2].tone, "alarm");
});

test("a road's record is its closures, reopenings and seasonal closures, not where recording began", () => {
  const winter = [{ name: "Ebbetts Pass winter closure" }];
  const record = roadRecord([
    rev(5, "2026-11-17T09:00:00Z", road("OPEN", "CLEAR", winter)),
    rev(4, "2026-11-17T08:00:00Z", road("OPEN", "HEAVY", winter)),
    rev(3, "2026-11-17T07:00:00Z", road("OPEN", "CLEAR", winter)),
    rev(2, "2026-11-16T18:30:00Z", road("OPEN", "CLEAR")),
    rev(1, "2026-11-10T00:00:00Z", road("CLOSED", "CLEAR")),
  ]);
  assert.deepEqual(record.map((e) => e.label), [
    "Hwy 4 Arnold to Bear Valley: traffic clear",
    "Hwy 4 Arnold to Bear Valley: traffic heavy",
    "Ebbetts Pass winter closure in effect",
    "Hwy 4 Arnold to Bear Valley reopened",
  ]);
  // Without the revision before it, a row says the state rather than guess the change.
  assert.equal(roadRecord([rev(7, "2026-11-17T08:00:00Z", road("CLOSED", "CLEAR"))])[0].label, "Hwy 4 Arnold to Bear Valley: closed");
});

const burn = (revision, kind, at, calls) => rev(revision, at, { id: "burn:calaveras-county", layer: "BURN_STATUS", burnStatus: { burnDay: "BURN_DAY_YES", permission: "BURN_PERMISSION_ALLOWED", burnLines: Object.entries(calls).map(([id, [time, message]]) => ({ id, name: `${id} line`, burnDay: "BURN_DAY_YES", observation: { observedAt: time, message } })) } }, kind);

test("each call that repeated the burn answer is a reading at the time of the call", () => {
  const revisions = [
    burn(4, "READING", "2026-11-16T20:10:00Z", { a: ["2026-11-16T19:43:00Z", "a, the 16th"], b: ["2026-11-16T20:05:00Z", "b, the 16th"] }),
    burn(3, "READING", "2026-11-16T19:50:00Z", { a: ["2026-11-16T19:43:00Z", "a, the 16th"], b: ["2026-11-15T20:00:00Z", "b, the 15th"] }),
    burn(2, "CHANGE", "2026-11-15T20:10:00Z", { a: ["2026-11-15T19:41:00Z", "a, the 15th"], b: ["2026-11-15T20:00:00Z", "b, the 15th"] }),
  ];
  assert.ok(isReading(revisions[0]) && !isReading(revisions[2]));
  assert.deepEqual(burnReadings(revisions).map((e) => [new Date(e.at).toISOString(), e.label, e.detail]), [
    ["2026-11-16T20:05:00.000Z", "Checked: Burn day", "b, the 16th"],
    ["2026-11-16T19:43:00.000Z", "Checked: Burn day", "a, the 16th"],
  ]);
  const profile = reportProfile({ ...revisions[0].event, revision: 4, readings: 2, provenance: {}, ingestedAt: "2026-11-16T20:10:00Z" }, revisions, Date.parse("2026-11-16T22:00:00Z"));
  assert.ok(profile.timeline.some((m) => m.label === "Checked: Burn day" && m.detail === "a, the 16th"), "an earlier call is on the timeline");
});

test("the new report types have a profile and a name", () => {
  const now = Date.parse("2026-11-16T22:00:00Z");
  const envelope = { status: "ACTIVE", severity: "MODERATE", provenance: {}, ingestedAt: "2026-11-16T14:20:00Z", revision: 1 };
  const cc = reportProfile({ ...envelope, ...chain("cc:hwy4:r2", "R2", "Poison Springs", "Mount Reba Road"), chainControl: { level: "R2", highway: "Highway 4", from: { place: "Poison Springs" }, to: { place: "Mount Reba Road" }, signs: [{ place: "POISON SPRINGS", direction: "Eastbound", level: "R2" }] } }, [], now);
  assert.deepEqual(cc.stats.map((s) => [s.label, s.value]), [["Requirement", "R2"], ["In effect for", "7 h 50 m"], ["Checkpoints", "1"]]);
  assert.equal(cc.subtitle, "Highway 4 · Poison Springs to Mount Reba Road");
  const rs = reportProfile({ ...envelope, ...road("CLOSED", "CLEAR") }, [], now);
  assert.equal(rs.stats[0].value, "Closed");
  const sh = reportProfile({ ...envelope, revision: 3, ...health("nws", "NWS", "UNAVAILABLE", "2026-11-16T20:00:00Z", "HTTP 503"), sourceHealth: { sourceId: "nws", status: "UNAVAILABLE", since: "2026-11-16T20:00:00Z", error: "HTTP 503", lastSuccessAt: "2026-11-16T19:55:00Z" } }, [], now);
  assert.deepEqual(sh.stats.map((s) => [s.label, s.value]), [["Status", "Unavailable"], ["Last good reading", "2 h 05 m ago"], ["Changes on record", "2"]]);
  assert.equal(typeLabel("SOURCE_HEALTH"), "Source health");
  assert.equal(typeLabel("CHAIN_CONTROL"), "Chain control");
});
