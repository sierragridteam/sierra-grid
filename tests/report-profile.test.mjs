import { test } from "node:test";
import assert from "node:assert/strict";
import { reportProfile, duration, roadCauseText } from "../src/lib/report-profile.ts";

const base = { id: "x", headline: "h", status: "ACTIVE", severity: "MODERATE", category: "", areaLabel: "near Jamestown", provenance: { attribution: "cwwp2.dot.ca.gov" }, ingestedAt: "2026-11-09T19:33:00Z", observedAt: "2026-11-09T19:28:00Z", revision: "1" };
const closure = { ...base, layer: "ROAD_INCIDENT", roadIncident: { logNumber: "1", closure: {
  windowId: "T108IA-0001-2026-11-09-11:15:00", district: 10, closureId: "T108IA", logNumber: "1", route: "SR-108", direction: "East",
  facility: "Conventional Hwy", closureType: "Moving", workType: "Drainage Cleaning/Inspection", lanesClosed: "2", totalLanes: 2,
  estimatedDelayMinutes: 5, closureDuration: "Standard", plannedStart: "2026-11-09T19:15:00Z", plannedEnd: "2026-11-09T23:01:00Z",
  endIndefinite: false, setUpAt: "2026-11-09T19:21:46Z", beginLocation: "Sullivan Creek", endLocation: "Hess Avenue Under-Crossing" } } };
const now = Date.parse("2026-11-09T20:20:00Z"); // 12:20 PT

test("a lane closure calls out lanes, delay, window and progress", () => {
  const p = reportProfile(closure, [], now);
  assert.deepEqual(p.stats.map((s) => [s.label, s.value]), [["Lanes", "Lane 2 of 2"], ["Est. delay", "5 min"], ["Window", "11:15 – 15:01"], ["Progress", "29%"]]);
  assert.equal(p.stats[2].sub, "3 h 46 m · ends today");
  assert.equal(p.stats[3].progress.text, "1 h 05 m elapsed · 2 h 41 m remaining");
  assert.equal(p.subtitle, "SR-108 E · Sullivan Creek → Hess Avenue Under-Crossing");
  assert.deepEqual(p.sections.map((s) => s.title), ["Where", "Work"]);
  assert.deepEqual(p.identifiers, ["Closure T108IA"]);
  assert.equal(p.place, "Sullivan Creek → Hess Avenue Under-Crossing");
  assert.equal(p.sections[0].items.find((i) => i.label === "Direction").value, "Eastbound");
});

test("the closure timeline orders key times around now on one day", () => {
  const p = reportProfile(closure, [], now);
  assert.equal(p.timelineDay, "Nov 9");
  assert.deepEqual(p.timeline.map((m) => [m.time, m.label, m.state, m.kind]), [
    ["11:15", "Planned start", "past", "source"], ["11:21", "Set up on the road", "past", "source"], ["11:28", "Reported", "past", "source"],
    ["11:33", "First saved by Grid", "past", "system"], ["12:20", "Now", "now", "source"], ["15:01", "Planned end", "future", "source"],
  ]);
});

test("revision changes become timeline moments", () => {
  const rev = (n, status, acres, at) => ({ revision: String(n), observedAt: at, ingestedAt: at, event: { ...base, layer: "WILDFIRE", status, wildfire: { acres, containment: 0, hasPerimeter: true } } });
  const fire = { ...base, layer: "WILDFIRE", wildfire: { acres: 12, containment: 20, hasPerimeter: true, county: "Tuolumne", cause: "" } };
  const p = reportProfile(fire, [rev(1, "ACTIVE", 6.4, "2026-11-09T18:00:00Z"), rev(2, "ACTIVE", 12, "2026-11-09T19:00:00Z")], now);
  assert.deepEqual(p.stats.map((s) => s.value).slice(0, 2), ["12 ac", "20%"]);
  const grew = p.timeline.find((m) => m.label.startsWith("Size"));
  assert.equal(grew.label, "Size: 12 ac"); assert.equal(grew.detail, "was 6.4 ac · seen by Grid"); assert.equal(grew.kind, "system");
});

test("types without a profile fall back, and empty rows disappear", () => {
  assert.equal(reportProfile({ ...base, layer: "EARTHQUAKE", earthquake: { magnitude: 2 } }, [], now), undefined);
  const sparse = reportProfile({ ...base, layer: "WILDFIRE", wildfire: { acres: 1, containment: 0, county: "", cause: "" } }, [], now);
  assert.equal(sparse.sections.length, 0);
  assert.equal(duration(65 * 60_000), "1 h 05 m");
  assert.equal(duration(8_820), "9 s");
});

