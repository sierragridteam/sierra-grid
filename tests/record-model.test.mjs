import { test } from "node:test";
import assert from "node:assert/strict";
import {
  failedRead, isOwnService, nextRead, pagedReader, recordList, recordWindow, roadRecord, roadRecordPanel, settle, sourceChanges, sourceRecord, sourceSince,
} from "../src/lib/record-model.ts";
import { burnReadings, readingCalls, reportProfile } from "../src/lib/report-profile.ts";
import { isReading, typeLabel } from "../src/lib/event-model.ts";

const rev = (revision, observedAt, event, kind = "CHANGE") => ({ revision, kind, observedAt, ingestedAt: observedAt, event: { revision, status: "ACTIVE", severity: "INFO", ...event } });
const health = (id, name, status, since, error = "") => ({ id: `source:${id}`, layer: "SOURCE_HEALTH", areaLabel: name, sourceHealth: { sourceId: id, status, since, error } });
const badges = (entries) => entries.map((e) => [e.badge.label, e.badge.tone]);

// ---- Reading the record ---------------------------------------------------

test("the record's period is on whole hours, so the request repeats between refreshes", () => {
  const a = recordWindow(Date.parse("2026-11-17T00:41:28Z"), 7), b = recordWindow(Date.parse("2026-11-17T00:51:28Z"), 7);
  assert.deepEqual(a, { from: "2026-11-10T00:00:00.000Z", to: "2026-11-17T01:00:00.000Z" });
  assert.deepEqual(a, b, "ten minutes later, the same request");
  assert.notDeepEqual(a, recordWindow(Date.parse("2026-11-17T01:01:00Z"), 7), "a new hour is a new request");
  assert.equal(recordWindow(Date.parse("2026-11-17T01:00:00Z"), 1).to, "2026-11-17T01:00:00.000Z");
});

test("a paged read follows the next token up to its cap and says when the service had more", async () => {
  const pages = { "": { items: [1, 2], next: "b" }, b: { items: [3], next: "c" }, c: { items: [4], next: "d" }, d: { items: [5], next: "" } };
  const asked = [];
  const read = async (token, etag) => { asked.push([token, etag]); return { notModified: false, ...pages[token], etag: "v1" }; };
  assert.deepEqual(await pagedReader(3)("k", read), { items: [1, 2, 3, 4], incomplete: true });
  assert.deepEqual(await pagedReader(4)("k", read), { items: [1, 2, 3, 4, 5], incomplete: false });
  assert.deepEqual(await pagedReader(1)("k", async () => ({ notModified: false, items: [1], next: "", etag: null })), { items: [1], incomplete: false });
  assert.equal(asked[0][1], undefined, "the first read has no ETag to send");
});

test("an unchanged answer is a 304: the ETag goes with the same request only, and never after a failure", async () => {
  const reader = pagedReader(3), sent = [];
  let fail = false, refuseConditional = false;
  const read = async (token, etag) => {
    sent.push(etag);
    if (fail) throw new Error("network");
    if (etag && refuseConditional) throw new TypeError("preflight refused");
    return etag === "v1" ? { notModified: true } : { notModified: false, items: ["x"], next: "", etag: "v1" };
  };
  assert.deepEqual(await reader("hour-1", read), { items: ["x"], incomplete: false });
  assert.equal(await reader("hour-1", read), "unchanged");
  assert.equal(await reader("hour-1", read), "unchanged", "an unchanged answer keeps its ETag");
  assert.deepEqual(await reader("hour-2", read), { items: ["x"], incomplete: false }, "another period is another question");
  assert.deepEqual(sent, [undefined, "v1", "v1", undefined]);
  fail = true;
  await assert.rejects(reader("hour-2", read));
  fail = false; sent.length = 0;
  assert.deepEqual(await reader("hour-2", read), { items: ["x"], incomplete: false });
  assert.deepEqual(sent, [undefined], "after a failure the next read is unconditional, so it cannot answer 'unchanged' to nothing");
  refuseConditional = true; sent.length = 0;
  assert.deepEqual(await reader("hour-2", read), { items: ["x"], incomplete: false }, "a refused conditional request is asked again plainly");
  assert.deepEqual(sent, ["v1", undefined]);
});

test("a read is not read yet, failed or answered; a failure keeps the last answer and its time", () => {
  const loading = { state: "loading" };
  const ok = nextRead(loading, { ok: true, value: [1] }, 100);
  assert.deepEqual(ok, { state: "ok", value: [1], asOf: 100 });
  assert.deepEqual(nextRead(ok, { ok: true, value: "unchanged" }, 200), { state: "ok", value: [1], asOf: 200 }, "a 304 confirms what is held");
  assert.deepEqual(nextRead(ok, { ok: false }, 300), { state: "failed", last: [1], asOf: 100 });
  assert.deepEqual(nextRead(loading, { ok: false }, 300), { state: "failed" });
  assert.deepEqual(failedRead(failedRead(ok)), { state: "failed", last: [1], asOf: 100 }, "a second failure does not move the time");
  assert.deepEqual(settle({ status: "fulfilled", value: { items: [1], incomplete: false } }, (v) => v.items), { ok: true, value: [1] });
  assert.deepEqual(settle({ status: "fulfilled", value: "unchanged" }, (v) => v.items), { ok: true, value: "unchanged" });
  assert.deepEqual(settle({ status: "rejected", reason: new Error("x") }, (v) => v), { ok: false });
});

