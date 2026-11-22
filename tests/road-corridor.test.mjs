import { test } from "node:test";
import assert from "node:assert/strict";
import { chainBands, chainFigure, chainRead, chainsOnRoute, fitLabel, labelRoom, routeChainNote, routeSlice, sectionChains, sectionLabels, chainStretch, chainCheckpoints, chainExtent, beyondClosures, beyondHeadline, beyondLabel, beyondText, roadsAnswer, severityRankOf, severityTone, alongRoute, closureNotice, routeChains, segmentName, signBoard, signCount, signPlaces, workJobs } from "../src/lib/road-corridor.ts";

const seg = (headline, coordinates, extra = {}) => ({ id: headline, headline, status: "OPEN", coordinates, ...extra });

test("segments chain end to start into one route, whatever the source order", () => {
  const chains = routeChains([
    seg("Hwy 4 — Murphys to Arnold", [[-120.0, 38.0], [-120.0, 38.1]]),
    seg("Hwy 49 — Angels Camp to Sonora", [[-121, 38], [-121, 38.2]]),
    seg("Hwy 4 — Angels Camp to Murphys", [[-120.0, 37.9], [-120.0, 38.0]]),
  ]);
  const hwy4 = chains.find((c) => c.route === "Hwy 4");
  assert.deepEqual(hwy4.stops.map((s) => s.label), ["Angels Camp", "Murphys", "Arnold"]);
  assert.ok(Math.abs(hwy4.length - 22.24) < 0.1);
  assert.equal(hwy4.sections[1].from, hwy4.sections[0].to);
  assert.deepEqual(segmentName("Hwy 49 — Angels Camp to Sonora"), { route: "Hwy 49", from: "Angels Camp", to: "Sonora" });
});

test("a point is placed along the route with its distance off the line", () => {
  const [chain] = routeChains([seg("Hwy 4 — A to B", [[-120.0, 38.0], [-120.0, 38.1]]), seg("Hwy 4 — B to C", [[-120.0, 38.1], [-119.9, 38.1]])]);
  const near = alongRoute(chain, [-119.95, 38.101]);
  assert.ok(Math.abs(near.at - (11.12 + 4.38)) < 0.2, String(near.at));
  assert.ok(near.off < 0.2);
  assert.ok(alongRoute(chain, [-121, 38]).off > 50);
});

test("closure notices give the named places and the reason", () => {
  assert.deepEqual(
    closureNotice("Is closed from 0.5 mi east of the Jct of SR 207 /Mt Reba Turnoff/ to the Jct of SR 89 /Ebbetts Pass/ (Alpine Co) - Due to snow - Motorists are advised to use an alternate route"),
    { from: "Mt Reba Turnoff", to: "Ebbetts Pass", reason: "snow" },
  );
  assert.equal(closureNotice(null), undefined);
  assert.equal(closureNotice("Open"), undefined);
});

test("work windows group into jobs by headline and place", () => {
  const w = (id, headline, area, start) => ({ id, headline, area, status: "SCHEDULED", start, end: start + 1 });
  const jobs = workJobs([w("1", "Hwy 4 one-way", "Horseshoe", 30), w("2", "Hwy 4 shoulder", "Avery", 10), w("3", "Hwy 4 one-way", "Horseshoe", 20)]);
  assert.deepEqual(jobs.map((j) => [j.headline, j.windows.map((x) => x.id)]), [["Hwy 4 shoulder", ["2"]], ["Hwy 4 one-way", ["3", "1"]]]);
});

test("signs with the same message merge; blank and out-of-service signs are counted apart", () => {
  const s = (id, pages, extra = {}) => ({ id, location: id, route: "SR-108", direction: "East", pages, inService: true, ...extra });
  const board = signBoard([s("a", [["SONORA PASS", "OPEN", ""]]), s("b", [["SONORA PASS", "OPEN"]]), s("c", []), s("d", [["X"]], { inService: false })]);
  assert.equal(board.showing.length, 1);
  assert.equal(board.showing[0].count, 2);
  assert.deepEqual(board.blank.map((x) => x.id), ["c", "d"]);
});

test("a face that stands for several signs names every place, and the count line says how many faces follow", () => {
  // 2026-11-19: Soulsbyville (Hwy 108) and the sign west of Yosemite on Hwy 120 both read "Sonora Pass closed".
  // The panel said "4 of 6 showing a message" over three cards, and the one card named Soulsbyville only.
  const s = (id, location, route, pages, since) => ({ id, location, route, direction: "East", pages, inService: true, since });
  const sonora = [["SONORA PASS", "CLOSED", ""], ["CHAIN CONTROL", "EAST OF", "TWAIN HARTE"]];
  const signs = [
    s("V42", "EB 108 SOULSBYVILLE", "SR-108", sonora, 200), s("V43", "EB 120 W/O YOSEMITE", "SR-108", sonora, 100),
    s("V50", "EB 4 W/O MURPHYS", "SR-4", [["EBBETTS PASS", "CLOSED"]], 300), s("V80", "EB 88 E/O PINE GROVE", "SR-88", [["HWY 88 CLOSED"]], 50),
    s("V81", "EB 88 AT DEW DROP", "SR-88", []), s("V111", "Virtual CMS", "SR-88", []),
  ];
  const board = signBoard(signs);
  assert.equal(board.showing.length, 3);
  assert.deepEqual([board.showing[0].count, board.showing[0].locations, board.showing[0].since], [2, ["EB 108 SOULSBYVILLE", "EB 120 W/O YOSEMITE"], 100], "both places, the earlier time");
  assert.equal(signPlaces(board.showing[0].locations), "EB 108 SOULSBYVILLE · EB 120 W/O YOSEMITE");
  assert.equal(signPlaces(board.showing[1].locations), "EB 4 W/O MURPHYS");
  assert.equal(signCount(board, signs.length), "4 of 6 showing a message · 3 different messages");
  // No shared message: the count is the number of cards, and says nothing more.
  assert.equal(signCount(signBoard(signs.filter((x) => x.id !== "V43")), 5), "3 of 5 showing a message");
  assert.equal(signCount(signBoard(signs.slice(0, 2)), 2), "2 of 2 showing a message · 1 different message");
  assert.equal(signCount(signBoard([]), 0), "0 of 0 showing a message");
  // A campaign on many signs: the first two places and how many more; a place is named once.
  assert.equal(signPlaces(["A", "B", "C"]), "A · B · C");
  assert.equal(signPlaces(["A", "B", "C", "D", "E"]), "A · B · and 3 more");
  const twins = signBoard([s("a", "DEW DROP", "SR-88", [["X"]], NaN), s("b", "DEW DROP", "SR-88", [["X"]], 7)]);
  assert.deepEqual([twins.showing[0].count, twins.showing[0].locations, twins.showing[0].since], [2, ["DEW DROP"], 7]);
});