const chpText = "CHP Incident 261109MR0185 FIRE-Report of Fire Nov 9 2026 11:45AM Mono Way / Sullivan Creek Rd Nov 9 2026 11:46AM [3] TOT FIRE Nov 9 2026 11:46AM [2] UNK WHATS ON FIRE Nov 9 2026 11:45AM [1] BLK SMOKE BEHIND SUBA DEALERSHIP Information courtesy of CHP";

test("a CHP incident separates the source's clock from Grid's and drops unknown tiles", () => {
  // As sierra-data publishes it: effective is CHP's dispatch time, log is structured.
  const chp = { ...base, layer: "ROAD_INCIDENT", description: chpText, effective: "2026-11-09T19:45:00Z", observedAt: "2026-11-09T20:15:00Z", ingestedAt: "2026-11-09T20:16:00Z",
    roadIncident: { logNumber: "261109MR0185", impact: "none", log: [
      { number: 3, at: "2026-11-09T19:46:00Z", text: "TOT FIRE" },
      { number: 1, at: "2026-11-09T19:45:00Z", text: "BLK SMOKE BEHIND SUBA DEALERSHIP" },
      { number: 2, at: "2026-11-09T19:46:00Z", text: "UNK WHATS ON FIRE" },
    ], metadata: { incident_type: "fire", injuries: "unknown", fire_report: "initially unknown item on fire", reported_smoke: "black smoke", emergency_services: "fire units dispatched", location_cross_streets: "Mono Way / Sullivan Creek Rd" } } };
  const revs = [{ revision: "1", observedAt: "2026-11-09T20:03:00Z", ingestedAt: "2026-11-09T20:04:00Z", event: { ...chp, observedAt: "2026-11-09T20:03:00Z" } }];
  // Without the structured log (data before the field existed) the narrative fields stay.
  const older = reportProfile({ ...chp, roadIncident: { ...chp.roadIncident, log: undefined } }, revs, now);
  assert.ok(older.sections[0].items.some((i) => i.label === "Fire report"));
  const p = reportProfile(chp, revs, now);
  const labels = p.timeline.map((m) => `${m.time} ${m.label} ${m.kind}`);
  assert.deepEqual(labels.slice(0, 5), ["11:45 Reported source", "11:45 BLK SMOKE BEHIND SUBA DEALERSHIP source", "11:46 UNK WHATS ON FIRE source", "11:46 TOT FIRE source", "12:04 First saved by Grid system"]);
  assert.deepEqual(p.stats.map((s) => [s.label, s.value]), [["Incident", "Fire"], ["Road impact", "None"], ["Last log entry", "34 m ago"]]);
  assert.deepEqual(p.sections.map((s) => s.items.map((i) => i.label)), [["Emergency services"]]);
  assert.deepEqual(p.identifiers, ["CHP log 261109MR0185"]);
  assert.equal(p.place, "Mono Way / Sullivan Creek Rd");
});

test("a mesh node leads with mesh activity and dates its monitor readings", () => {
  const meshNow = Date.parse("2026-11-09T21:27:00Z");
  const node = { ...base, layer: "MESH", observedAt: "2026-11-09T09:55:08Z", ingestedAt: "2026-11-09T09:55:26Z", mesh: {
    publicKey: "55678f4147f9d04a32c89aa857a1fdb2b7777f3a9144fa7e63702b66081a797d", nodeType: "repeater", name: "SIERRA Forest Meadows", reachability: "UNREACHABLE",
    telemetry: { snr: 8.7, rssi: -94, hopCount: 8, gateways: ["0b0b037985e4980662d3", "0f0f038de5fd9631e7c6"],
      lastAdvertAt: "2026-11-10T13:52:10Z", lastHeardAt: "2026-11-09T09:55:08Z", lastRelayedAt: "2026-11-09T21:15:14Z",
      admin: { reporterId: "alanpi", reportedAt: "2026-11-09T21:06:46Z", lastSuccessAt: "2026-10-22T19:14:56Z", lastAttemptAt: "2026-11-09T21:01:56Z",
        batteryVolts: 4.07, batteryPercent: 82.5, batteryPercentSource: "estimated", temperatureC: 17, humidity: null, uptimeSeconds: "4758373",
        airtimeMs: "114103", rxAirtimeMs: "532622", packetsReceived: "1740108", recvErrors: "921051" } } } };
  const p = reportProfile(node, [], meshNow);
  assert.equal(p.when, "Last relayed 12 m ago");
  assert.deepEqual(p.stats.map((s) => [s.label, s.value]), [["Last relayed", "12 m ago"], ["Monitor", "Unreachable"], ["Battery", "4.07 V"], ["Signal", "8.7 dB SNR"]]);
  assert.match(p.stats[2].sub, /^83% estimated · as of Oct 22 \(18 days ago\)$/);
  const health = p.sections.find((s) => s.title.startsWith("Health"));
  assert.equal(health.title, "Health · as of Oct 22 (18 days ago)");
  assert.equal(health.items.find((i) => i.label === "Uptime").value, "55 days");
  assert.ok(!health.items.some((i) => i.label === "Humidity"), "null readings are not rows");
  assert.equal(p.sections.find((s) => s.title === "Traffic since boot").items[0].value, "1,740,108");
  assert.match(p.sections.find((s) => s.title === "Mesh activity").items.find((i) => i.label.startsWith("Advert time")).value, /ahead of real time$/);
  // Activity in time order; no "Reported" (a node has no report time).
  assert.deepEqual(p.timeline.map((m) => m.label), ["Monitor read it", "Advert heard", "First saved by Grid", "Monitor tried", "Last relayed", "Now"]);
  assert.ok(!p.timeline.some((m) => m.label === "Reported"));
});