test("a list says how many entries it hides only when it read the whole period", () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ at: i, id: "x", revision: i, label: "l", badge: { label: "b", tone: "ok" } }));
  assert.deepEqual(recordList(entries, 3, false), { shown: entries.slice(0, 3), note: "2 earlier entries in this period not shown." });
  assert.equal(recordList(entries, 4, false).note, "1 earlier entry in this period not shown.");
  assert.equal(recordList(entries, 5, false).note, "");
  assert.equal(recordList(entries, 3, true).note, "Older entries not loaded: this list is incomplete.");
  assert.equal(recordList(entries, 9, true).note, "Older entries not loaded: this list is incomplete.", "incomplete is said even when nothing loaded is hidden");
});

// ---- Source health --------------------------------------------------------

test("source changes are the status turns in the page's own words, newest first, without where recording began", () => {
  const changes = sourceChanges([
    rev(3, "2026-11-16T10:00:00Z", health("nws", "National Weather Service", "OK", "2026-11-16T10:00:00Z")),
    rev(2, "2026-11-16T08:00:00Z", health("nws", "National Weather Service", "UNAVAILABLE", "2026-11-16T08:00:00Z", "HTTP 503")),
    rev(1, "2026-11-15T00:00:00Z", health("nws", "National Weather Service", "OK", "2026-11-15T00:00:00Z")),
    rev(2, "2026-11-16T09:00:00Z", health("pge", "PG&E", "STALE", "2026-11-16T09:00:00Z", "stamp is 2h old")),
  ]);
  assert.deepEqual(changes.map((c) => [c.label, c.detail, c.badge.label, c.badge.tone]), [
    ["National Weather Service", undefined, "Current again", "ok"],
    ["PG&E", "stamp is 2h old", "Stale", "elevated"],
    ["National Weather Service", "HTTP 503", "Unavailable", "alarm"],
  ]);
});

test("a source that fails the same way again gives its reason once, on the newest entry; older ones point at it", () => {
  const err = "partial chain-control data: cwwp2 chain controls: cwwp2: GET https://cwwp2.dot.ca.gov/data/d10/cc/ccStatusD10.json: HTTP 500";
  const changes = sourceChanges([
    rev(7, "2026-11-18T20:36:00Z", health("cc", "Caltrans (chain control)", "OK", "2026-11-18T20:36:00Z")),
    rev(6, "2026-11-18T20:31:00Z", health("cc", "Caltrans (chain control)", "STALE", "2026-11-18T20:31:00Z", err)),
    rev(5, "2026-11-18T19:21:00Z", health("cc", "Caltrans (chain control)", "OK", "2026-11-18T19:21:00Z")),
    rev(4, "2026-11-18T19:16:00Z", health("cc", "Caltrans (chain control)", "STALE", "2026-11-18T19:16:00Z", err)),
    rev(3, "2026-11-18T18:36:00Z", health("cc", "Caltrans (chain control)", "OK", "2026-11-18T18:36:00Z")),
    rev(2, "2026-11-18T18:31:00Z", health("cc", "Caltrans (chain control)", "STALE", "2026-11-18T18:31:00Z", err)),
    // Another source with the same words is its own reason; the same source with another reason keeps it.
    rev(4, "2026-11-18T18:00:00Z", health("lcs", "Caltrans (lane closures)", "STALE", "2026-11-18T18:00:00Z", err)),
    rev(3, "2026-11-18T17:00:00Z", health("lcs", "Caltrans (lane closures)", "OK", "2026-11-18T17:00:00Z")),
    rev(2, "2026-11-18T16:00:00Z", health("lcs", "Caltrans (lane closures)", "STALE", "2026-11-18T16:00:00Z", "HTTP 502")),
  ]);
  const stale = changes.filter((c) => c.badge.label === "Stale").map((c) => [c.id, c.detail, c.sameReasonAs && new Date(c.sameReasonAs).toISOString()]);
  assert.deepEqual(stale, [
    ["source:cc", err, undefined],
    ["source:cc", undefined, "2026-11-18T20:31:00.000Z"],
    ["source:cc", undefined, "2026-11-18T20:31:00.000Z"],
    ["source:lcs", err, undefined],
    ["source:lcs", "HTTP 502", undefined],
  ]);
});