test("work rows are named by the work and its place; the route is the group", async () => {
  const { workName } = await import("../src/lib/road-corridor.ts");
  assert.deepEqual(workName("Hwy 4 one-way traffic control (Drainage Work)", "Hwy 4 at Horeshoe Drive (Right), near Hathaway Pines"),
    { route: "Hwy 4", what: "One-way traffic control · drainage work", where: "Horeshoe Drive, near Hathaway Pines" });
  assert.deepEqual(workName("Hwy 49 lane closure (Drainage Work)", "Hwy 49 from Solinski Street (Left) to Washington Street, near Sonora"),
    { route: "Hwy 49", what: "Lane closure · drainage work", where: "Solinski Street to Washington Street, near Sonora" });
  assert.equal(workName("Road work", "Somewhere").route, "Other roads");
});

// The road_segment layer's `beyond` entry as the API sends it since 2026-11-19.
const winter = {
  name: "Ebbetts Pass winter closure", status: "CLOSED", side: "END", seasonal: true, severity: "INFO", severityRank: 0,
  headline: "Hwy 4: Ebbetts Pass winter closure (past Bear Valley) — snow", source: "road_condition", reason: "snow",
  description: "Is closed from the Mt. Reba turnoff to the Jct of SR 89 /Ebbetts Pass/ (Alpine Co) - Due to snow", from: "the Mt. Reba turnoff", to: "the Jct of SR 89 /Ebbetts Pass/",
};
const hwy4With = (beyond, extra = {}) => routeChains([
  seg("Hwy 4 — Angels Camp to Arnold", [[-120.5, 38.0], [-120.3, 38.2]]),
  seg("Hwy 4 — Arnold to Bear Valley", [[-120.3, 38.2], [-120.0, 38.4]], { beyond, ...extra }),
]);
const segmentsOf = (chains) => chains.flatMap((c) => c.sections.map((x) => x.segment));
const answerFor = (chains, controls = [], activeWork = 0) => roadsAnswer(chains, { segments: segmentsOf(chains), controls, activeWork });

test("a closure past the last stop leaves the route open to it and names where it runs to", () => {
  const [hwy4] = hwy4With([winter]);
  const [b] = beyondClosures(hwy4);
  assert.deepEqual([b.side, b.name, b.last, b.toward, b.reason], ["END", "Ebbetts Pass winter closure", "Bear Valley", "Ebbetts Pass", "snow"]);
  assert.equal(beyondText(b), "Ebbetts Pass winter closure past Bear Valley");
  assert.equal(beyondHeadline(b), winter.headline, "the source's own line is used when it gives one");
  assert.equal(hwy4.sections.every((x) => x.segment.status === "OPEN"), true);
  // A closure listed on a middle section, or one that is not a closure, is not a route-end closure.
  const [other] = routeChains([
    seg("Hwy 4 — Angels Camp to Arnold", [[-120.5, 38.0], [-120.3, 38.2]], { beyond: [{ status: "CLOSED", side: "END" }] }),
    seg("Hwy 4 — Arnold to Bear Valley", [[-120.3, 38.2], [-120.0, 38.4]], { beyond: [{ status: "RESTRICTED", side: "END" }] }),
  ]);
  assert.deepEqual(beyondClosures(other), []);
  assert.deepEqual(beyondClosures(routeChains([seg("Hwy 49 — Angels Camp to Sonora", [[-121, 38], [-121, 38.2]])])[0]), []);
});

test("whether a closure past a road's end is seasonal comes from the API's flag, never from its name, reason or the date", () => {
  const [b] = beyondClosures(hwy4With([winter])[0]);
  assert.deepEqual([b.seasonal, b.rank, b.tone, beyondLabel(b)], [true, 0, "muted", "Seasonal closure"]);
  // The same name and reason without the flag (an older API, or a closure the source does not call seasonal): not seasonal.
  const { seasonal: _, ...unflagged } = winter;
  for (const entry of [unflagged, { ...winter, seasonal: false }, { ...winter, seasonal: null }, { ...winter, seasonal: "true" }, { ...unflagged, reason: "seasonal_closure" }]) {
    const [x] = beyondClosures(hwy4With([entry])[0]);
    assert.equal(x.seasonal, false, JSON.stringify(entry.seasonal));
    assert.equal(beyondLabel(x), "Closed");
  }
  // And a flagged closure with no wintry word in it is seasonal all the same.
  const [summer] = beyondClosures(hwy4With([{ name: "Bridge works", status: "CLOSED", side: "END", seasonal: true, severity: "INFO" }])[0]);
  assert.deepEqual([summer.seasonal, beyondLabel(summer), beyondHeadline(summer)], [true, "Seasonal closure", "Hwy 4: Bridge works past Bear Valley"]);
});