test("a repeater read on schedule is not a problem; a failed or long-overdue read is", () => {
  const at = Date.parse("2026-11-13T23:37:00Z");
  const node = (admin, reachability = "REACHABLE") => ({ ...base, layer: "MESH", mesh: { publicKey: "5".repeat(64), nodeType: "repeater", name: "SIERRA Eagle HQ", reachability,
    telemetry: { lastHeardAt: "2026-11-13T23:15:57Z", lastRelayedAt: "2026-11-13T23:11:28Z", admin: { reporterId: "relay", batteryVolts: 4.27, ...admin } } } });
  // Read 26 minutes ago; the reporter's own push a minute ago is not shown anywhere.
  const fine = reportProfile(node({ reportedAt: "2026-11-13T23:36:04Z", lastSuccessAt: "2026-11-13T23:11:30Z", lastAttemptAt: "2026-11-13T23:11:30Z" }), [], at);
  const monitor = (p) => p.stats.find((s) => s.label === "Monitor");
  assert.equal(monitor(fine).value, "Reachable");
  assert.equal(monitor(fine).sub, "Read 26 m ago · next due about 15:41 PT");
  assert.ok(!/[^0-9]1 m ago/.test(JSON.stringify(fine)), "the reporter push time is not a reading time");
  assert.ok(!fine.timeline.some((m) => m.label === "Monitor tried"));
  assert.match(fine.sections.find((s) => s.title.startsWith("Monitor")).items.find((i) => i.label === "Next read due").value, /^about 15:41 PT/);
  const section = (p) => p.sections.find((s) => s.title.startsWith("Monitor")).items;
  assert.ok(!section(fine).some((i) => i.label === "Last try (failed)"), "a good read has no separate try");
  // The last try failed: say so, with the last good read.
  const failed = reportProfile(node({ lastSuccessAt: "2026-11-13T22:41:30Z", lastAttemptAt: "2026-11-13T23:11:30Z" }, "UNREACHABLE"), [], at);
  assert.equal(monitor(failed).value, "Unreachable");
  assert.match(monitor(failed).sub, /^Last read failed 26 m ago · last good read 56 m ago$/);
  // An operator's own monitor keeps no fixed schedule: an hour-old read is neither overdue nor "due", as on the Mesh page.
  const own = reportProfile(node({ reporterId: "alanpi", lastSuccessAt: "2026-11-13T22:30:00Z", lastAttemptAt: "2026-11-13T22:30:00Z" }), [], at);
  assert.equal(monitor(own).value, "Reachable");
  assert.ok(!section(own).some((i) => i.label === "Next read due"));
  // No try and no read for well past one interval.
  const overdue = reportProfile(node({ lastSuccessAt: "2026-11-13T22:30:00Z", lastAttemptAt: "2026-11-13T22:30:00Z" }), [], at);
  assert.equal(monitor(overdue).value, "Read overdue");
  assert.match(monitor(overdue).sub, /^No read for .* · expected about every 30 min$/);
});

test("a node no monitor has reached shows no reachability verdict", () => {
  const node = { ...base, layer: "MESH", mesh: { publicKey: "a".repeat(64), nodeType: "repeater", name: "SIERRA Lilac Park", reachability: "UNREACHABLE",
    telemetry: { snr: 5, lastRelayedAt: "2026-11-09T20:00:00Z" } } };
  const p = reportProfile(node, [], now);
  assert.ok(!p.stats.some((s) => s.label === "Monitor"));
  assert.ok(!p.sections.some((s) => s.title.startsWith("Monitor")));
  assert.ok(!JSON.stringify(p).includes("Unreachable"));
  const unspecified = reportProfile({ ...node, mesh: { ...node.mesh, reachability: "MESH_REACHABILITY_UNSPECIFIED" } }, [], now);
  assert.ok(!JSON.stringify(unspecified).toLowerCase().includes("unspecified"));
});