test("a status this build does not know is shown as sent and muted; a revision that kept the status is not a change", () => {
  const changes = sourceChanges([
    rev(4, "2026-11-16T12:00:00Z", health("nws", "NWS", "DEGRADED", "2026-11-16T12:00:00Z")),
    rev(3, "2026-11-16T11:00:00Z", health("nws", "NWS", "UNAVAILABLE", "2026-11-16T08:00:00Z", "HTTP 502")),
    rev(2, "2026-11-16T08:00:00Z", health("nws", "NWS", "UNAVAILABLE", "2026-11-16T08:00:00Z", "HTTP 503")),
  ]);
  assert.deepEqual(badges(changes), [["Degraded", "muted"], ["Unavailable", "alarm"]]);
  assert.deepEqual(sourceChanges([rev(2, "2026-11-16T08:00:00Z", health("x", "X", "SOURCE_STATUS_UNSPECIFIED", "2026-11-16T08:00:00Z"))])[0].badge, { label: "Not read yet", tone: "muted" });
});

test("since when a source has held its status: a health event never revised only says when recording began", () => {
  const since = sourceSince([
    { ...health("nws", "NWS", "OK", "2026-11-16T10:00:00Z"), status: "ACTIVE", revision: 3 },
    { ...health("pge", "PG&E", "OK", "2026-11-15T00:00:00Z"), status: "ACTIVE", revision: 1 },
    { ...health("old", "Retired feed", "OK", "2026-11-01T10:00:00Z"), status: "RESOLVED", revision: 2 },
    { id: "burn:x", layer: "BURN_STATUS", status: "ACTIVE" },
  ]);
  assert.deepEqual([...since.keys()], ["nws", "pge"]);
  assert.deepEqual(since.get("nws"), { status: "OK", since: Date.parse("2026-11-16T10:00:00Z"), eventId: "source:nws", recordedOnly: false });
  assert.equal(since.get("pge").recordedOnly, true);
});

test("the service's own row is not an upstream feed", () => {
  assert.equal(isOwnService({ id: "grid", kind: "INTERNAL" }), true);
  assert.equal(isOwnService({ id: "nws", kind: "FEED" }), false);
  assert.equal(isOwnService({ id: "relay", kind: "REPORTER" }), false);
  assert.equal(isOwnService({ id: "old-api" }), false);
});

const from = Date.parse("2026-10-18T00:00:00Z");
const event = (id, status, since, revision) => ({ ...health(id, id.toUpperCase(), status, since), status: "ACTIVE", revision });
const okRead = (value) => ({ state: "ok", value, asOf: 1000 });
const pagesOf = (revisions, incomplete = false) => ({ revisions, incomplete });

test("the Sources record: not read yet says nothing; the API keeping none is said only when both reads answered empty", () => {
  const loading = sourceRecord({ events: { state: "loading" }, history: { state: "loading" }, days: 30, from });
  assert.deepEqual([loading.panel, loading.footnote, loading.held.size], [undefined, "", 0]);
  const none = sourceRecord({ events: okRead([]), history: okRead(pagesOf([])), days: 30, from });
  assert.deepEqual([none.panel, none.footnote], [undefined, "No uptime history is kept."]);
});

test("the Sources record: a failed history read is said in the panel, never as 'no uptime history'", () => {
  const events = okRead([event("nws", "OK", "2026-11-16T10:00:00Z", 3)]);
  const failed = sourceRecord({ events, history: { state: "failed" }, days: 30, from });
  assert.equal(failed.panel.message, "The record of status changes could not be read right now.");
  assert.match(failed.footnote, /^Status changes are kept/);
  assert.equal(failed.held.size, 1, "the health events were read, so 'since' still shows");
  const both = sourceRecord({ events: { state: "failed" }, history: { state: "failed" }, days: 30, from });
  assert.equal(both.panel.message, "The record of status changes could not be read right now.");
  assert.equal(both.footnote, "", "whether a record is kept is not known");
});

test("the Sources record: the panel shows when the events read failed, and no 'since' survives that failure", () => {
  const history = okRead(pagesOf([
    rev(3, "2026-11-16T10:00:00Z", health("nws", "NWS", "OK", "2026-11-16T10:00:00Z")),
    rev(2, "2026-11-16T08:00:00Z", health("nws", "NWS", "UNAVAILABLE", "2026-11-16T08:00:00Z", "HTTP 503")),
  ]));
  const stale = { state: "failed", last: [event("nws", "UNAVAILABLE", "2026-11-16T08:00:00Z", 2)], asOf: 500 };
  const record = sourceRecord({ events: stale, history, days: 30, from });
  assert.equal(record.held.size, 0, "a 'since' from before the failed refresh is not shown");
  assert.deepEqual(badges(record.panel.entries), [["Current again", "ok"], ["Unavailable", "alarm"]]);
  assert.equal(record.panel.kicker, "Up to the last 30 days, as Grid saw them", "without the health events, when recording began is not known");
  const empty = sourceRecord({ events: { state: "failed" }, history: okRead(pagesOf([])), days: 30, from });
  assert.equal(empty.panel.message, "No status change is on record in the last 30 days. When recording began could not be read.");
});