test("a closure past a road's end is as prominent as its own severity", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(severityTone), ["muted", "muted", "elevated", "alarm", "alarm"]);
  assert.equal(severityRankOf({ severity: "SEVERE" }), 3, "the name is read when no rank is sent");
  assert.equal(severityRankOf({ severity: "INFO", severityRank: 2 }), 2, "the source's rank wins");
  assert.equal(severityRankOf({}), 0, "unrated is as quiet as INFO");
  assert.equal(severityRankOf({ severity: "SOMETHING_NEW" }), 0);
  const slide = { name: "Rockslide closure", status: "CLOSED", side: "END", seasonal: false, severity: "SEVERE", severityRank: 3, headline: "Hwy 4: rockslide closure (past Bear Valley)" };
  const washout = { name: "Washout", status: "CLOSED", side: "END", severity: "MODERATE", severityRank: 2, headline: "Hwy 4: washout (past Bear Valley)" };
  const got = beyondClosures(hwy4With([winter, washout, slide])[0]);
  assert.deepEqual(got.map((b) => [b.name, b.tone, b.seasonal]), [["Rockslide closure", "alarm", false], ["Washout", "elevated", false], ["Ebbetts Pass winter closure", "muted", true]], "most severe first, whatever the source order");
});

test("the Roads title for today's data: chains lead, the seasonal closure is the last line under it", () => {
  const chains = [...hwy4With([winter]), ...routeChains([seg("Hwy 49 — Angels Camp to Sonora", [[-121, 38], [-121, 38.2]])])];
  const r2 = { id: "cc:hwy4:r2", level: "R2", highway: "Highway 4", place: "Blue Lake Springs to Mount Reba Road", since: 0, coordinates: [-120.3, 38.2], from: "Blue Lake Springs", to: "Mount Reba Road" };
  assert.deepEqual(answerFor(chains, [r2], 1), {
    title: "Chains required on Hwy 4 from Blue Lake Springs to Mount Reba Road (R2)",
    lines: ["1 work zone active", "Hwy 4: Ebbetts Pass winter closure (past Bear Valley) — snow"],
    tone: "elevated",
  });
  // Nothing else going on: the routes are open, and the seasonal closure is still only a line.
  assert.deepEqual(answerFor(chains), { title: "All monitored routes are open", lines: [winter.headline], tone: "ok" });
});

test("the Roads title: a closure past a road's end that is not seasonal leads by its own severity", () => {
  const slide = { name: "Rockslide closure", status: "CLOSED", side: "END", seasonal: false, severity: "SEVERE", severityRank: 3, headline: "Hwy 4: rockslide closure (past Bear Valley)" };
  const severe = answerFor(hwy4With([winter, slide]));
  assert.equal(severe.title, "Hwy 4: rockslide closure (past Bear Valley)");
  assert.equal(severe.tone, "alarm");
  assert.deepEqual(severe.lines, ["Hwy 4 open Angels Camp to Bear Valley", winter.headline]);
  // Rated moderate: it still leads, without the alarm. No flag at all behaves the same as `seasonal: false`.
  const { seasonal: _, ...moderate } = { ...slide, severity: "MODERATE", severityRank: 2 };
  assert.deepEqual([answerFor(hwy4With([moderate])).title, answerFor(hwy4With([moderate])).tone], [slide.headline, "elevated"]);
  // The flag alone does not rank anything: the same winter closure without it, still INFO, is still a line.
  const { seasonal: __, ...unflagged } = winter;
  assert.deepEqual(answerFor(hwy4With([unflagged])), { title: "All monitored routes are open", lines: [winter.headline], tone: "ok" });
  // And one the source flags seasonal but rates severe leads: prominence is the severity's alone.
  assert.equal(answerFor(hwy4With([{ ...winter, severity: "SEVERE", severityRank: 3 }])).tone, "alarm");
  // A closed monitored section and a moderate closure past the end: the more severe is named first.
  const closed = hwy4With([moderate], { status: "CLOSED", description: "Is closed from /Arnold/ to /Bear Valley/ - Due to snow" });
  assert.equal(answerFor(closed).title, "Hwy 4 closed past Arnold — snow; Hwy 4: rockslide closure (past Bear Valley)");
  assert.equal(answerFor(closed).tone, "alarm");
});

// The chain_control layer as the API sends it since 2026-11-14: one feature per stretch, its signs nested.
const sign = (id, place, direction, coordinates, since = 1000, level = "R2") => ({ id, place, direction, level, since, coordinates });
const stretch = (id, highway, level, from, to, signs, extra = {}) => ({ id, level, highway, place: `${from} to ${to}`, from, to, since: Math.min(...signs.map((x) => x.since)), coordinates: signs[0].coordinates, signs, ...extra });
const hwy4Stretch = () => stretch("cc:hwy4:r2", "Highway 4", "R2", "Poison Springs", "Mount Reba Road", [
  sign("s1", "POISON SPRINGS", "Eastbound", [-120.2, 38.3], 3000), sign("s2", "TAMARACK", "Westbound", [-120.1, 38.35], 2000), sign("s3", "TAMARACK", "Eastbound", [-120.1, 38.351], 2500),
  sign("s4", "MOUNT REBA ROAD", "Westbound", [-120.0, 38.4], 1000),
]);