test("burn status: today's answer, how long it has held, and recent transitions only", () => {
  const status = (burnDay, permission, calfire) => ({ burnDay, permission, calfireStatus: calfire, calfireArea: "All SRA", calfireEffective: "2026-11-06T16:00:00Z",
    burnLines: [{ id: "calaveras-apcd", name: "Calaveras County burn line", phone: "+12097546600", burnDay,
      observation: { message: "Today is a burn day with no elevation restriction.", transcript: "Thank you for calling...", confidence: 95, observedAt: "2026-11-09T19:56:32Z" } }] });
  const ev = (b) => ({ ...base, layer: "BURN_STATUS", status: "ACTIVE", severity: "INFO", burnStatus: b });
  const rev = (n, at, b) => ({ revision: String(n), observedAt: at, ingestedAt: at, event: ev(b) });
  const revisions = [
    rev(1, "2026-09-01T15:00:00Z", status("BURN_DAY_NO", "BURN_PERMISSION_PROHIBITED", "CALFIRE_BURNING_SUSPENDED")),
    rev(2, "2026-09-20T15:00:00Z", status("BURN_DAY_YES", "BURN_PERMISSION_PROHIBITED", "CALFIRE_BURNING_SUSPENDED")), // outside the window
    rev(3, "2026-11-04T15:00:00Z", status("BURN_DAY_NO", "BURN_PERMISSION_PROHIBITED", "CALFIRE_PERMIT_REQUIRED")),
    rev(4, "2026-11-06T16:55:00Z", status("BURN_DAY_YES", "BURN_PERMISSION_ALLOWED", "CALFIRE_PERMIT_REQUIRED")),
  ];
  const p = reportProfile(ev(status("BURN_DAY_YES", "BURN_PERMISSION_ALLOWED", "CALFIRE_PERMIT_REQUIRED")), revisions, now);
  assert.deepEqual(p.stats.map((s) => [s.label, s.value]), [["Burning today", "Allowed"], ["Air district", "Burn day"], ["CAL FIRE", "Permit required"], ["Unchanged for", "3 days"]]);
  assert.equal(p.stats[3].sub, "since Nov 6");
  assert.equal(p.when, "Burn line read 23 m ago");
  assert.deepEqual(p.original, { text: "Today is a burn day with no elevation restriction.", full: "Thank you for calling..." });
  const labels = p.timeline.map((m) => m.label);
  assert.ok(labels.includes("Burning: Allowed") && labels.includes("Air district: No-burn day"));
  assert.ok(!labels.some((l) => l === "Air district: Burn day" && p.timeline.find((m) => m.label === l).time.startsWith("Sep")), "Sep 20 is outside the 30-day window");
  assert.ok(labels.includes("1 earlier change not shown"));
  assert.ok(!labels.includes("Reported"));
  assert.ok(!labels.some((l) => l.endsWith(": Unknown")));
  assert.equal(p.sections[0].items.find((i) => i.label === "Phone").value, "(209) 754-6600");
});

// ---- Recorded state: what a profile may say from a partial history ----------

const T = (s) => Date.parse(s);
const revOf = (n, at, event, kind = "CHANGE") => ({ revision: n, kind, observedAt: at, ingestedAt: at, event: { ...event, revision: n } });
const stat = (profile, label) => profile.stats.find((s) => s.label === label);
const lines = (profile) => profile.timeline.map((m) => `${m.time} ${m.label}${m.detail ? ` (${m.detail})` : ""}`);

const roadEvent = (status, beyond = []) => ({ ...base, id: "road:hwy4-arnold-bearvalley", layer: "ROAD_SEGMENT", status: "ACTIVE", severity: "INFO", roadSegment: { name: "Hwy 4", section: "Arnold to Bear Valley", status, beyond } });
test("a monitored road: how long it has had its status is known only from the revision where it changed", () => {
  const at = T("2026-11-17T20:00:00Z");
  const history = [revOf(1, "2026-11-10T08:00:00Z", roadEvent("OPEN")), revOf(2, "2026-11-14T08:00:00Z", roadEvent("CLOSED")), revOf(3, "2026-11-15T20:00:00Z", roadEvent("OPEN"))];
  const report = { ...roadEvent("OPEN"), revision: 3, ingestedAt: "2026-11-15T20:00:00Z" };
  assert.equal(stat(reportProfile(report, history, at), "Road").sub, "for 2 days, since Nov 15");
  assert.equal(reportProfile(report, history, at).when, "Open since Nov 15, 12:00 PT", "the header says how long it has stood, not 'report time not supplied'");
  assert.equal(stat(reportProfile(report, history, at, { complete: false }), "Road").sub, "for 2 days, since Nov 15", "the change itself is loaded, so truncation does not matter");
  // Never changed since recording began: open for at least that long, not "since".
  const steady = [revOf(1, "2026-11-10T20:00:00Z", roadEvent("OPEN")), revOf(2, "2026-11-12T20:00:00Z", roadEvent("OPEN", [{ name: "Ebbetts Pass winter closure", side: "END", status: "CLOSED" }]))];
  const p = reportProfile({ ...report, revision: 2 }, steady, at);
  assert.equal(stat(p, "Road").sub, "for at least 7 days · on record since Nov 10");
  assert.ok(lines(p).some((l) => /First saved by Grid/.test(l)));
  // Truncated: the oldest LOADED revision is not when it opened, nor when Grid first saved it.
  const truncated = reportProfile({ ...report, revision: 9 }, [revOf(8, "2026-11-15T20:00:00Z", roadEvent("OPEN")), revOf(9, "2026-11-16T20:00:00Z", roadEvent("OPEN"))], at, { complete: false });
  assert.equal(stat(truncated, "Road").sub, "for at least 2 days · earlier history not loaded");
  assert.ok(!lines(truncated).some((l) => /First saved by Grid/.test(l)), "the first save is not known from a truncated history");
  assert.ok(lines(truncated).some((l) => /Earlier history not loaded/.test(l)));
  // History loading or failed: no revisions at all, so no duration (not the latest revision's ingest time).
  const bare = reportProfile({ ...report, revision: 9, ingestedAt: "2026-11-17T19:00:00Z" }, [], at, { complete: false });
  assert.equal(stat(bare, "Road").sub, undefined);
  assert.equal(bare.when, "Monitored road");
  assert.equal(truncated.when, "Open for at least 2 days");
  assert.deepEqual(lines(bare), ["12:00 Now"]);
  assert.ok(!bare.stats.some((s) => s.label === "Traffic"), "congestion is no longer part of a road's report");
});

