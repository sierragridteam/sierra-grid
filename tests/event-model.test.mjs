import { test } from "node:test";
import assert from "node:assert/strict";
import * as eventModel from "../src/lib/event-model.ts";
import { headlineCounts, feedOrder, humanize, reportTitle, isOccurrence, natureCounts, reportChanges, reportFeedProps } from "../src/lib/event-model.ts";
import { parseState, stateUrl } from "../src/lib/state.ts";

test("headline separates scheduled records and qualifies incomplete event counts", () => {
  const reports = [
    { status: "ACTIVE", severity: "SEVERE" },
    { status: "SCHEDULED", severity: "MODERATE" },
  ];
  const complete = headlineCounts(reports, false);
  assert.equal(complete.first, "2 events are active or scheduled in Ebbetts Pass Corridor.");
  assert.equal(complete.second, "1 is severe.");
  assert.equal(complete.active, 1);
  assert.equal(complete.scheduled, 1);
  assert.match(headlineCounts(reports, true).first, /^At least 2/);
  assert.match(headlineCounts([], true).second, /More reports/);
  assert.equal(headlineCounts([], false).total, 0);
});

test("feed prioritizes severity then Grid receipt, never a future node clock", () => {
  const reports = [
    { id: "node", severity: "INFO", ingestedAt: "2026-11-01T10:00:00Z", observedAt: "2099-01-01T00:00:00Z" },
    { id: "older", severity: "SEVERE", ingestedAt: "2026-10-01T10:00:00Z" },
    { id: "newer", severity: "SEVERE", ingestedAt: "2026-11-01T10:00:00Z" },
  ];
  assert.deepEqual([...reports].sort(feedOrder).map(r => r.id), ["newer", "older", "node"]);
});

test("report history includes changed source narrative and does not invent changes from receipt clocks", () => {
  const before = { status: "ACTIVE", severity: "MINOR", headline: "Road incident", summary: "", description: "Lane blocked", ingestedAt: "2026-11-01T10:00:00Z" };
  const after = { ...before, description: "Lane reopened", status: "RESOLVED", ingestedAt: "2026-11-01T11:00:00Z" };
  assert.deepEqual(reportChanges(before, after).map(c => c.label), ["Status", "Original report"]);
  assert.deepEqual(reportChanges(before, { ...before, ingestedAt: after.ingestedAt }), []);
  assert.equal(reportChanges(before, { ...before, summary: "Road reopened" }).find(c => c.label === "Summary").kind, "added");
  assert.equal(reportChanges(before, { ...before, description: "" }).find(c => c.label === "Original report").kind, "removed");
});

test("browser filters, pagination and historical selection roundtrip without accepting arbitrary state", () => {
  const state = parseState(new URL("https://grid.example/history/?layer=POWER&status=RESOLVED&severity=SEVERE&record=pge:1&revision=3&pages=2"));
  const restored = parseState(new URL(stateUrl(state), "https://grid.example"));
  assert.equal(restored.revision, "3");
  assert.equal(restored.eventStatus, "RESOLVED");
  assert.equal(restored.severity, "SEVERE");
  assert.equal(restored.browserPages, 2);
  const invalid = parseState(new URL("https://grid.example/events/?status=nope&severity=oops&revision=x&pages=999"));
  assert.equal(invalid.eventStatus, "current");
  assert.equal(invalid.severity, "");
  assert.equal(invalid.revision, "");
  assert.equal(invalid.browserPages, 20);
});

test("the search query round-trips through the Search URL and is cleaned", () => {
  const state = parseState(new URL("https://grid.test/search/?q=%20bear%20%00valley%20"));
  assert.equal(state.query, "bear valley");
  assert.equal(new URL(stateUrl(state), "https://grid.test").searchParams.get("q"), "bear valley");
  // An old Events link is still read (the page sends it on to Search), but Events never writes one.
  const old = parseState(new URL("https://grid.test/events/?q=bear"));
  assert.equal(old.query, "bear");
  assert.equal(new URL(stateUrl(old), "https://grid.test").searchParams.has("q"), false);
});