test("chain checkpoints: both directions at a place are one entry, named as a driver reads them", () => {
  const places = chainCheckpoints(hwy4Stretch());
  assert.deepEqual(places.map((p) => [p.highway, p.place, p.level, p.directions, p.since]), [
    ["Hwy 4", "Poison Springs", "R2", "Eastbound", 3000], ["Hwy 4", "Tamarack", "R2", "Both directions", 2000], ["Hwy 4", "Mount Reba Road", "R2", "Westbound", 1000]]);
  assert.ok(places.every((p) => p.control === "cc:hwy4:r2"));
  // A truck or hold restriction has no signs: it is its own single checkpoint.
  const hold = { id: "cc:3-9013", level: "", highway: "US 50", direction: "Westbound", place: "Meyers", since: 5, coordinates: [-120.02, 38.85] };
  assert.deepEqual(chainCheckpoints(hold).map((p) => [p.id, p.place, p.directions]), [["cc:3-9013", "Meyers", "Westbound"]]);
  assert.equal(chainExtent(hold).text, "at Meyers");
  assert.equal(chainExtent(hwy4Stretch()).text, "from Poison Springs to Mount Reba Road");
});

test("chain control on a route is the source's stretch, with its own ends", () => {
  const [hwy4] = routeChains([seg("Hwy 4 — Arnold to Bear Valley", [[-120.3, 38.2], [-120.2, 38.3], [-120.0, 38.4]])]);
  const peddler = stretch("cc:hwy88:r2", "Highway 88", "R2", "Lumber Yard", "Red Lake Creek", [sign("p", "PEDDLER VISTA", "Eastbound", [-120.27, 38.56])]);
  const s = chainStretch(hwy4, [hwy4Stretch(), peddler]);
  assert.equal(s.text, "Chains required on Hwy 4 from Poison Springs to Mount Reba Road (R2)");
  assert.equal(s.where, "Hwy 4 from Poison Springs to Mount Reba Road (R2)");
  assert.deepEqual(s.stretches[0].checkpoints.map((p) => p.place), ["Poison Springs", "Tamarack", "Mount Reba Road"]);
  assert.equal(s.since, 1000);
  assert.equal(chainStretch(hwy4, [peddler]), undefined);
  // One sign is "at", not "from … to".
  assert.equal(chainStretch(hwy4, [stretch("cc:hwy4:r2", "Highway 4", "R2", "Tamarack", "Tamarack", [sign("a", "TAMARACK", "Eastbound", [-120.1, 38.35])])]).text, "Chains required on Hwy 4 at Tamarack (R2)");
});

test("two levels on a route are two stretches, lowest on the route first", () => {
  const [hwy88] = routeChains([seg("Hwy 88 — Pioneer to Picketts", [[-120.4, 38.5], [-120.0, 38.7], [-119.9, 38.78]])]);
  const r1 = stretch("cc:hwy88:r1", "Highway 88", "R1", "Pickett's Junction", "Pickett's Junction", [sign("b", "PICKETT'S JUNCTION", "Westbound", [-119.93, 38.775], 1500, "R1")]);
  const r2 = stretch("cc:hwy88:r2", "Highway 88", "R2", "Lumber Yard", "Red Lake Creek", [sign("a", "LUMBER YARD", "Eastbound", [-120.3, 38.55]), sign("c", "RED LAKE CREEK", "Westbound", [-119.96, 38.71])]);
  const s = chainStretch(hwy88, [r1, r2]);
  assert.equal(s.text, "Chains required on Hwy 88 from Lumber Yard to Red Lake Creek (R2) and at Pickett's Junction (R1)");
  assert.deepEqual(s.levels, ["R1", "R2"]);
  assert.ok(s.stretches[0].at < s.stretches[1].at);
});

test("a stretch that begins before the monitored route still counts; a restriction without a level does not", () => {
  const [hwy4] = routeChains([seg("Hwy 4 — Arnold to Bear Valley", [[-120.3, 38.2], [-120.2, 38.3], [-120.0, 38.4]])]);
  // Low end 40 km before the route's start; the upper sign sits on it.
  const long = stretch("cc:hwy4:r1", "Highway 4", "R1", "Far Below", "Tamarack", [sign("x", "FAR BELOW", "Eastbound", [-120.8, 38.0], 1000, "R1"), sign("y", "TAMARACK", "Westbound", [-120.1, 38.35], 1000, "R1")], { inferred: true });
  const s = chainStretch(hwy4, [long]);
  assert.equal(s.text, "Chains required on Hwy 4 from Far Below to Tamarack (R1)");
  assert.deepEqual(s.stretches[0].checkpoints.map((p) => p.place), ["Tamarack"]);
  assert.equal(s.stretches[0].inferred, true);
  const hold = { id: "h", level: "", highway: "Highway 4", place: "Tamarack", since: 5, coordinates: [-120.1, 38.35] };
  assert.equal(chainStretch(hwy4, [hold]), undefined);
});