const chainEvent = (status, from, to, effective, level = "R2") => ({ ...base, id: "cc:hwy88:r2", layer: "CHAIN_CONTROL", status, severity: "MODERATE", effective, observedAt: undefined, chainControl: { level, highway: "Highway 88", from: { place: from }, to: { place: to }, signs: [] } });
test("a lifted chain requirement: one 'Lifted', no 'Status: Resolved', and from-to instead of 'since'", () => {
  const history = [
    revOf(1, "2026-11-16T23:33:08Z", chainEvent("ACTIVE", "Peddler Vista", "Pickett's Junction", "2026-11-16T10:02:14Z")),
    revOf(2, "2026-11-17T00:02:34Z", chainEvent("RESOLVED", "Peddler Vista", "Pickett's Junction", "2026-11-16T10:02:14Z")),
  ];
  // The event's own clock has more digits than the revision's: still one lifting.
  const report = { ...chainEvent("RESOLVED", "Peddler Vista", "Pickett's Junction", "2026-11-16T10:02:14Z"), revision: 2, observedAt: "2026-11-17T00:02:34.209119383Z" };
  const p = reportProfile(report, history, T("2026-11-17T01:00:00Z"));
  assert.deepEqual([stat(p, "Was in effect").value, stat(p, "Was in effect").sub], ["14 h", "from Nov 16, 02:02 to Nov 16, 16:02 PT"]);
  assert.deepEqual(lines(p), [
    "02:02 R2 posted (Peddler Vista to Pickett's Junction)",
    "15:33 First saved by Grid",
    "16:02 Lifted (no longer listed by Caltrans)",
    "17:00 Now",
  ]);
  assert.ok(!lines(p).some((l) => /Status:|Severity:/.test(l)));
  assert.equal(p.when, "Lifted Nov 16, 16:02 PT");
  const signed = reportProfile({ ...report, chainControl: { ...report.chainControl, signs: [{ place: "KIRKWOOD", direction: "Eastbound", level: "R2", since: "2026-11-16T10:02:00Z" }] } }, history, T("2026-11-17T01:00:00Z"));
  assert.deepEqual([signed.sections[0].title, signed.sections[0].items[0].value], ["Checkpoints when last posted", "R2 · from 02:02"], "a lifted stretch's signs are not 'since'");
});