test("the Sources record: 30 days is claimed only when recording began before them", () => {
  const first = (id, at) => rev(1, at, health(id, id, "OK", at));
  // Every feed's revision 1 is inside the period: recording began on Nov 16.
  const young = sourceRecord({ events: okRead([event("nws", "OK", "2026-11-16T23:34:24Z", 1), event("pge", "OK", "2026-11-16T23:34:13Z", 1)]),
    history: okRead(pagesOf([first("nws", "2026-11-16T23:34:24Z"), first("pge", "2026-11-16T23:34:13Z")])), days: 30, from });
  assert.equal(young.panel.kicker, "Since recording began on Nov 16, as Grid saw them");
  assert.equal(young.panel.message, "No source changed status since recording began on Nov 16.");
  // One feed has been revised and its revision 1 is older than the period: the whole period is covered.
  const old = sourceRecord({ events: okRead([event("nws", "OK", "2026-11-16T10:00:00Z", 3), event("pge", "OK", "2026-11-16T23:34:13Z", 1)]),
    history: okRead(pagesOf([rev(3, "2026-11-16T10:00:00Z", health("nws", "NWS", "OK", "2026-11-16T10:00:00Z")), rev(2, "2026-11-16T08:00:00Z", health("nws", "NWS", "STALE", "2026-11-16T08:00:00Z"))])), days: 30, from });
  assert.equal(old.panel.kicker, "Last 30 days, as Grid saw them");
  // A feed never revised whose recording began before the period.
  const quiet = sourceRecord({ events: okRead([event("nws", "OK", "2026-09-01T00:00:00Z", 1)]), history: okRead(pagesOf([])), days: 30, from });
  assert.equal(quiet.panel.message, "No source changed status in the last 30 days.");
  assert.equal(quiet.held.get("nws").recordedOnly, true);
});

test("the Sources record: part of the period unread is said, and a failed refresh keeps the list with its time", () => {
  const revisions = [rev(2, "2026-11-16T08:00:00Z", health("nws", "NWS", "STALE", "2026-11-16T08:00:00Z")), rev(1, "2026-11-15T08:00:00Z", health("nws", "NWS", "OK", "2026-11-15T08:00:00Z"))];
  const events = okRead([event("nws", "STALE", "2026-11-16T08:00:00Z", 2)]);
  const partial = sourceRecord({ events, history: okRead(pagesOf(revisions, true)), days: 30, from });
  assert.equal(partial.panel.kicker, "Up to the last 30 days, as Grid saw them");
  assert.equal(partial.panel.note, "Older entries not loaded: this list is incomplete.");
  assert.equal(sourceRecord({ events, history: okRead(pagesOf([], true)), days: 30, from }).panel.message, "No status change in the part of the record that was loaded. Older entries not loaded.");
  const stale = sourceRecord({ events, history: { state: "failed", last: pagesOf(revisions), asOf: 4242 }, days: 30, from });
  assert.equal(stale.panel.staleAsOf, 4242);
  assert.equal(stale.panel.entries.length, 1);
});

// ---- Roads ----------------------------------------------------------------

const chain = (id, level, from, to, extra = {}) => ({ id, layer: "CHAIN_CONTROL", effective: "2026-11-16T14:10:00Z", chainControl: { level, highway: "Highway 4", from: { place: from }, to: { place: to } }, ...extra });
const road = (status, beyond = [], id = "road:hwy4-arnold-bearvalley") => ({ id, layer: "ROAD_SEGMENT", roadSegment: { name: "Hwy 4", section: "Arnold to Bear Valley", status, beyond } });

test("the road record reads a storm in order: posted, changed, raised, lifted", () => {
  const record = roadRecord([
    rev(3, "2026-11-17T06:00:00Z", chain("cc:hwy4:r3", "R3", "Bear Valley", "Mount Reba Road", { status: "RESOLVED" })),
    rev(2, "2026-11-16T22:00:00Z", chain("cc:hwy4:r3", "R3", "Bear Valley", "Mount Reba Road", { effective: "2026-11-16T19:50:00Z" })), // a sign inside the stretch
    rev(1, "2026-11-16T20:00:00Z", chain("cc:hwy4:r3", "R3", "Bear Valley", "Mount Reba Road", { effective: "2026-11-16T19:50:00Z" })),
    rev(3, "2026-11-16T20:00:00Z", chain("cc:hwy4:r2", "R2", "Camp Connell", "Mount Reba Road", { status: "RESOLVED" })),
    rev(2, "2026-11-16T16:00:00Z", chain("cc:hwy4:r2", "R2", "Camp Connell", "Mount Reba Road")),
    rev(1, "2026-11-16T14:20:00Z", chain("cc:hwy4:r2", "R2", "Poison Springs", "Mount Reba Road")),
  ]);
  assert.deepEqual(record.map((e) => [e.label, e.detail, e.badge.label]), [
    ["R3 lifted", "Hwy 4, Bear Valley to Mount Reba Road", "Lifted"],
    ["R2 lifted", "Hwy 4, Camp Connell to Mount Reba Road", "Lifted"],
    ["R3 posted", "Hwy 4, Bear Valley to Mount Reba Road", "Posted"],
    ["R2 now Camp Connell to Mount Reba Road", "Hwy 4 · was Poison Springs to Mount Reba Road", "Changed"],
    ["R2 posted", "Hwy 4, Poison Springs to Mount Reba Road", "Posted"],
  ]);
  assert.equal(record[4].at, Date.parse("2026-11-16T14:10:00Z"), "posted at the source's time, not when Grid saw it");
  assert.deepEqual(badges(record).map(([, tone]) => tone), ["ok", "ok", "alarm", "elevated", "elevated"]);
});