// A route up a meridian, so distances are easy: A to B and B to C are 11.1 km each; the R2 signs stand at 5.5 km, 16.6 km and 3.3 km past C.
const upHill = () => routeChains([seg("Hwy 4 — A to B", [[-120, 38.0], [-120, 38.1]]), seg("Hwy 4 — B to C", [[-120, 38.1], [-120, 38.2]])])[0];
const onHill = (level = "R2", lats = [38.05, 38.15, 38.23], names = ["Low Gate", "Mid Gate", "High Gate"]) =>
  stretch(`cc:hwy4:${level.toLowerCase()}`, "Highway 4", level, names[0], names.at(-1), lats.map((lat, i) => sign(`${level}-${i}`, names[i].toUpperCase(), "Eastbound", [-120, lat], 1000, level)));
const near = (got, want, by = 0.15) => assert.ok(Math.abs(got - want) < by, `${got} is not within ${by} of ${want}`);

test("a place at the end of a section's line is at the section's end on the strip, exactly", () => {
  const hill = upHill();
  assert.equal(alongRoute(hill, [-120, 38.1]).at, hill.sections[0].to, "the joint");
  assert.equal(alongRoute(hill, [-120, 38.2]).at, hill.length, "the route's end");
  assert.equal(alongRoute(hill, [-120, 38.3]).at, hill.length, "past the end: the end, and off the line");
  near(alongRoute(hill, [-120, 38.3]).off, 11.06);
  near(alongRoute(hill, [-120, 38.15]).at, hill.length * 0.75, 0.01);
  // A real line bends: the same holds whatever the pieces add up to.
  const [bendy] = routeChains([seg("Hwy 4 — A to B", [[-120.31, 38.21], [-120.27, 38.26], [-120.2, 38.3], [-120.13, 38.33]]), seg("Hwy 4 — B to C", [[-120.13, 38.33], [-120.07, 38.41], [-120.0, 38.4]])]);
  assert.equal(alongRoute(bendy, [-120.13, 38.33]).at, bendy.sections[0].to);
  assert.equal(alongRoute(bendy, [-119.9, 38.4]).at, bendy.length);
});

test("a stretch under chain control is an extent on the route: first to last checkpoint, clamped to the route", () => {
  const hill = upHill();
  const route = chainStretch(hill, [onHill()]);
  const [x] = route.stretches;
  near(x.from, 5.53); // Low Gate
  assert.equal(x.to, hill.length, "High Gate is past C: the extent stops at the route's end");
  const [band] = chainBands(route);
  assert.deepEqual([band.id, band.level, band.label, band.where, band.inferred], ["cc:hwy4:r2", "R2", "Chains R2", "Low Gate to High Gate", false]);
  assert.deepEqual([band.from, band.to], [x.from, x.to]);
  // The level is the source's, whatever it is.
  for (const level of ["R1", "R2", "R3"]) assert.equal(chainBands(chainStretch(hill, [onHill(level)]))[0].label, `Chains ${level}`);
  // Nothing on the route: nothing to draw.
  assert.deepEqual(chainBands(chainStretch(hill, [])), []);
  assert.deepEqual(chainBands(undefined), []);
});

test("a stretch that runs on past an end of the route reaches that end, however far its next checkpoint is", () => {
  const hill = upHill();
  // Low end 55 km before A, high end 45 km past C: the only checkpoint on the route is in the middle, and the whole route is under control.
  const through = chainStretch(hill, [onHill("R1", [37.5, 38.12, 38.6], ["Far Below", "Mid Gate", "Far Above"])]).stretches[0];
  assert.deepEqual([through.from, through.to], [0, hill.length]);
  assert.deepEqual(through.checkpoints.map((p) => p.place), ["Mid Gate"]);
  near(through.at, 13.3); // the marker stays at the checkpoint
  // A checkpoint far off to the side of the middle is not past an end and stretches nothing.
  const aside = chainStretch(hill, [stretch("cc:hwy4:r2", "Highway 4", "R2", "Low Gate", "Mid Gate", [sign("a", "LOW GATE", "Eastbound", [-120, 38.05]), sign("b", "MID GATE", "Eastbound", [-120, 38.15]), sign("c", "ELSEWHERE", "Eastbound", [-120.4, 38.1])])]).stretches[0];
  near(aside.from, 5.53);
  near(aside.to, 16.6);
});

test("two stretches on one route are two bands, in order along it", () => {
  const hill = upHill();
  const route = chainStretch(hill, [onHill("R2", [38.16, 38.19], ["Mid Gate", "Top Gate"]), onHill("R1", [38.03, 38.07], ["Low Gate", "Camp"])]);
  const bands = chainBands(route);
  assert.deepEqual(bands.map((b) => [b.label, b.where]), [["Chains R1", "Low Gate to Camp"], ["Chains R2", "Mid Gate to Top Gate"]]);
  assert.ok(bands[0].to < bands[1].from);
  assert.equal(routeChainNote(hill, route), "chains R1 from Low Gate to Camp and R2 from Mid Gate to Top Gate");
  // Each section says only what is on it.
  assert.deepEqual(sectionChains(hill, 0, route), { levels: ["R1"], label: "chains R1", text: "chains required (R1) from Low Gate to Camp" });
  assert.deepEqual(sectionChains(hill, 1, route), { levels: ["R2"], label: "chains R2", text: "chains required (R2) from Mid Gate to Top Gate" });
});