test("a chain slot posted, lifted and posted again keeps every posting, and a changed stretch is one entry", () => {
  const history = [
    revOf(1, "2026-11-16T14:20:00Z", chainEvent("ACTIVE", "Poison Springs", "Tamarack", "2026-11-16T14:10:00Z")),
    revOf(2, "2026-11-16T16:00:00Z", chainEvent("ACTIVE", "Camp Connell", "Tamarack", "2026-11-16T14:10:00Z")),
    revOf(3, "2026-11-16T17:00:00Z", chainEvent("ACTIVE", "Camp Connell", "Tamarack", "2026-11-16T14:10:00Z")), // a sign only
    revOf(4, "2026-11-17T09:00:00Z", chainEvent("RESOLVED", "Camp Connell", "Tamarack", "2026-11-16T14:10:00Z")),
    revOf(5, "2026-11-20T07:05:00Z", chainEvent("ACTIVE", "Dorrington", "Tamarack", "2026-11-20T07:00:00Z")),
  ];
  const report = { ...chainEvent("ACTIVE", "Dorrington", "Tamarack", "2026-11-20T07:00:00Z"), revision: 5 };
  const p = reportProfile(report, history, T("2026-11-20T09:00:00Z"));
  assert.deepEqual(lines(p), [
    "Nov 16, 06:10 R2 posted (Poison Springs to Tamarack)",
    "Nov 16, 06:20 First saved by Grid",
    "Nov 16, 08:00 Now Camp Connell to Tamarack (was Poison Springs to Tamarack · seen by Grid)",
    "Nov 17, 01:00 Lifted (no longer listed by Caltrans)",
    "Nov 19, 23:00 R2 posted again (Dorrington to Tamarack)",
    "Nov 20, 01:00 Now",
  ]);
  assert.deepEqual([stat(p, "In effect for").value, stat(p, "In effect for").sub], ["2 h", "since Nov 19, 23:00 PT"]);
  assert.equal(p.when, "Posted Nov 19, 23:00 PT");
  // Truncated to the last two revisions: what is loaded is told, and the gap is said.
  const cut = reportProfile(report, history.slice(3), T("2026-11-20T09:00:00Z"), { complete: false });
  assert.deepEqual(lines(cut), ["Nov 17, 01:00 Earlier history not loaded", "Nov 17, 01:00 Lifted (no longer listed by Caltrans)", "Nov 19, 23:00 R2 posted again (Dorrington to Tamarack)", "Nov 20, 01:00 Now"]);
  // Only the latest revision: the posting comes from the report itself, without the stretch it was posted with.
  const last = reportProfile(report, history.slice(4), T("2026-11-20T09:00:00Z"), { complete: false });
  assert.deepEqual(lines(last), ["Nov 19, 23:00 R2 posted", "Nov 19, 23:05 Earlier history not loaded", "Nov 20, 01:00 Now"]);
  // No history at all (loading): the posting from the report, nothing invented.
  assert.deepEqual(lines(reportProfile(report, [], T("2026-11-20T09:00:00Z"), { complete: false })), ["Nov 19, 23:00 R2 posted", "Nov 20, 01:00 Now"]);
  assert.ok(!JSON.stringify(reportProfile({ ...report, chainControl: { ...report.chainControl, level: undefined } }, [], T("2026-11-20T09:00:00Z"))).includes("undefined posted"));
});

const healthEvent = (status, since, extra = {}) => ({ ...base, id: "source:meshcore", layer: "SOURCE_HEALTH", status: "ACTIVE", severity: "INFO", sourceHealth: { sourceId: "meshcore", status, since, error: status === "OK" ? "" : "no broker delivering", lastSuccessAt: null, ...extra } });
test("source health at revision 1: 'since' is when recording began, so the status is 'at least' that old", () => {
  const at = T("2026-11-17T00:09:38Z");
  const report = { ...healthEvent("UNAVAILABLE", "2026-11-16T23:32:38Z"), revision: 1, readings: 0 };
  const p = reportProfile(report, [revOf(1, "2026-11-16T23:32:38Z", report)], at);
  assert.equal(p.when, "Unavailable for at least 37 m");
  assert.deepEqual(p.stats.map((s) => [s.label, s.value, s.sub]), [
    ["Status", "Unavailable", "recorded since Nov 16, 15:32 PT"],
    ["Last good reading", "None on record", "before this status began"],
    ["Changes on record", "0", undefined],
  ]);
  assert.deepEqual(lines(p), ["15:32 Recording began: unavailable (no broker delivering)", "16:09 Now"]);
});

