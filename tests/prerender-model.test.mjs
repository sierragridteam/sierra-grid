import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTABLE, beganAt, hasEnded, inPastTense, isNotable, plausible, recordLd, recordPage, staticSections } from "../src/lib/prerender-model.ts";
import { absolute, deepLink, recordPath } from "../src/lib/seo-model.ts";

const builtAt = Date.parse("2026-11-27T18:29:00Z");
const base = { status: "RESOLVED", severity: "MODERATE", headline: "", areaLabel: "", summary: "", description: "", subhead: "", canonicalUrl: "", effective: null, expires: null, observedAt: null, revision: 1, provenance: { sourceId: "x", sourceName: "", attribution: "", sourceUrl: "" } };
const report = (id, layer, extra = {}) => ({ ...base, id, layer, ingestedAt: "2026-11-01T00:00:00Z", ...extra });
const rev = (revision, at, event, kind = "CHANGE") => ({ revision, kind, observedAt: at, ingestedAt: at, event: { ...event, revision } });
const empty = (over = {}) => ({
  builtAt, notable: { items: [], incomplete: false }, histories: {},
  roads: { segments: [], revisions: [], incomplete: false, days: 30, from: Date.parse("2026-10-28T18:00:00Z") },
  burn: { events: [], histories: {} },
  sources: { rows: [], health: [], revisions: [], incomplete: false, days: 30, from: Date.parse("2026-10-28T18:00:00Z") },
  mesh: { items: [], incomplete: false }, power: { items: [], incomplete: false, weeks: 13 }, scanners: [], cameras: [], ...over,
});
/** Every word a section puts on the page. */
const words = (sections) => sections.flatMap((s) => [s.title, s.lead ?? "", s.note ?? "", ...s.entries.flatMap((e) => [e.text, e.detail ?? ""])]).join("\n");
/** Words that say how things are, or how long ago, which a page read later cannot. */
const PRESENT = /\b(ago|just now|currently|right now|is open|are open|is closed|none active|no active)\b/i;

const chain = (status, extent, effective = "2026-11-23T03:02:10Z") => report("cc:hwy4:r2", "CHAIN_CONTROL", {
  status, effective, headline: `Hwy 4 chains required, ${extent} (R2)`, areaLabel: extent,
  description: "Chains or traction devices are required on all vehicles except four wheel drive vehicles with snow-tread tires.",
  provenance: { sourceId: "caltrans-cc", sourceName: "Caltrans", attribution: "cwwp2.dot.ca.gov", sourceUrl: "" },
  chainControl: { level: "R2", highway: "Highway 4", direction: "", inferred: false, signs: [], from: { place: extent.split(" to ")[0], location: { lat: 38.43934, lng: -120.07671 } }, to: { place: extent.split(" to ")[1] ?? extent, location: { lat: 38.4816, lng: -120.02152 } } },
});

test("which reports get a page: every fire, evacuation, alert and chain requirement; outages from moderate; road incidents from severe", () => {
  assert.deepEqual(NOTABLE.map((r) => [r.layer, r.severityMin ?? ""]), [["WILDFIRE", ""], ["EVACUATION", ""], ["WEATHER_ALERT", ""], ["CHAIN_CONTROL", ""], ["POWER", "MODERATE"], ["ROAD_INCIDENT", "SEVERE"]]);
  assert.ok(isNotable({ layer: "WILDFIRE", severity: "INFO" }));
  assert.ok(isNotable({ layer: "POWER", severity: "MODERATE" }) && !isNotable({ layer: "POWER", severity: "MINOR" }));
  assert.ok(isNotable({ layer: "ROAD_INCIDENT", severity: "SEVERE" }) && !isNotable({ layer: "ROAD_INCIDENT", severity: "MODERATE" }));
  for (const layer of ["MESH", "ROAD_SEGMENT", "BURN_STATUS", "SOURCE_HEALTH"]) assert.ok(!isNotable({ layer, severity: "EXTREME" }), `${layer} is standing state, on its own page`);
  assert.ok(hasEnded({ status: "RESOLVED" }) && hasEnded({ status: "EXPIRED" }) && !hasEnded({ status: "ACTIVE" }) && !hasEnded({ status: "SCHEDULED" }));
});

