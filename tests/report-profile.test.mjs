import { test } from "node:test";
import assert from "node:assert/strict";
import { reportProfile, duration } from "../src/lib/report-profile.ts";

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