test("a section says chains only when a stretch is on it, and its status is not touched", () => {
  const hill = upHill();
  // One stretch across both sections.
  const across = chainStretch(hill, [onHill()]);
  assert.equal(sectionChains(hill, 0, across).label, "chains R2");
  assert.equal(sectionChains(hill, 1, across).text, "chains required (R2) from Low Gate to High Gate", "the source's ends, not the section's");
  // Two levels on the same section are both named.
  const both = chainStretch(hill, [onHill("R2", [38.16, 38.19], ["Mid Gate", "Top Gate"]), onHill("R1", [38.11, 38.14], ["B Gate", "Mid Gate"])]);
  assert.deepEqual(sectionChains(hill, 1, both), { levels: ["R1", "R2"], label: "chains R1, R2", text: "chains required (R1) from B Gate to Mid Gate and (R2) from Mid Gate to Top Gate" });
  assert.equal(sectionChains(hill, 0, both), undefined, "the section below stays as it is");
  // A stretch that begins at the joint is on the section above it only.
  const fromJoint = chainStretch(hill, [onHill("R2", [38.1, 38.18], ["B", "Top Gate"])]);
  assert.equal(sectionChains(hill, 0, fromJoint), undefined);
  assert.equal(sectionChains(hill, 1, fromJoint).label, "chains R2");
  // No stretch, no words; and the sections themselves are the same objects as before.
  assert.equal(sectionChains(hill, 0, undefined), undefined);
  assert.ok(hill.sections.every((x) => x.segment.status === "OPEN"));
});

// `road.chains` on the road_segment layer, as the API sends it since 2026-11-19: the stretches the source puts on a section.
const listedHill = (lower, upper) => routeChains([seg("Hwy 4 — A to B", [[-120, 38.0], [-120, 38.1]], lower === undefined ? {} : { chains: lower }), seg("Hwy 4 — B to C", [[-120, 38.1], [-120, 38.2]], upper === undefined ? {} : { chains: upper })])[0];
const listed = (level, from, to, eventId = `cc:hwy4:${level.toLowerCase()}`) => ({ level, eventId, from, to, headline: `Hwy 4 chains required, ${from} to ${to} (${level})`, since: "2026-11-18T08:53:41-08:00", inferred: false });

test("which stretch is on which section is the source's to say: its list is used, and an empty list is none", () => {
  // The stretch's low checkpoint stands 170 m below the joint: by position it reaches into A to B, and the source says it is not on it.
  const r2 = onHill("R2", [38.0985, 38.18], ["Blue Lake", "Top Gate"]);
  const hill = listedHill([], [listed("R2", "Blue Lake", "Top Gate")]);
  const route = chainStretch(hill, [r2]);
  assert.equal(sectionChains(hill, 0, route), undefined);
  assert.deepEqual(sectionChains(hill, 1, route), { levels: ["R2"], label: "chains R2", text: "chains required (R2) from Blue Lake to Top Gate" });
  // Without a list the same stretch is read from where it lies, and is on both.
  const unlisted = listedHill(undefined, undefined);
  assert.equal(sectionChains(unlisted, 0, chainStretch(unlisted, [r2])).label, "chains R2");
  // The band is the checkpoints' all the same: it starts where the sign stands.
  near(chainBands(route)[0].from, 11.12 - 0.17, 0.03);
  // Two on a section are named in order along the route, whatever order the list has; one the layer does not place keeps the list's order, last.
  const two = listedHill([], [listed("R2", "Mid Gate", "Top Gate"), listed("R1", "B Gate", "Mid Gate"), listed("R3", "Elsewhere", "Elsewhere", "cc:hwy4:r3")]);
  const placed = chainStretch(two, [onHill("R2", [38.16, 38.19], ["Mid Gate", "Top Gate"]), onHill("R1", [38.11, 38.14], ["B Gate", "Mid Gate"])]);
  assert.deepEqual(sectionChains(two, 1, placed), { levels: ["R1", "R2", "R3"], label: "chains R1, R2, R3", text: "chains required (R1) from B Gate to Mid Gate, (R2) from Mid Gate to Top Gate and (R3) at Elsewhere" });
});

test("when the chain-control layer could not be read, the requirements the sections list are still said", () => {
  const hill = listedHill([], [listed("R2", "Mid Gate", "Top Gate")]);
  // No layer, so no stretch to place and no band; the section and the route say what the road layer lists.
  assert.equal(sectionChains(hill, 1, undefined).label, "chains R2");
  assert.equal(routeChainNote(hill, undefined, "unknown"), "chains R2 from Mid Gate to Top Gate");
  assert.deepEqual(chainBands(undefined, "unknown"), []);
  // A stretch listed on two sections is named once.
  const both = listedHill([listed("R2", "Low Gate", "Top Gate")], [listed("R2", "Low Gate", "Top Gate")]);
  assert.equal(routeChainNote(both, undefined, "unknown"), "chains R2 from Low Gate to Top Gate");
  // Every section says it has none: that is known, whatever happened to the layer.
  assert.equal(routeChainNote(listedHill([], []), undefined, "unknown"), undefined);
  // One section does not say: not known.
  assert.equal(routeChainNote(listedHill([], undefined), undefined, "unknown"), "chain control unavailable");
  assert.equal(routeChainNote(listedHill(undefined, null), undefined, "last-known"), "chain control not current");
});

test("a requirement at a single checkpoint has no extent: no band, but its section and the route say it", () => {
  const hill = upHill();
  const one = chainStretch(hill, [stretch("cc:hwy4:r1", "Highway 4", "R1", "Mid Gate", "Mid Gate", [sign("a", "MID GATE", "Eastbound", [-120, 38.15], 1000, "R1")])]);
  assert.deepEqual(chainBands(one), []);
  assert.equal(sectionChains(hill, 0, one), undefined);
  assert.equal(sectionChains(hill, 1, one).text, "chains required (R1) at Mid Gate");
  assert.equal(routeChainNote(hill, one), "chains R1 at Mid Gate");
});