test("a list with any key hash in it is a list of identifiers, names included", async () => {
  const { identifierList } = await import("../src/lib/event-model.ts");
  const a = "0b0b037985e4980662d3e7862d35aebb4a01642eeca2eee561c5065d05c9acf5", b = "0F0F038DE5FD9631E7C6E6DE50844A69E489DD94681640BB92ED8F1C177FFC13";
  assert.deepEqual(identifierList(`${a}, ${b}`), [a, b]);
  assert.deepEqual(identifierList(a), [a], "a lone hash is a list of one");
  // Gateway lists mix hashes with a reporter's name; that used to fall
  // through and reach the page as one comma-separated run of hashes.
  assert.deepEqual(identifierList(`${a}, ${b}, relay`), [a, b, "relay"]);
  assert.equal(identifierList("Hwy 4, near Arnold"), undefined, "ordinary text with a comma is not a list of identifiers");
  assert.equal(identifierList("relay"), undefined);
  assert.equal(identifierList(""), undefined);
  // A long count is a number: a node's airtime in milliseconds was drawn as a pill.
  assert.equal(identifierList("18772000"), undefined);
  assert.deepEqual(identifierList("12345678, 0b0b0379"), ["12345678", "0b0b0379"], "among hashes, an entry of digits is still an entry");
});

test("a change with a list of identifiers on either side is a list on both", async () => {
  const { changeValues } = await import("../src/lib/event-model.ts");
  const a = "0B0B037985E4980662D3E7862D35AEBB4A01642EECA2EEE561C5065D05C9ACF5", b = "0F0F038DE5FD9631E7C6E6DE50844A69E489DD94681640BB92ED8F1C177FFC13";
  const mesh = (gateways) => ({ status: "ACTIVE", severity: "INFO", headline: "Node", mesh: { name: "Node", telemetry: { gateways } } });
  const change = (before, after) => { const c = reportChanges(mesh(before), mesh(after)).find(c => c.label === "Telemetry · Gateways"); return c && changeValues(c); };
  // The live case (2026-11-19): a node heard by gateways and the relay, then by the relay alone, and back.
  assert.deepEqual(change([a, b, "relay"], ["relay"]), { before: [a, b, "relay"], after: ["relay"] });
  assert.deepEqual(change(["relay"], [a, b]), { before: ["relay"], after: [a, b] });
  assert.deepEqual(change([a], [a, b]), { before: [a], after: [a, b] });
  // A side the report did not have is the empty list, not an entry called "Not supplied".
  assert.deepEqual(change([], [a, b]), { before: [], after: [a, b] });
  assert.deepEqual(change([a, b], []), { before: [a, b], after: [] });
  // No side is ever the keys as one text.
  for (const sides of [change([a, b, "relay"], ["relay"]), change(["relay"], [a, b])]) for (const side of Object.values(sides)) assert.ok(Array.isArray(side));
  // Ordinary text stays text, commas and all.
  assert.deepEqual(changeValues({ kind: "changed", before: "Hwy 4, near Arnold", after: "Hwy 4, near Dorrington" }), { before: "Hwy 4, near Arnold", after: "Hwy 4, near Dorrington" });
  assert.deepEqual(changeValues({ kind: "added", before: "Not supplied", after: "relay" }), { before: "Not supplied", after: "relay" });
});

test("what is an event is the API's word (nature); an API without it falls back to 'everything but mesh nodes'", () => {
  assert.equal(isOccurrence({ layer: "ROAD_SEGMENT", nature: "STATE" }), false);
  assert.equal(isOccurrence({ layer: "BURN_STATUS", nature: "STATE" }), false);
  assert.equal(isOccurrence({ layer: "CHAIN_CONTROL", nature: "OCCURRENCE" }), true);
  assert.equal(isOccurrence({ layer: "MESH", nature: "OCCURRENCE" }), true, "the API's word wins over the layer");
  assert.equal(isOccurrence({ layer: "WILDFIRE", nature: "SOMETHING_NEWER" }), true, "a nature this build does not know is not standing state");
  // An older API: no nature. Only mesh nodes were left out before the field existed.
  assert.equal(isOccurrence({ layer: "MESH" }), false);
  assert.equal(isOccurrence({ layer: "ROAD_SEGMENT" }), true);
  assert.equal(isOccurrence({ layer: "BURN_STATUS", nature: null }), true);
  assert.equal(isOccurrence({ layer: "MESH", nature: "" }), false);
  assert.equal(isOccurrence({ layer: "MESH", nature: "EVENT_NATURE_UNSPECIFIED" }), false, "unspecified says nothing, as absent does");
  assert.equal("ambientLayers" in eventModel, false, "Grid keeps no list of its own");
});