test("source health once revised: the status has a beginning, and a current feed shows no frozen 'last good reading'", () => {
  const at = T("2026-11-17T00:09:38Z");
  const down = { ...healthEvent("UNAVAILABLE", "2026-11-16T22:00:00Z", { lastSuccessAt: "2026-11-16T21:55:00Z" }), revision: 4, readings: 1 };
  const p = reportProfile(down, [], at);
  assert.equal(p.when, "Unavailable for 2 h 10 m");
  assert.deepEqual(p.stats.map((s) => [s.label, s.value, s.sub]), [
    ["Status", "Unavailable", "since Nov 16, 14:00 PT"],
    ["Last good reading", "2 h 15 m ago", "before this status began"],
    ["Changes on record", "2", undefined],
  ]);
  // Current: lastSuccessAt is frozen at the last change, so it is not shown as the feed's last reading.
  const ok = { ...healthEvent("OK", "2026-11-16T23:33:11Z", { lastSuccessAt: "2026-11-16T23:33:11Z" }), revision: 2, readings: 0 };
  const history = [revOf(2, "2026-11-16T23:33:11Z", ok), revOf(1, "2026-11-16T23:32:07Z", healthEvent("UNAVAILABLE", "2026-11-16T23:32:07Z"))];
  const q = reportProfile(ok, history, at);
  assert.deepEqual(q.stats.map((s) => s.label), ["Status", "Changes on record"]);
  assert.equal(stat(q, "Changes on record").value, "1");
  assert.deepEqual(lines(q).slice(0, 2), ["15:32 Recording began: unavailable (no broker delivering)", "15:33 Current"]);
  // The oldest LOADED revision of a truncated history is not where recording began.
  const cut = reportProfile({ ...ok, revision: 7 }, [revOf(7, "2026-11-16T23:33:11Z", ok), revOf(6, "2026-11-16T23:00:00Z", healthEvent("STALE", "2026-11-16T23:00:00Z"))], at, { complete: false });
  assert.ok(!lines(cut).some((l) => /Recording began/.test(l)));
  assert.deepEqual(lines(cut).slice(0, 3), ["15:00 Earlier history not loaded", "15:00 Stale (no broker delivering)", "15:33 Current"]);
  // Readings never make the count of changes negative; an unknown status is shown as sent.
  assert.equal(stat(reportProfile({ ...ok, revision: 2, readings: 5 }, [], at), "Changes on record").value, "0");
  assert.equal(stat(reportProfile({ ...healthEvent("DEGRADED", "2026-11-16T22:00:00Z"), revision: 2 }, [], at), "Status").value, "Degraded");
});

const burnEvent = (permission, calfire = "CALFIRE_BURNING_ALLOWED") => ({ ...base, id: "burn:calaveras-county", layer: "BURN_STATUS", status: "ACTIVE", severity: "INFO",
  burnStatus: { burnDay: "BURN_DAY_YES", permission, calfireStatus: calfire, calfireArea: "All SRA", calfireEffective: "2026-11-06T16:00:00Z", burnLines: [] } });
test("burn status: 'Unchanged for' is exact only when the change is loaded; CAL FIRE allowing is explained", () => {
  const at = T("2026-11-17T00:57:52Z");
  const allowed = burnEvent("BURN_PERMISSION_ALLOWED"), unknown = burnEvent("BURN_PERMISSION_UNKNOWN", "CALFIRE_BURN_STATUS_UNKNOWN");
  // As the API has it: unknown until the fourth revision. "Allowed" began there, not at the first save.
  const history = [revOf(1, "2026-11-16T23:32:07Z", unknown), revOf(2, "2026-11-16T23:33:11Z", unknown), revOf(3, "2026-11-16T23:36:02Z", unknown, "READING"), revOf(4, "2026-11-16T23:57:52Z", allowed)];
  const p = reportProfile({ ...allowed, revision: 4 }, history, at);
  assert.deepEqual([stat(p, "Unchanged for").value, stat(p, "Unchanged for").sub], ["1 h", "since Nov 16"]);
  assert.equal(stat(p, "CAL FIRE").value, "Burning allowed");
  assert.equal(stat(p, "CAL FIRE").sub, "CAL FIRE is not restricting; the air district decides · All SRA · since Nov 6");
  // Unchanged through the whole record: at least since recording began.
  const steady = reportProfile({ ...allowed, revision: 2 }, [revOf(1, "2026-11-14T00:57:52Z", allowed), revOf(2, "2026-11-15T00:57:52Z", allowed, "READING")], at);
  assert.deepEqual([stat(steady, "Unchanged for").value, stat(steady, "Unchanged for").sub], ["At least 3 days", "on record since Nov 13"]);
  // Truncated, loading or failed: a lower bound, or nothing.
  const cut = reportProfile({ ...allowed, revision: 60 }, [revOf(59, "2026-11-16T00:57:52Z", allowed, "READING"), revOf(60, "2026-11-16T12:57:52Z", allowed, "READING")], at, { complete: false });
  assert.deepEqual([stat(cut, "Unchanged for").value, stat(cut, "Unchanged for").sub], ["At least 24 h", "earlier history not loaded"]);
  assert.equal(stat(reportProfile({ ...allowed, revision: 60 }, [], at, { complete: false }), "Unchanged for").value, "Not known");
  // A suspension keeps its own sub-label.
  assert.equal(stat(reportProfile(burnEvent("BURN_PERMISSION_PROHIBITED", "CALFIRE_BURNING_SUSPENDED"), [], at), "CAL FIRE").sub, "All SRA · since Nov 6");
});