test("the strip never says 'no chains' unless the layer is current: failed or behind is said, and held data is marked", () => {
  assert.equal(chainRead({ failed: false, stale: false, held: 0 }), "current");
  assert.equal(chainRead({ failed: false, stale: true, held: 3 }), "last-known");
  assert.equal(chainRead({ failed: true, stale: false, held: 3 }), "last-known", "a failed request keeps the last good read");
  assert.equal(chainRead({ failed: true, stale: false, held: 0 }), "unknown");
  const hill = upHill(), route = chainStretch(hill, [onHill()]);
  // Current: silence means none.
  assert.equal(routeChainNote(hill, undefined, "current"), undefined);
  assert.equal(routeChainNote(hill, route, "current"), "chains R2 from Low Gate to High Gate");
  // Unknown: nothing is drawn and the route says why, never "none".
  assert.equal(routeChainNote(hill, undefined, "unknown"), "chain control unavailable");
  assert.deepEqual(chainBands(undefined, "unknown"), []);
  // Behind or held: what was last read is drawn and marked; an empty last read is not "none" either.
  assert.equal(routeChainNote(hill, undefined, "last-known"), "chain control not current");
  assert.equal(routeChainNote(hill, route, "last-known"), "chains R2 from Low Gate to High Gate when last read");
  assert.equal(chainBands(route, "last-known")[0].label, "Chains R2 · last read");
});

test("the route's own line between two distances, for the map: cut inside a piece, one line per section, nothing invented", () => {
  const hill = upHill();
  const x = chainStretch(hill, [onHill("R2", [38.05, 38.15], ["Low Gate", "Mid Gate"])]).stretches[0];
  const lines = routeSlice(hill, x.from, x.to);
  assert.equal(lines.length, 2, "one line per section crossed");
  near(lines[0][0][1], 38.05, 0.001);
  assert.deepEqual(lines[0].at(-1), [-120, 38.1]);
  assert.deepEqual(lines[1][0], [-120, 38.1]);
  near(lines[1].at(-1)[1], 38.15, 0.001);
  assert.ok(lines.flat().every(([lon]) => lon === -120), "every point is on the route's line");
  // Inside one piece of a longer line: the ends are cut, the vertices between are the route's own.
  const [bendy] = routeChains([seg("Hwy 4 — A to C", [[-120, 38.0], [-120, 38.1], [-119.9, 38.1], [-119.9, 38.2]])]);
  const [mid] = routeSlice(bendy, 5, 25);
  assert.deepEqual(mid.slice(1, -1), [[-120, 38.1], [-119.9, 38.1]]);
  // Outside the route, or no length: nothing.
  assert.deepEqual(routeSlice(hill, 40, 50), []);
  assert.deepEqual(routeSlice(hill, 5, 5), []);
  // A section without a line contributes nothing rather than a guess.
  const [gap] = routeChains([seg("Hwy 4 — A to B", [], { distanceKm: 10 }), seg("Hwy 4 — B to C", [[-120, 38.1], [-120, 38.2]])]);
  assert.equal(routeSlice(gap, 0, gap.length).length, 1);
});

test("a requirement a road lists is the page's answer too when the chain-control layer gives no stretch for it", () => {
  // The layer could not be read; the road layer lists R2 on the upper section, with the source's own headline.
  const hill = listedHill([], [listed("R2", "Mid Gate", "Top Gate")]);
  const on = chainsOnRoute(hill, []);
  assert.equal(on.placed, undefined, "no checkpoints, so nothing to place or draw");
  assert.deepEqual(on.listed.map((x) => [x.level, x.where, x.text]), [["R2", "Hwy 4 from Mid Gate to Top Gate (R2)", "Hwy 4 chains required, Mid Gate to Top Gate (R2)"]]);
  assert.deepEqual(on.levels, ["R2"]);
  assert.deepEqual(on.items, [{ where: "Hwy 4 from Mid Gate to Top Gate (R2)", since: Date.parse("2026-11-18T08:53:41-08:00") }]);
  // Title, figure and strip say the same thing.
  assert.deepEqual(answerFor([hill]), { title: "Hwy 4 chains required, Mid Gate to Top Gate (R2)", lines: [], tone: "elevated" });
  assert.deepEqual(chainFigure([hill], [], "unknown"), { state: "required", levels: ["R2"], items: on.items, nearby: [] });
  assert.equal(routeChainNote(hill, undefined, "unknown"), "chains R2 from Mid Gate to Top Gate");
  assert.equal(sectionChains(hill, 1, undefined).label, "chains R2");
  assert.deepEqual(chainBands(on.placed, "unknown"), []);
  // No headline from the source: the same sentence the layer's stretches get.
  const { headline: _, ...bare } = listed("R1", "Low Gate", "Low Gate");
  assert.equal(chainsOnRoute(listedHill([bare], []), []).text, "Chains required on Hwy 4 at Low Gate (R1)");
  // Listed on two sections: once.
  const twice = listedHill([listed("R2", "Low Gate", "Top Gate")], [listed("R2", "Low Gate", "Top Gate")]);
  assert.equal(answerFor([twice]).title, "Hwy 4 chains required, Low Gate to Top Gate (R2)");
  assert.equal(chainFigure([twice], [], "unknown").items.length, 1);
});