test("without the revision before it, a chain entry says the state and claims no change", () => {
  // Revision 5 alone: a sign may be all that changed, so the stretch is not said to have moved.
  const lone = roadRecord([rev(5, "2026-11-17T08:00:00Z", chain("cc:hwy4:r2", "R2", "Camp Connell", "Tamarack"))]);
  assert.deepEqual(lone.map((e) => [e.label, e.detail, e.badge.label]), [["R2 in effect", "Hwy 4, Camp Connell to Tamarack", "In effect"]]);
  assert.equal(lone[0].at, Date.parse("2026-11-17T08:00:00Z"), "at the time Grid saw it, not the posting's");
  const lifted = roadRecord([rev(6, "2026-11-17T09:00:00Z", chain("cc:hwy4:r2", "R2", "Camp Connell", "Tamarack", { status: "RESOLVED" }))]);
  assert.deepEqual(lifted.map((e) => e.label), ["R2 lifted"]);
});

test("a chain slot is reused: the next requirement on the highway is the same event, posted again", () => {
  const record = roadRecord([
    rev(4, "2026-11-20T07:05:00Z", chain("cc:hwy4:r2", "R2", "Dorrington", "Tamarack", { effective: "2026-11-20T07:00:00Z" })),
    rev(3, "2026-11-17T09:00:00Z", chain("cc:hwy4:r2", "R2", "Camp Connell", "Tamarack", { status: "RESOLVED" })),
  ]);
  assert.deepEqual(record.map((e) => [e.label, e.detail, e.badge.label]), [["R2 posted again", "Hwy 4, Dorrington to Tamarack", "Posted"], ["R2 lifted", "Hwy 4, Camp Connell to Tamarack", "Lifted"]]);
  assert.equal(record[0].at, Date.parse("2026-11-20T07:00:00Z"), "the new posting's own time");
  // Two saved versions of a lifted slot are one lifting.
  assert.equal(roadRecord([rev(4, "2026-11-17T10:00:00Z", chain("cc:x", "R1", "A", "B", { status: "EXPIRED" })), rev(3, "2026-11-17T09:00:00Z", chain("cc:x", "R1", "A", "B", { status: "RESOLVED" }))]).length, 1);
});

test("a chain requirement without a level is not 'undefined posted'", () => {
  const record = roadRecord([
    rev(2, "2026-11-17T09:00:00Z", chain("cc:hwy4:x", undefined, "A", "B", { status: "RESOLVED" })),
    rev(1, "2026-11-16T14:20:00Z", chain("cc:hwy4:x", undefined, "A", "B")),
  ]);
  assert.deepEqual(record.map((e) => e.label), ["Chain control lifted", "Chain control posted"]);
  assert.ok(!JSON.stringify(record).includes("undefined"));
});