test("a monitored road under chains: its own figure beside the status, and on the timeline when it starts, changes and lifts", () => {
  const at = T("2026-11-22T22:00:00Z");
  const under = (status, ...levels) => { const e = roadEvent(status); return { ...e, roadSegment: { ...e.roadSegment, chains: levels.map((level) => ({ level, eventId: `cc:hwy4:${level.toLowerCase()}` })) } }; };
  const history = [revOf(1, "2026-11-20T08:00:00Z", under("OPEN")), revOf(2, "2026-11-21T16:53:00Z", under("OPEN", "R1")), revOf(3, "2026-11-21T20:00:00Z", under("OPEN", "R2", "R1"))];
  const p = reportProfile({ ...under("OPEN", "R2", "R1"), revision: 3 }, history, at);
  assert.equal(stat(p, "Road").value, "Open", "chains do not change the status");
  assert.deepEqual([stat(p, "Chains").value, stat(p, "Chains").sub], ["R2 required", "for 26 h, since Nov 21"]);
  assert.ok(lines(p).some((l) => /Chains: R1 required \(was None/.test(l)), lines(p).join(" | "));
  assert.ok(lines(p).some((l) => /Chains: R2 required \(was R1 required/.test(l)), lines(p).join(" | "));
  // Lifted: on the timeline, and no figure for a requirement that is not there.
  const lifted = reportProfile({ ...under("OPEN"), revision: 4 }, [...history, revOf(4, "2026-11-22T20:00:00Z", under("OPEN"))], at);
  assert.equal(stat(lifted, "Chains"), undefined);
  assert.ok(lines(lifted).some((l) => /Chains: None \(was R2 required/.test(l)), lines(lifted).join(" | "));
  // Truncated history: how long is a lower bound.
  const cut = reportProfile({ ...under("OPEN", "R2"), revision: 9 }, [revOf(9, "2026-11-22T10:00:00Z", under("OPEN", "R2"))], at, { complete: false });
  assert.equal(stat(cut, "Chains").sub, "for at least 12 h · earlier history not loaded");
  // Chains went on the record on 2026-11-19 22:00Z. A revision from before lists none whatever the road was under:
  // the first one after it is not "was None", and the figure says "at least", since recording began.
  const before = revOf(11, "2026-11-19T21:39:48Z", under("OPEN")), first = revOf(12, "2026-11-19T22:02:26Z", under("OPEN", "R2"));
  const deployed = reportProfile({ ...under("OPEN", "R2"), revision: 12 }, [before, first], T("2026-11-20T03:02:26Z"));
  assert.deepEqual([stat(deployed, "Chains").value, stat(deployed, "Chains").sub], ["R2 required", "for at least 5 h · on record since Nov 19"]);
  assert.ok(!lines(deployed).some((l) => /Chains/.test(l)), lines(deployed).join(" | "));
  const later = reportProfile({ ...under("OPEN"), revision: 13 }, [before, first, revOf(13, "2026-11-20T18:00:00Z", under("OPEN"))], T("2026-11-20T19:00:00Z"));
  assert.ok(lines(later).some((l) => /Chains: None \(was R2 required/.test(l)), lines(later).join(" | "));
  // A road with no chains on record has no such figure.
  assert.equal(stat(reportProfile({ ...roadEvent("OPEN"), revision: 1 }, [history[0]], at), "Chains"), undefined);
});

test("a monitored road that is not open says what set its status, and a change of cause is on its timeline", () => {
  const at = T("2026-11-19T03:00:00Z");
  const withCauses = (status, causes) => { const e = roadEvent(status); return { ...e, roadSegment: { ...e.roadSegment, causes } }; };
  const fire = { status: "CLOSED", source: "incident", eventId: "chp:261118ST0331", text: "" };
  const snow = { status: "RESTRICTED", source: "road_condition", eventId: "", text: "Chains are required from Arnold to Bear Valley" };
  assert.equal(roadCauseText(fire), "CHP incident 261118ST0331");
  assert.equal(roadCauseText(snow), "Caltrans road conditions: Chains are required from Arnold to Bear Valley");
  assert.equal(roadCauseText({ source: "lane_closure" }), "A Caltrans lane closure");
  const history = [revOf(1, "2026-11-17T05:00:00Z", roadEvent("OPEN")), revOf(2, "2026-11-18T22:00:00Z", withCauses("RESTRICTED", [snow])), revOf(3, "2026-11-19T01:08:00Z", withCauses("CLOSED", [fire, snow]))];
  const p = reportProfile({ ...withCauses("CLOSED", [fire, snow]), revision: 3 }, history, at);
  assert.deepEqual(p.sections, [{ title: "Why it is closed", items: [{ label: "Closed", value: "CHP incident 261118ST0331" }, { label: "Restricted", value: "Caltrans road conditions: Chains are required from Arnold to Bear Valley" }] }]);
  assert.ok(lines(p).some((l) => /CHP incident 261118ST0331/.test(l)), lines(p).join(" | "));
  // An open road, or an API that sends no causes, has no such section and no "Because" entry.
  const open = reportProfile({ ...roadEvent("OPEN"), revision: 1 }, [history[0]], at);
  assert.deepEqual(open.sections, []);
  assert.ok(!lines(open).some((l) => /Because/.test(l)));
});