test("an ended report's page is indexable and says when it ended as of a saved revision, never as of now", () => {
  const first = chain("ACTIVE", "Poison Springs to Mount Reba Road"), second = chain("ACTIVE", "Tamarack to Mount Reba Road"), last = chain("RESOLVED", "Tamarack to Mount Reba Road");
  const history = { complete: true, revisions: [rev(3, "2026-11-24T02:36:12Z", last), rev(2, "2026-11-23T18:36:13Z", second), rev(1, "2026-11-23T03:05:00Z", first)] };
  const page = recordPage({ ...last, revision: 3 }, history, builtAt);
  assert.equal(page.path, "/events/cc-hwy4-r2/");
  assert.equal(page.live, deepLink("cc:hwy4:r2"));
  assert.equal(page.title, "Hwy 4 chains required, Tamarack to Mount Reba Road (R2), Nov 22, 2026", "the day it began, in Pacific time, with its year");
  assert.ok(page.ended && page.indexable);
  assert.equal(page.lastSaved, "2026-11-24T02:36:12.000Z");
  assert.equal(page.firstSaved, "2026-11-23T03:05:00.000Z");
  assert.match(page.note.text, /^At Grid's last saved revision, Nov 23, 2026, 18:36 PT, this report had ended \(status “Resolved”\)\. This page was built Nov 27, 2026, 10:29 PT/);
  assert.match(page.description, /^Chain control requirement for Tamarack to Mount Reba Road, from Caltrans \(cwwp2\.dot\.ca\.gov\)\. First saved by Grid Nov 22, 2026, 19:05 PT; ended by Nov 23, 2026, 18:36 PT\. 3 saved revisions/);
  assert.deepEqual(page.lines, ["Tamarack to Mount Reba Road", "Caltrans (cwwp2.dot.ca.gov)", "Began Nov 22, 2026, 19:02 PT"]);
  // The timeline has the domain's words and no "Now": the page is not read now.
  assert.ok(page.timeline.some((m) => m.label === "R2 posted") && page.timeline.some((m) => m.label === "Lifted"));
  assert.ok(!page.timeline.some((m) => m.label === "Now"));
  // Revisions newest first, each with what changed from the one before it.
  assert.deepEqual(page.revisions.map((r) => [r.revision, r.what]), [[3, "changes"], [2, "changes"], [1, "first"]]);
  assert.deepEqual(page.revisions[0].changes.map((c) => [c.label, c.before, c.after]), [["Status", "Active", "Resolved"]]);
  assert.ok(page.revisions[1].changes.some((c) => c.label === "Headline"));
  assert.equal(page.historyNote, undefined);
  assert.ok(!page.facts.some((f) => f.label === "Status"), "a bare status reads as how things are");
  assert.ok(!page.facts.some((f) => /Lat|Lng/.test(f.label)) && !page.revisions.some((r) => r.changes.some((c) => /Lat|Lng/.test(c.label))), "coordinates are not details");
  assert.ok(page.facts.some((f) => f.label === "Level" && f.value === "R2"));
  assert.ok(!PRESENT.test(JSON.stringify(page)), "no word of the present on a page read later");
});

test("a report that has not ended still has its page, unindexed, and it sends the reader to the live report", () => {
  const active = chain("ACTIVE", "Tamarack to Mount Reba Road");
  const page = recordPage(active, { complete: true, revisions: [rev(1, "2026-11-23T03:05:00Z", active)] }, builtAt);
  assert.ok(!page.ended && !page.indexable);
  assert.equal(page.note.tone, "brass");
  assert.match(page.note.text, /had not ended at Grid's last saved revision, Nov 22, 2026, 19:05 PT\. This page is a snapshot built Nov 27, 2026, 10:29 PT and says nothing of the present/);
  assert.ok(!/ended by/.test(page.description));
  assert.equal(page.path, recordPath(active.id), "the same address before and after it ends, so a link never breaks");
});

test("a page does not pass off part of a history as the whole, or guess a change it cannot see", () => {
  const r = chain("RESOLVED", "Tamarack");
  const missing = recordPage({ ...r, revision: 7 }, undefined, builtAt);
  assert.equal(missing.historyNote, "The saved revisions of this report could not be read when this page was built.");
  assert.deepEqual(missing.revisions, []);
  assert.match(missing.description, /^Chain control requirement for Tamarack, from Caltrans \(cwwp2\.dot\.ca\.gov\)\. On record with Grid; ended by .*\. 7 saved revisions\.$/, "no first save claimed without revision 1, and no changes promised that the page cannot show");
  const partial = recordPage({ ...r, revision: 45 }, { complete: false, revisions: [rev(45, "2026-11-23T18:26:13Z", r), rev(44, "2026-11-23T18:00:00Z", chain("ACTIVE", "Tamarack")), rev(42, "2026-11-23T17:00:00Z", chain("ACTIVE", "Tamarack"))] }, builtAt);
  assert.equal(partial.historyNote, "3 revisions of 45 shown. The rest are in the live report.");
  assert.equal(partial.firstSaved, undefined);
  assert.deepEqual(partial.revisions.map((x) => x.what), ["changes", "unknown", "unknown"], "42 has no 41 beside it, and 44 no 43");
  assert.match(partial.description, /45 saved revisions\.$/, "only three of them are on the page");
});

test("a report page's structured data is a Report with its source and dates", () => {
  const r = report("calfire:abc", "WILDFIRE", { headline: "Gann Fire", areaLabel: "Hogan Dam Road, Valley Springs", effective: "2026-08-04T00:27:00Z", canonicalUrl: "https://www.fire.ca.gov/incidents/2026/8/3/gann-fire", provenance: { sourceId: "calfire", sourceName: "CAL FIRE", attribution: "CAL FIRE", sourceUrl: "" }, wildfire: { acres: 10339, containment: 100, county: "Calaveras", cause: "", hasPerimeter: false } });
  const page = recordPage(r, { complete: true, revisions: [rev(1, "2026-08-04T00:40:00Z", r)] }, builtAt);
  const ld = recordLd(page, r, absolute, "https://sierragridteam.org/#organization");
  assert.equal(ld["@type"], "Report");
  assert.equal(ld.url, "https://grid.sierragridteam.org/events/calfire-abc/");
  assert.equal(ld.datePublished, "2026-08-04T00:40:00.000Z");
  assert.equal(ld.isBasedOn, "https://www.fire.ca.gov/incidents/2026/8/3/gann-fire");
  assert.deepEqual(ld.sourceOrganization, { "@type": "Organization", name: "CAL FIRE" });
  assert.equal(ld.contentLocation.name, "Hogan Dam Road, Valley Springs");
  assert.deepEqual(page.source, { label: "CAL FIRE", href: "https://www.fire.ca.gov/incidents/2026/8/3/gann-fire" });
});

test("the road record lists what was saved with its time, links a chain requirement to its page, and a road to its revision", () => {
  const road = (status, chains = []) => report("road:hwy4-arnold-bearvalley", "ROAD_SEGMENT", { status: "ACTIVE", roadSegment: { roadId: "hwy4-arnold-bearvalley", name: "Hwy 4", section: "Arnold to Bear Valley", status, beyond: [], causes: [], chains } });
  const cc = chain("ACTIVE", "Tamarack to Mount Reba Road");
  const snap = empty({
    notable: { items: [chain("RESOLVED", "Tamarack")], incomplete: false },
    roads: { days: 30, from: Date.parse("2026-10-28T18:00:00Z"), incomplete: false, segments: [road("OPEN")],
      revisions: [rev(3, "2026-11-23T18:05:34Z", road("OPEN")), rev(2, "2026-11-22T19:05:00Z", road("CLOSED")), rev(1, "2026-11-17T04:46:00Z", road("OPEN")), rev(1, "2026-11-23T03:05:00Z", cc)] },
  });
  const [record, monitored] = staticSections("roads", snap);
  assert.deepEqual(record.entries.map((e) => [e.text, e.detail, e.href]), [
    ["Hwy 4 Arnold to Bear Valley reopened", "was closed", deepLink("road:hwy4-arnold-bearvalley", 3)],
    ["R2 posted", "Hwy 4, Tamarack to Mount Reba Road", "/events/cc-hwy4-r2/"],
    ["Hwy 4 Arnold to Bear Valley closed", "was open", deepLink("road:hwy4-arnold-bearvalley", 2)],
  ]);
  assert.match(record.lead, /in the 30 days before Nov 27, 2026, 10:29 PT, newest first\. Road status has been on record since Nov 16, 2026\.$/);
  assert.equal(record.note, undefined);
  // The monitored roads are named; how each stands is live data and is not said.
  assert.deepEqual(monitored.entries, [{ text: "Hwy 4 Arnold to Bear Valley", href: deepLink("road:hwy4-arnold-bearvalley") }]);
  assert.ok(!PRESENT.test(words([record, monitored])));
});

test("an empty or partly read road record says which, and never that nothing happened", () => {
  const [none] = staticSections("roads", empty());
  assert.deepEqual(none.entries, []);
  assert.equal(none.note, "No change is on record in the 30 days before Nov 27, 2026, 10:29 PT. That is what Grid saved, not proof that nothing changed.");
  const [partial] = staticSections("roads", empty({ roads: { ...empty().roads, incomplete: true } }));
  assert.match(partial.lead, /in up to the 30 days before/);
  assert.equal(partial.note, "No change in the part of the record that was read. Older entries were not read.");
});

test("fires and evacuations on record are counted as what Grid saved, with 'at least' when the list was cut short", () => {
  const fire = (id, name, acres, effective, containment = 100) => report(id, "WILDFIRE", { headline: `${name} Fire`, areaLabel: "Valley Springs", effective, observedAt: "2026-08-14T04:51:00Z", provenance: { sourceId: "calfire", sourceName: "CAL FIRE", attribution: "CAL FIRE", sourceUrl: "" }, wildfire: { acres, containment, county: "Calaveras", cause: "", hasPerimeter: false } });
  const zone = (id, level, effective) => report(`evac:${id}`, "EVACUATION", { headline: `Evacuation ${level} — ${id}`, areaLabel: "CALAVERAS", effective, evacuation: { zoneId: id, level, county: "CALAVERAS", eventType: "" } });
  const items = [fire("calfire:gann", "Gann", 10339, "2026-08-04T00:27:00Z"), fire("calfire:oneil", "Oneil", 3, "2026-07-28T02:44:00Z", 0), zone("CCU-110", "ORDER", "2026-08-06T19:19:00Z"), zone("CCU-111", "WARNING", "2026-08-06T19:25:00Z")];
  const [fires, evacuations] = staticSections("WILDFIRE", empty({ notable: { items, incomplete: false } }));
  assert.match(fires.lead, /^2 wildfires in the corridor are on record with Grid, the first from Jul 27, 2026; the largest reported is the Gann Fire at 10,339 ac\. This is what Grid has saved from CAL FIRE and FIRIS, not a census of every fire\./);
  assert.deepEqual(fires.entries.map((e) => [e.text, e.href]), [["Gann Fire", "/events/calfire-gann/"], ["Oneil Fire", "/events/calfire-oneil/"]]);
  assert.match(fires.entries[0].detail, /^10,339 ac · 100% contained · Valley Springs · as last reported /);
  assert.ok(!/contained/.test(fires.entries[1].detail), "0 is how the source writes 'not reported'");
  assert.equal(evacuations.entries[0].text, "Calaveras County: 1 order, 1 warning");
  assert.equal(evacuations.entries[0].detail, "Zones CCU-110, CCU-111");
  assert.match(staticSections("WILDFIRE", empty({ notable: { items, incomplete: true } }))[0].lead, /^At least 2 wildfires/);
  const [noFires, noZones] = staticSections("WILDFIRE", empty());
  assert.match(noFires.lead, /^No wildfire in the corridor is on record with Grid as read Nov 27, 2026, 10:29 PT\. That is what Grid has saved, not proof that there was none\.$/);
  assert.match(noZones.lead, /not the state of any zone now\.$/);
});

test("the burn record is each call with its own day, the line's number, and CAL FIRE's status with when it was checked", () => {
  const burn = (observedAt, burnDay, message) => report("burn:calaveras-county", "BURN_STATUS", { status: "ACTIVE", areaLabel: "Calaveras County", burnStatus: { burnDay, permission: "BURN_PERMISSION_ALLOWED", calfireStatus: "CALFIRE_BURNING_ALLOWED", calfireObservedAt: "2026-11-27T18:23:00Z", calfireArea: "All SRA", calfireEffective: null,
    burnLines: [{ id: "calaveras-apcd", name: "Calaveras County burn line", phone: "+12097546600", burnDay, observation: { observedAt, message, transcript: "", confidence: 95 } }] } });
  const now = burn("2026-11-27T14:00:00Z", "BURN_DAY_YES", "Today is a burn day."), before = burn("2026-11-04T17:23:00Z", "BURN_DAY_NO", "Burning is prohibited until further notice.");
  const histories = { "burn:calaveras-county": { complete: true, revisions: [rev(2, "2026-11-27T14:03:00Z", now, "READING"), rev(1, "2026-11-04T17:25:00Z", before)] } };
  const [section] = staticSections("BURN_STATUS", empty({ burn: { events: [now], histories } }));
  assert.equal(section.title, "Calaveras County burn line: each recorded call");
  assert.match(section.lead, /each answer is for the day of its call\. Calaveras County burn line: \(209\) 754-6600\. CAL FIRE's own status, which burning also depends on, was “Burning allowed” when checked Nov 27, 2026, 10:23 PT\.$/);
  assert.deepEqual(section.entries.map((e) => [new Date(e.at).toISOString(), e.text, e.detail]), [
    ["2026-11-27T14:00:00.000Z", "Burn day", "“Today is a burn day.” · Calaveras County burn line"],
    ["2026-11-04T17:23:00.000Z", "No-burn day", "“Burning is prohibited until further notice.” · Calaveras County burn line"],
  ]);
  const [unread] = staticSections("BURN_STATUS", empty({ burn: { events: [now], histories: {} } }));
  assert.equal(unread.note, "The record of calls could not be read when this page was built.");
});

test("a list of names says what is known, not how it stands: mesh nodes, feeds, cameras and scanners", () => {
  const node = (name, nodeType) => report(`meshcore:${name}`, "MESH", { status: "ACTIVE", headline: name, mesh: { name, nodeType, publicKey: "", reachability: "", telemetry: {} } });
  const snap = empty({
    mesh: { items: [node("SIERRA Forest Meadows", "repeater"), node("SIERRA Eagle HQ", "repeater")], incomplete: false },
    sources: { ...empty().sources, rows: [{ id: "grid", name: "The Grid", kind: "INTERNAL" }, { id: "caltrans", name: "Caltrans (chain control)", kind: "FEED", attribution: "cwwp2.dot.ca.gov", homepageUrl: "https://quickmap.dot.ca.gov/", pollIntervalSeconds: 300 }, { id: "bad", name: "A feed", kind: "FEED", homepageUrl: "javascript:alert(1)", pollIntervalSeconds: 3600 }] },
    scanners: [{ feedId: "13524", channelLabel: "Sheriff / CAL FIRE Dispatch", agency: "Calaveras SO / CAL FIRE", broadcastifyUrl: "https://www.broadcastify.com/listen/feed/13524" }],
    cameras: [{ id: "d10-172", name: "EB 108 W/O Soulsbyville Rd", route: "SR-108", nearbyPlace: "Soulsbyville", county: "Tuolumne", elevationFeet: 2926 }],
  });
  const [mesh] = staticSections("mesh", snap);
  assert.deepEqual(mesh.entries.map((e) => [e.text, e.detail]), [["SIERRA Eagle HQ", "Repeater"], ["SIERRA Forest Meadows", "Repeater"]]);
  assert.match(mesh.lead, /^2 MeshCore nodes located in the corridor had a report with Grid when read Nov 27, 2026, 10:29 PT\. A name here says a node is known, not that it is being heard/);
  const [feeds, changes] = staticSections("sources", snap);
  assert.deepEqual(feeds.entries, [{ text: "A feed", detail: "read every 1 h", href: undefined }, { text: "Caltrans (chain control)", detail: "cwwp2.dot.ca.gov · read every 5 min", href: "https://quickmap.dot.ca.gov/" }], "Grid's own row is not a feed, and only an http(s) address is a link");
  assert.equal(changes, undefined, "no panel when no status history is kept");
  assert.deepEqual(staticSections("scanners", snap)[0].entries, [{ text: "Sheriff / CAL FIRE Dispatch", detail: "Calaveras SO / CAL FIRE", href: "https://www.broadcastify.com/listen/feed/13524" }]);
  assert.deepEqual(staticSections("cameras", snap)[0].entries, [{ text: "EB 108 W/O Soulsbyville Rd", detail: "SR-108 · Soulsbyville, Tuolumne County · 2,926 ft" }]);
});

test("power, alerts and events list only what has ended; a page with no record of its own has none", () => {
  const outage = (id, status, n) => report(`pge:${id}`, "POWER", { status, headline: `Power outage — ${n} customers`, effective: "2026-11-20T19:27:00Z", provenance: { sourceId: "pge", sourceName: "PG&E", attribution: "Pacific Gas and Electric", sourceUrl: "" }, power: { customersAffected: n } });
  const alert = (id, status) => report(`wx:${id}`, "WEATHER_ALERT", { status, headline: "Winter Storm Warning", effective: "2026-11-18T06:00:00Z", expires: "2026-11-20T12:00:00Z", weatherAlert: { areaDesc: "West Slope Northern Sierra Nevada" } });
  const items = [outage("1", "RESOLVED", 596), outage("2", "ACTIVE", 121), alert("a", "EXPIRED"), alert("b", "ACTIVE")];
  const snap = empty({ notable: { items, incomplete: false }, power: { items: [outage("1", "RESOLVED", 596), outage("9", "RESOLVED", 1)], incomplete: false, weeks: 13 } });
  const [power] = staticSections("POWER", snap);
  assert.match(power.lead, /^2 interruptions that have ended are on record for the 13 weeks before Nov 27, 2026, 10:29 PT, with 597 customers affected in all/);
  assert.deepEqual(power.entries.map((e) => e.href), ["/events/pge-1/"]);
  const [alerts] = staticSections("weather", snap);
  assert.deepEqual(alerts.entries.map((e) => [e.text, e.detail, e.href]), [["Winter Storm Warning", "until Nov 20, 2026, 04:00 PT · West Slope Northern Sierra Nevada", "/events/wx-a/"]]);
  assert.deepEqual(staticSections("WEATHER_ALERT", snap), staticSections("weather", snap));
  const [events] = staticSections("events", snap);
  assert.match(events.lead, /^2 ended reports have a page with its timeline and what changed at each saved revision: 1 weather alert, 1 power interruption\./);
  assert.deepEqual(events.entries.map((e) => e.href).sort(), ["/events/pge-1/", "/events/wx-a/"]);
  for (const view of ["search", "EVACUATION", "changes"]) assert.deepEqual(staticSections(view, snap), []);
  const [overview] = staticSections("discover", snap, { roads: "/roads/", WILDFIRE: "/wildfires/", POWER: "/power/" });
  assert.deepEqual(overview.entries.map((e) => e.href), ["/roads/", "/wildfires/", "/power/"]);
  for (const view of ["discover", "events", "roads", "weather", "WILDFIRE", "POWER", "mesh", "sources"]) assert.ok(!PRESENT.test(words(staticSections(view, snap, { roads: "/roads/" }))), view);
});

test("when a report began is the source's time once it had come, else Grid's first save, and never its newest revision's time", () => {
  // An evacuation zone carries no time of its own; its observedAt is when it was resolved.
  const zone = report("evac:US-CA-Toulumne100", "EVACUATION", { headline: "Evacuation Warning — US-CA-Toulumne100", areaLabel: "TUOLUMNE", observedAt: "2026-07-07T16:19:00Z", ingestedAt: "2026-07-07T16:19:05Z", evacuation: { zoneId: "US-CA-Toulumne100", level: "WARNING", county: "TUOLUMNE", eventType: "" } });
  const issued = { ...zone, status: "ACTIVE", evacuation: { ...zone.evacuation, level: "ORDER" } };
  const history = { complete: true, revisions: [rev(2, "2026-07-07T16:19:05Z", zone), rev(1, "2026-07-07T00:19:00Z", issued)] };
  assert.deepEqual(beganAt(zone, history), { at: Date.parse("2026-07-07T00:19:00Z"), by: "grid" });
  const page = recordPage({ ...zone, revision: 2 }, history, builtAt);
  assert.equal(page.lines.at(-1), "First saved by Grid Jul 6, 2026, 17:19 PT", "not 'Began', and not the day it was lifted");
  assert.match(page.title, /, Jul 6, 2026$/);
  // Without revision 1 nothing is known of its start: no date in the title, no line, no time in a list.
  const blind = recordPage({ ...zone, revision: 2 }, { complete: false, revisions: [rev(2, "2026-07-07T16:19:05Z", zone)] }, builtAt);
  assert.equal(blind.title, "Evacuation Warning — US-CA-Toulumne100");
  assert.deepEqual(blind.lines, ["TUOLUMNE", "a source that was not named"]);
  // An alert withdrawn before its onset did not begin then; a scheduled closure has not begun.
  const alert = report("wx:x", "WEATHER_ALERT", { status: "EXPIRED", headline: "Red Flag Warning", effective: "2026-10-03T18:00:00Z" });
  const withdrawn = { complete: true, revisions: [rev(2, "2026-10-03T16:58:00Z", alert), rev(1, "2026-10-02T21:00:00Z", { ...alert, status: "ACTIVE" })] };
  assert.equal(beganAt(alert, withdrawn).by, "grid");
  assert.equal(recordPage(alert, withdrawn, builtAt).lines.at(-1), "First saved by Grid Oct 2, 2026, 14:00 PT");
  const begun = report("calfire:a", "WILDFIRE", { headline: "Gann Fire", effective: "2026-08-04T00:27:00Z" });
  assert.deepEqual(beganAt(begun, { complete: true, revisions: [rev(1, "2026-08-04T00:40:00Z", begun)] }), { at: Date.parse("2026-08-04T00:27:00Z"), by: "source" });

  // The evacuation list: the day it was first saved, and the highest level it reached.
  const [, evacuations] = staticSections("WILDFIRE", empty({ notable: { items: [zone], incomplete: false }, histories: { [zone.id]: history } }));
  assert.equal(evacuations.entries[0].text, "Tuolumne County: 1 order");
  assert.equal(new Date(evacuations.entries[0].at).toISOString(), "2026-07-07T00:19:00.000Z");
  assert.match(evacuations.lead, /Each is counted at the highest level it reached\./);
  // The events list gives a report with no known start no time, rather than a wrong one.
  const [events] = staticSections("events", empty({ notable: { items: [{ ...zone, revision: 2 }], incomplete: false }, histories: {} }));
  assert.equal(events.entries[0].at, undefined);
  // A report still at its first revision is its own first save.
  assert.equal(staticSections("events", empty({ notable: { items: [zone], incomplete: false }, histories: {} }))[0].entries[0].at, Date.parse(zone.ingestedAt));
});

test("a page's revisions carry the same clock as its first and last save", () => {
  const r = report("pge:1", "POWER", { status: "RESOLVED", headline: "Power outage — 121 customers" });
  const saved = (n, observedAt, ingestedAt, event) => ({ revision: n, kind: "CHANGE", observedAt, ingestedAt, event: { ...event, revision: n } });
  const history = { complete: true, revisions: [saved(2, "2026-11-27T17:48:00Z", "2026-11-27T17:58:00Z", r), saved(1, "2026-11-27T11:34:00Z", "2026-11-27T11:43:00Z", { ...r, status: "ACTIVE" })] };
  const page = recordPage({ ...r, revision: 2 }, history, builtAt);
  assert.deepEqual(page.revisions.map((x) => new Date(x.at).toISOString()), [page.lastSaved, page.firstSaved]);
});

test("entries worded for a live page are said in the past on one read later", () => {
  assert.equal(inPastTense("Hwy 49 Angels Camp to Sonora now restricted"), "Hwy 49 Angels Camp to Sonora became restricted");
  assert.equal(inPastTense("R2 now Tamarack to Mount Reba Road"), "R2 stretch changed to Tamarack to Mount Reba Road");
  assert.equal(inPastTense("Hwy 4 Arnold to Bear Valley: chains now R1"), "Hwy 4 Arnold to Bear Valley: chains changed to R1");
  assert.equal(inPastTense("R2 in effect"), "R2 was in effect");
  assert.equal(inPastTense("Now Cottage Springs to Tamarack"), "Changed to Cottage Springs to Tamarack");
  for (const kept of ["R2 posted again", "Hwy 4 Arnold to Bear Valley reopened", "Hwy 4 Arnold to Bear Valley: chains lifted", "Lifted", "First saved by Grid"]) assert.equal(inPastTense(kept), kept);
  // On the pages: a road that became restricted, and a stretch that moved, in the record and on the requirement's own timeline.
  const road = (status) => report("road:hwy49", "ROAD_SEGMENT", { status: "ACTIVE", roadSegment: { roadId: "hwy49", name: "Hwy 49", section: "Angels Camp to Sonora", status, beyond: [], causes: [], chains: [] } });
  const a = chain("ACTIVE", "Poison Springs to Mount Reba Road"), b = chain("ACTIVE", "Tamarack to Mount Reba Road");
  const revisions = [rev(2, "2026-11-25T19:22:00Z", road("RESTRICTED")), rev(1, "2026-11-20T00:00:00Z", road("OPEN")), rev(2, "2026-11-23T18:36:13Z", b), rev(1, "2026-11-23T03:05:00Z", a)];
  const [record] = staticSections("roads", empty({ roads: { ...empty().roads, revisions } }));
  assert.deepEqual(record.entries.map((e) => e.text), ["Hwy 49 Angels Camp to Sonora became restricted", "R2 stretch changed to Tamarack to Mount Reba Road", "R2 posted"]);
  const page = recordPage({ ...b, revision: 2 }, { complete: true, revisions: revisions.slice(2) }, builtAt);
  assert.ok(page.timeline.some((m) => m.label === "Changed to Tamarack to Mount Reba Road"));
  for (const text of [...record.entries.map((e) => e.text), ...page.timeline.map((m) => m.label)]) assert.ok(!/\bnow\b|in effect$/i.test(text), text);
});

test("the power list is of the same weeks as its count, and a lower bound is called one twice", () => {
  const outage = (id, effective, n = 300) => report(`pge:${id}`, "POWER", { status: "RESOLVED", headline: `Power outage — ${n} customers`, effective, power: { customersAffected: n } });
  const inside = outage("in", "2026-11-20T19:27:00Z"), before = outage("old", "2026-08-20T19:27:00Z");
  const snap = empty({ notable: { items: [inside, before], incomplete: false }, power: { items: [inside], incomplete: true, weeks: 13 } });
  const [power] = staticSections("POWER", snap);
  assert.deepEqual(power.entries.map((e) => e.href), ["/events/pge-in/"], "a page from before the period is not under this period's count");
  assert.match(power.lead, /^At least 1 interruption that has ended is on record for the 13 weeks before .*, with at least 300 customers affected in all/);
  assert.match(power.lead, /Listed below are those of that period with a page of their own\.$/);
  // The Overview repeats the count, not the sentence about a list it does not show.
  const [overview] = staticSections("discover", snap, { POWER: "/power/" });
  assert.ok(overview.entries[0].detail.startsWith("At least 1 interruption") && !/Listed below/.test(overview.entries[0].detail));
});

test("the source record is worded for a page read later, with each period dated and no upstream error text", () => {
  const health = (status, since, error = "") => ({ ...report("source:caltrans", "SOURCE_HEALTH", { status: "ACTIVE", areaLabel: "Caltrans (chain control)" }), sourceHealth: { sourceId: "caltrans", status, since, error } });
  const revisions = [rev(3, "2026-11-18T10:00:00Z", health("OK", "2026-11-18T10:00:00Z")), rev(2, "2026-11-18T09:00:00Z", health("UNAVAILABLE", "2026-11-18T09:00:00Z", "dial tcp 10.40.34.72:49726: connection refused")), rev(1, "2026-11-01T00:00:00Z", health("OK", "2026-11-01T00:00:00Z"))];
  const sources = { ...empty().sources, health: [health("OK", "2026-11-18T10:00:00Z")], revisions };
  const [, changes] = staticSections("sources", empty({ sources }));
  assert.match(changes.lead, /^Each time a feed went stale or unavailable and came back, as Grid saved it in the 30 days before Nov 27, 2026, 10:29 PT, newest first\./);
  assert.deepEqual(changes.entries.map((e) => [e.text, e.detail]), [["Caltrans (chain control): current again", undefined], ["Caltrans (chain control): unavailable", undefined]]);
  assert.ok(!JSON.stringify(changes).includes("10.40.34.72"));
  const [, quiet] = staticSections("sources", empty({ sources: { ...sources, revisions: [] } }));
  assert.equal(quiet.note, "No status change is on record in the 30 days before Nov 27, 2026, 10:29 PT. That is what Grid saved, not proof that every feed was current throughout.");
  assert.ok(!/last 30 days/i.test(JSON.stringify(quiet)), "a period is named by its dates, not by 'last'");
});

test("a build does not publish a record far shorter than the one already published", () => {
  assert.equal(plausible({ published: 0, listed: 0 }), undefined, "the first build has nothing to compare with");
  assert.equal(plausible({ published: 226, listed: 219 }), undefined, "a few reports fell under the threshold and keep their pages");
  assert.match(plausible({ published: 226, listed: 3 }), /only 3 of the 226 reports with a published page are in the lists read/);
  assert.equal(plausible({ published: 10, listed: 0 }), undefined, "too few to tell a fault from a quiet season");
});