test("the Overview's count of events and the list it links to divide the same way", () => {
  const reports = [
    { layer: "CHAIN_CONTROL", nature: "OCCURRENCE", status: "ACTIVE", severity: "MODERATE" },
    { layer: "ROAD_INCIDENT", nature: "OCCURRENCE", status: "SCHEDULED", severity: "INFO" },
    { layer: "ROAD_SEGMENT", nature: "STATE", status: "ACTIVE", severity: "INFO" },
    { layer: "ROAD_SEGMENT", nature: "STATE", status: "ACTIVE", severity: "INFO" },
    { layer: "BURN_STATUS", nature: "STATE", status: "ACTIVE", severity: "INFO" },
  ];
  assert.deepEqual(natureCounts(reports), { occurrences: 2, standing: 3, standingTypes: ["Road status", "Burn day"] });
  assert.equal(headlineCounts(reports.filter(isOccurrence), false).total, natureCounts(reports).occurrences);
  assert.deepEqual(natureCounts([]), { occurrences: 0, standing: 0, standingTypes: [] });
});

test("a revision row in a list is a revision: lists read changes only, so none is labelled a reading", () => {
  const report = { headline: "h", severity: "INFO", status: "ACTIVE", layer: "BURN_STATUS", areaLabel: "a", provenance: {}, ingestedAt: "2026-11-16T20:10:00Z" };
  const props = reportFeedProps(report, "/x", { revision: 4, kind: "READING", observedAt: "2026-11-16T20:10:00Z" });
  assert.match(props.when, / · Revision 4$/);
  assert.doesNotMatch(props.when, /Reading/);
});

test("CAL FIRE's own status reads as words", () => {
  assert.equal(humanize("CALFIRE_BURNING_ALLOWED"), "Burning allowed");
  assert.equal(humanize("CALFIRE_PERMIT_REQUIRED"), "Permit required");
});

test("two alerts of one product are told apart by the API's subhead; without one the title is the headline", () => {
  assert.equal(reportTitle({ headline: "Winter Storm Warning", subhead: "1 to 3 ft above 5,000 ft" }), "Winter Storm Warning · 1 to 3 ft above 5,000 ft");
  assert.equal(reportTitle({ headline: "Winter Storm Warning", subhead: "" }), "Winter Storm Warning");
  assert.equal(reportTitle({ headline: "Wind Advisory." }), "Wind Advisory", "an API that does not send the field");
  assert.equal(reportTitle({ headline: "", subhead: " " }), "Untitled report");
  const row = reportFeedProps({ headline: "Winter Storm Warning", subhead: "Up to a foot, 4,000 to 5,000 ft", severity: "SEVERE", status: "ACTIVE", layer: "WEATHER_ALERT", ingestedAt: "2026-11-17T06:02:00Z", provenance: { sourceName: "NWS" } }, "#");
  assert.equal(row.title, "Winter Storm Warning · Up to a foot, 4,000 to 5,000 ft");
});

test("a severe standing condition counts in 'N are severe', so the sentence and the severity list agree", () => {
  const ev = (layer, nature, severity, status = "ACTIVE") => ({ layer, nature, severity, status });
  const events = [ev("ROAD_INCIDENT", "OCCURRENCE", "SEVERE"), ev("WEATHER_ALERT", "OCCURRENCE", "SEVERE"), ev("POWER", "OCCURRENCE", "INFO")];
  const standing = [ev("ROAD_SEGMENT", "STATE", "SEVERE"), ev("ROAD_SEGMENT", "STATE", "SEVERE"), ev("ROAD_SEGMENT", "STATE", "INFO"), ev("BURN_STATUS", "STATE", "INFO")];
  const both = headlineCounts(events, false, undefined, standing);
  assert.equal(both.total, 3, "standing state is still not an event");
  assert.match(both.first, /^3 events are active/);
  assert.equal(both.second, "4 are severe.");
  assert.equal(headlineCounts([events[2]], false, undefined, [standing[0]]).second, "1 is severe.");
  assert.equal(headlineCounts(events, false, undefined, [standing[2], standing[3]]).second, "2 are severe.");
  assert.equal(headlineCounts(events, false).second, "2 are severe.", "callers that pass no standing reports read as before");
  assert.equal(headlineCounts(events, false, undefined, [ev("ROAD_SEGMENT", "STATE", "SEVERE", "EXPIRED")]).second, "2 are severe.", "a standing report that has ended does not count");
  assert.equal(headlineCounts(events, false, undefined, [ev("ROAD_SEGMENT", "STATE", "EXTREME")]).second, "1 is extreme.");
});