test("a road's record is its closures, reopenings and seasonal closures, not where recording began", () => {
  const winter = [{ name: "Ebbetts Pass winter closure" }];
  const record = roadRecord([
    rev(7, "2026-11-19T09:00:00Z", road("OPEN")),
    rev(6, "2026-11-18T09:00:00Z", road("OPEN", winter)),
    rev(5, "2026-11-17T09:00:00Z", road("OPEN", winter)), // nothing shown here differs: not an entry
    rev(4, "2026-11-17T08:00:00Z", road("OPEN", winter)),
    rev(3, "2026-11-17T07:00:00Z", road("CLOSED")),
    rev(2, "2026-11-16T18:30:00Z", road("OPEN")),
    rev(1, "2026-11-10T00:00:00Z", road("CLOSED")),
  ]);
  assert.deepEqual(record.map((e) => [e.label, e.detail, e.badge.label, e.badge.tone]), [
    ["Ebbetts Pass winter closure ended", "Hwy 4 Arnold to Bear Valley", "Closure ended", "ok"],
    ["Hwy 4 Arnold to Bear Valley reopened", "was closed", "Reopened", "ok"],
    ["Hwy 4 Arnold to Bear Valley closed", "was open", "Closed", "alarm"],
    ["Hwy 4 Arnold to Bear Valley reopened", "was closed", "Reopened", "ok"],
  ]);
  // A closure coming into effect is "Seasonal closure" only when the record flags it, and as loud as it is rated.
  const started = (beyond) => roadRecord([rev(3, "2026-11-18T09:00:00Z", road("OPEN", beyond)), rev(2, "2026-11-17T09:00:00Z", road("OPEN"))])[0];
  assert.deepEqual([started(winter).label, started(winter).badge], ["Ebbetts Pass winter closure in effect", { label: "Closure", tone: "muted" }], "today's record carries neither the flag nor a severity");
  assert.deepEqual(started([{ name: "Ebbetts Pass winter closure", seasonal: true, severity: "INFO" }]).badge, { label: "Seasonal closure", tone: "muted" });
  assert.deepEqual(started([{ name: "Rockslide closure", seasonal: false, severity: "SEVERE" }]).badge, { label: "Closure", tone: "alarm" });
  assert.deepEqual(started([{ name: "Winter closure", seasonal: true, severity: "INFO" }, { name: "Washout", severityRank: 2 }]).badge, { label: "Closure", tone: "elevated" });
  // The reopening at revision 4 also brought the seasonal closure; the status change leads.
  // Without the revision before it, a row says the state rather than guess the change.
  const lone = roadRecord([rev(7, "2026-11-17T08:00:00Z", road("CLOSED"))])[0];
  assert.deepEqual([lone.label, lone.badge], ["Hwy 4 Arnold to Bear Valley: closed", { label: "Closed", tone: "alarm" }]);
  assert.deepEqual(roadRecord([rev(7, "2026-11-17T08:00:00Z", road("SOMETHING_NEW"))])[0].badge, { label: "Status unknown", tone: "muted" });
});

test("a road under chains is open: the record says the requirement beside the status, by its highest level", () => {
  const under = (status, ...levels) => ({ ...road(status), roadSegment: { ...road(status).roadSegment, chains: levels.map((level) => ({ level, eventId: `cc:hwy4:${level.toLowerCase()}` })) } });
  const record = roadRecord([
    rev(8, "2026-11-22T20:00:00Z", under("OPEN")),
    rev(7, "2026-11-22T08:00:00Z", under("OPEN", "R1")),
    rev(6, "2026-11-22T02:00:00Z", { ...under("OPEN", "R2"), roadSegment: { ...under("OPEN", "R2").roadSegment, chains: [{ level: "R2", eventId: "cc:hwy4:r2:2" }] } }), // the stretch renumbered: nothing to say
    rev(5, "2026-11-21T22:00:00Z", under("OPEN", "R2", "R1")),
    rev(4, "2026-11-21T20:00:00Z", under("CLOSED", "R2", "R1")),
    rev(3, "2026-11-21T18:00:00Z", under("OPEN", "R1")),
    rev(2, "2026-11-21T16:00:00Z", under("OPEN", "R1")), // nothing shown here changed
    rev(1, "2026-11-20T16:00:00Z", under("OPEN")),
  ]);
  assert.deepEqual(record.map((e) => [e.label, e.detail, e.badge.label, e.badge.tone]), [
    ["Hwy 4 Arnold to Bear Valley: chains lifted", "was R1", "Chains lifted", "ok"],
    ["Hwy 4 Arnold to Bear Valley: chains now R1", "was R2", "Chains R1", "elevated"],
    ["Hwy 4 Arnold to Bear Valley reopened", "was closed", "Reopened", "ok"],
    // Closed and raised in one revision: two entries, the status first.
    ["Hwy 4 Arnold to Bear Valley closed", "was open", "Closed", "alarm"],
    ["Hwy 4 Arnold to Bear Valley: chains now R2", "was R1", "Chains R2", "elevated"],
    ["Hwy 4 Arnold to Bear Valley: chains required (R1)", undefined, "Chains R1", "elevated"],
  ]);
  assert.ok(record.every((e) => e.id === "road:hwy4-arnold-bearvalley"));
  const r3 = roadRecord([rev(3, "2026-11-22T02:00:00Z", under("OPEN", "R3")), rev(2, "2026-11-22T01:00:00Z", under("OPEN"))])[0];
  assert.deepEqual([r3.label, r3.badge], ["Hwy 4 Arnold to Bear Valley: chains required (R3)", { label: "Chains R3", tone: "alarm" }]);
  // Without the revision before it, a row says the state and claims no change.
  const lone = roadRecord([rev(7, "2026-11-22T08:00:00Z", under("OPEN", "R2"))])[0];
  assert.deepEqual([lone.label, lone.badge], ["Hwy 4 Arnold to Bear Valley: open, chains required (R2)", { label: "Chains R2", tone: "elevated" }]);
  const shut = roadRecord([rev(7, "2026-11-22T08:00:00Z", under("CLOSED", "R2"))])[0];
  assert.deepEqual([shut.label, shut.badge], ["Hwy 4 Arnold to Bear Valley: closed, chains required (R2)", { label: "Closed", tone: "alarm" }], "closed is the stronger statement");
  // Chains went on a road's record on 2026-11-19 22:00Z. The revision before that lists none whatever the road
  // was under, so the first one after it does not say a requirement started (R2 had been posted for 29 hours).
  const deploy = roadRecord([rev(12, "2026-11-19T22:02:26Z", under("RESTRICTED", "R2")), rev(11, "2026-11-19T21:39:48Z", under("RESTRICTED")), rev(10, "2026-11-19T02:32:25Z", under("OPEN"))]);
  assert.deepEqual(deploy.map((e) => e.label), ["Hwy 4 Arnold to Bear Valley now restricted", "Hwy 4 Arnold to Bear Valley: open"], "revision 12 is no entry; 11 and 10 are theirs");
  // From there on the record knows: lifting it is an entry.
  assert.deepEqual(roadRecord([rev(13, "2026-11-20T18:00:00Z", under("OPEN")), rev(12, "2026-11-19T22:02:26Z", under("OPEN", "R2"))]).map((e) => [e.label, e.detail])[0], ["Hwy 4 Arnold to Bear Valley: chains lifted", "was R2"]);
  // A record that carries no chains at all (an older Grid) reads as before.
  assert.deepEqual(roadRecord([rev(2, "2026-11-22T02:00:00Z", road("CLOSED")), rev(1, "2026-11-22T01:00:00Z", road("OPEN"))]).map((e) => e.label), ["Hwy 4 Arnold to Bear Valley closed"]);
});