test("a requirement both sources have is said once, from the layer; one only the road lists is added to it", () => {
  // The layer has R2 (placed, drawn); the road also lists an R1 the layer has not caught up with.
  const hill = listedHill([listed("R1", "Low Gate", "Camp")], [listed("R2", "Mid Gate", "Top Gate")]);
  const r2 = onHill("R2", [38.16, 38.19], ["Mid Gate", "Top Gate"]);
  const on = chainsOnRoute(hill, [r2]);
  assert.deepEqual(on.placed.stretches.map((x) => x.control.id), ["cc:hwy4:r2"]);
  assert.deepEqual(on.listed.map((x) => x.id), ["cc:hwy4:r1"]);
  assert.deepEqual(on.levels, ["R1", "R2"]);
  assert.equal(on.text, "Chains required on Hwy 4 from Mid Gate to Top Gate (R2); Hwy 4 chains required, Low Gate to Camp (R1)");
  assert.equal(answerFor([hill], [r2]).title, on.text);
  assert.equal(routeChainNote(hill, on.placed), "chains R2 from Mid Gate to Top Gate and R1 from Low Gate to Camp");
  assert.deepEqual(chainFigure([hill], [r2], "current").levels, ["R1", "R2"]);
  // Only the placed one has an extent to draw.
  assert.deepEqual(chainBands(on.placed).map((b) => b.label), ["Chains R2"]);
});

test("the chain figure says none only when a source knows: the layer read, or every section listing none", () => {
  const unsaid = upHill();
  const hwy88 = stretch("cc:hwy88:r2", "Highway 88", "R2", "Lumber Yard", "Red Lake Creek", [sign("p", "PEDDLER VISTA", "Eastbound", [-120.27, 38.56])]);
  // The layer was read and has nothing on the routes: none, with what is on other highways named.
  assert.deepEqual(chainFigure([unsaid], [], "current"), { state: "none", levels: [], items: [], nearby: [] });
  assert.deepEqual(chainFigure([unsaid], [hwy88], "current").nearby, ["Hwy 88"]);
  // Neither source knows: unknown, never none.
  assert.equal(chainFigure([unsaid], [], "unknown").state, "unknown");
  assert.equal(chainFigure([listedHill([], undefined)], [], "unknown").state, "unknown", "one section does not say");
  assert.equal(chainFigure([], [], "unknown").state, "unknown");
  assert.equal(answerFor([unsaid]).title, "All monitored routes are open", "the title makes no chain claim either way");
  // The layer was not read, and every section lists none: none on the monitored routes, and only there.
  assert.equal(chainFigure([listedHill([], [])], [], "unknown").state, "none-listed");
});

test("a section's text is shortened on purpose when it does not fit, and the chain level is never what goes", () => {
  const open = sectionLabels({ status: "Open", chains: "chains R2", time: "28 min" });
  assert.deepEqual(open, ["Open · chains R2 · 28 min", "Open · chains R2", "Chains R2"]);
  assert.ok(open.every((text) => /R2/.test(text)));
  assert.deepEqual(sectionLabels({ status: "restricted", chains: "chains R1, R3", time: "40 min +12" }), ["restricted · chains R1, R3 · 40 min +12", "restricted · chains R1, R3", "Chains R1, R3"]);
  // Without chains there is one text, as before.
  assert.deepEqual(sectionLabels({ status: "Open", time: "11 min" }), ["Open · 11 min"]);
  assert.deepEqual(sectionLabels({ status: "Closure notice", closed: true, reason: "snow", time: "— min" }), ["Closure notice · snow"]);
  // A closure notice outranks the chains on it: the reason goes first, then the chains, never the notice.
  assert.deepEqual(sectionLabels({ status: "Closure notice", closed: true, reason: "snow", chains: "chains R2", time: "— min" }), ["Closure notice · snow · chains R2", "Closure notice · chains R2", "Closure notice"]);
  assert.deepEqual(sectionLabels({ status: "Closure notice", closed: true, chains: "chains R2" }), ["Closure notice · chains R2", "Closure notice"]);
  // The first that fits; the shortest when none does; all of it while the room is not known.
  const width = (text) => text.length * 6;
  assert.equal(fitLabel(open, 200, width), "Open · chains R2 · 28 min");
  assert.equal(fitLabel(open, 149, width), "Open · chains R2");
  assert.equal(fitLabel(open, 95, width), "Chains R2");
  assert.equal(fitLabel(open, 10, width), "Chains R2");
  assert.equal(fitLabel(open, undefined, width), "Open · chains R2 · 28 min");
});

test("the room a section's text has: its share of a strip across the page, a column beside one that runs down it", () => {
  const section = { from: 0, to: 13 };
  // Across the page: 13 km of 81 on a 1010 px strip, less a margin.
  near(labelRoom({ width: 1010, rem: 16 }, section, 81), 150, 1);
  near(labelRoom({ width: 560, rem: 16 }, section, 81), 78, 1);
  // 34rem and under the strip is vertical: the same column whatever the section's length.
  assert.equal(labelRoom({ width: 316, rem: 16 }, section, 81), 176);
  assert.equal(labelRoom({ width: 316, rem: 16 }, { from: 33, to: 71 }, 81), 176);
  // With the chain lane beside the vertical track, less: 316 - 11rem. Across the page the lane is under the strip and takes nothing.
  assert.equal(labelRoom({ width: 316, rem: 16 }, section, 81, true), 140);
  near(labelRoom({ width: 1010, rem: 16 }, section, 81, true), 150, 1);
  assert.equal(labelRoom({ width: 544, rem: 16 }, section, 81), 404);
  assert.ok(labelRoom({ width: 545, rem: 16 }, section, 81) < 100);
  // Not measured yet: not known.
  assert.equal(labelRoom({ width: 0, rem: 16 }, section, 81), undefined);
  assert.equal(labelRoom({ width: 800, rem: 16 }, section, 0), undefined);
});