test("no badge is shared between a lifted requirement, a reopened road and an ended seasonal closure", () => {
  const record = roadRecord([
    rev(2, "2026-11-17T06:00:00Z", chain("cc:hwy4:r3", "R3", "A", "B", { status: "RESOLVED" })), rev(1, "2026-11-16T06:00:00Z", chain("cc:hwy4:r3", "R3", "A", "B")),
    rev(3, "2026-11-17T07:00:00Z", road("OPEN")), rev(2, "2026-11-17T05:00:00Z", road("CLOSED", [{ name: "Winter closure" }])), rev(1, "2026-11-10T05:00:00Z", road("CLOSED", [{ name: "Winter closure" }])),
    rev(3, "2026-11-17T08:00:00Z", road("OPEN", [], "road:b")), rev(2, "2026-11-17T04:00:00Z", road("OPEN", [{ name: "Winter closure" }], "road:b")),
  ]);
  const okLabels = record.filter((e) => e.badge.tone === "ok").map((e) => e.badge.label);
  assert.deepEqual(okLabels.sort(), ["Closure ended", "Lifted", "Open", "Reopened"]);
  assert.ok(!record.some((e) => /traffic|Clear|Control|Alert/.test(e.badge.label + e.label)));
});

test("the Roads panel: absent until read and while empty, honest when it failed, incomplete or could not be refreshed", () => {
  const from7 = Date.parse("2026-11-10T00:00:00Z");
  const storm = [rev(2, "2026-11-17T06:00:00Z", chain("cc:hwy4:r3", "R3", "A", "B", { status: "RESOLVED" })), rev(1, "2026-11-16T06:00:00Z", chain("cc:hwy4:r3", "R3", "A", "B"))];
  assert.equal(roadRecordPanel({ state: "loading" }, 7, from7), undefined);
  assert.equal(roadRecordPanel(okRead(pagesOf([])), 7, from7), undefined, "nothing on record: no panel");
  assert.equal(roadRecordPanel({ state: "failed" }, 7, from7).message, "The record could not be read right now.");
  const ok = roadRecordPanel(okRead(pagesOf(storm)), 7, from7);
  assert.deepEqual([ok.kicker, ok.entries.length, ok.note, ok.staleAsOf], ["Chain controls and road status, last 7 days", 2, undefined, undefined]);
  const stale = roadRecordPanel({ state: "failed", last: pagesOf(storm), asOf: 777 }, 7, from7);
  assert.deepEqual([stale.entries.length, stale.staleAsOf], [2, 777], "the old list stays, marked with when it was read");
  const partial = roadRecordPanel(okRead(pagesOf(storm, true)), 7, from7);
  assert.equal(partial.kicker, "Chain controls and road status, up to the last 7 days");
  assert.equal(partial.note, "Older entries not loaded: this list is incomplete.");
  // Every monitored road's first revision is inside the period: road status was not recorded for all of it.
  const young = roadRecordPanel(okRead(pagesOf([...storm, rev(1, "2026-11-16T23:34:09Z", road("OPEN"))])), 7, from7);
  assert.equal(young.kicker, "Chain controls and road status, last 7 days · road status on record since Nov 16");
  const long = roadRecordPanel(okRead(pagesOf([...storm, rev(9, "2026-11-16T23:34:09Z", road("OPEN"))])), 7, from7);
  assert.equal(long.kicker, "Chain controls and road status, last 7 days");
});

// ---- Burn readings and the profiles of the recorded types -------------------

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

test("which call a reading records is one rule: the lines that moved since the revision before", () => {
  const before = burn(2, "CHANGE", "2026-11-15T20:10:00Z", { a: ["2026-11-15T19:41:00Z", "a, the 15th"], b: ["2026-11-15T20:00:00Z", "b, the 15th"] });
  const one = burn(3, "READING", "2026-11-16T19:50:00Z", { a: ["2026-11-16T19:43:00Z", "a, the 16th"], b: ["2026-11-15T20:00:00Z", "b, the 15th"] });
  // The line that was called is not the one with the newest call when the other line's is newer still.
  const older = burn(3, "READING", "2026-11-15T20:20:00Z", { a: ["2026-11-15T19:50:00Z", "a, again"], b: ["2026-11-15T20:00:00Z", "b, the 15th"] });
  assert.deepEqual(readingCalls(one, before).map((c) => c.message), ["a, the 16th"]);
  assert.deepEqual(readingCalls(older, before).map((c) => c.message), ["a, again"], "not b, though b's call is the newest in the snapshot");
  const both = burn(3, "READING", "2026-11-16T20:10:00Z", { a: ["2026-11-16T19:43:00Z", "a, the 16th"], b: ["2026-11-16T20:05:00Z", "b, the 16th"] });
  assert.deepEqual(readingCalls(both, before).map((c) => [c.line, c.answer, c.message]), [["a line", "Burn day", "a, the 16th"], ["b line", "Burn day", "b, the 16th"]], "one revision that advanced two lines lists both, oldest first");
  assert.deepEqual(burnReadings([both, before]).map((e) => e.detail), ["b, the 16th", "a, the 16th"]);
  assert.deepEqual(readingCalls(one).map((c) => c.message), ["a, the 16th"], "without the revision before: the line called last");
  assert.deepEqual(readingCalls(one, burn(1, "CHANGE", "2026-11-14T00:00:00Z", {})).map((c) => c.message), ["a, the 16th"], "a revision that is not the one before does not count as it");
  const same = burn(3, "READING", "2026-11-15T21:00:00Z", { a: ["2026-11-15T19:41:00Z", "a, the 15th"], b: ["2026-11-15T20:00:00Z", "b, the 15th"] });
  assert.deepEqual(readingCalls(same, before), [], "no line moved: the reading was of something else");
});

test("the new report types have a profile and a name", () => {
  const now = Date.parse("2026-11-16T22:00:00Z");
  const envelope = { status: "ACTIVE", severity: "MODERATE", provenance: {}, ingestedAt: "2026-11-16T14:20:00Z", revision: 1 };
  const cc = reportProfile({ ...envelope, ...chain("cc:hwy4:r2", "R2", "Poison Springs", "Mount Reba Road"), chainControl: { level: "R2", highway: "Highway 4", from: { place: "Poison Springs" }, to: { place: "Mount Reba Road" }, signs: [{ place: "POISON SPRINGS", direction: "Eastbound", level: "R2" }] } }, [], now);
  assert.deepEqual(cc.stats.map((s) => [s.label, s.value]), [["Requirement", "R2"], ["In effect for", "7 h 50 m"], ["Checkpoints", "1"]]);
  assert.equal(cc.subtitle, "Highway 4 · Poison Springs to Mount Reba Road");
  const rs = reportProfile({ ...envelope, ...road("CLOSED") }, [], now);
  assert.equal(rs.stats[0].value, "Closed");
  assert.equal(typeLabel("SOURCE_HEALTH"), "Source health");
  assert.equal(typeLabel("CHAIN_CONTROL"), "Chain control");
});

test("a reason the page already gives above is not printed again in the list of changes", async () => {
  const { withoutReasonsShownAbove } = await import("../src/lib/record-model.ts");
  const err = "nws: GET https://api.weather.gov/alerts/active: HTTP 503", other = "nws: timeout";
  const entry = (id, at, detail, extra = {}) => ({ id, at, revision: 2, label: id, detail, badge: { label: "Stale", tone: "elevated" }, ...extra });
  const entries = [
    entry("source:nws", 3, err), // the outage as it is now: the reason is in "Needs attention"
    entry("source:nws", 1, undefined, { sameReasonAs: 3 }), // an earlier one, already pointing at the newest
    entry("source:nws", 0, other), // the same source with another reason keeps it
    entry("source:caltrans", 2, err), // another source with the same words keeps them
  ];
  const out = withoutReasonsShownAbove(entries, new Map([["source:nws", err]]));
  assert.deepEqual(out.map((e) => [e.id, e.detail, e.reasonAbove === true, e.sameReasonAs]), [
    ["source:nws", undefined, true, undefined],
    ["source:nws", undefined, false, 3],
    ["source:nws", other, false, undefined],
    ["source:caltrans", err, false, undefined],
  ]);
  // Nothing given above: every entry is as it was.
  assert.deepEqual(withoutReasonsShownAbove(entries, new Map()), entries);
});
