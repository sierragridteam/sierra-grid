import { test } from "node:test";
import assert from "node:assert/strict";
import { chainStretch, chainCheckpoints, chainExtent, beyondClosures, beyondText, alongRoute, closureNotice, routeChains, segmentName, signBoard, workJobs } from "../src/lib/road-corridor.ts";

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

test("work rows are named by the work and its place; the route is the group", async () => {
  const { workName } = await import("../src/lib/road-corridor.ts");
  assert.deepEqual(workName("Hwy 4 one-way traffic control (Drainage Work)", "Hwy 4 at Horeshoe Drive (Right), near Hathaway Pines"),
    { route: "Hwy 4", what: "One-way traffic control · drainage work", where: "Horeshoe Drive, near Hathaway Pines" });
  assert.deepEqual(workName("Hwy 49 lane closure (Drainage Work)", "Hwy 49 from Solinski Street (Left) to Washington Street, near Sonora"),
    { route: "Hwy 49", what: "Lane closure · drainage work", where: "Solinski Street to Washington Street, near Sonora" });
  assert.equal(workName("Road work", "Somewhere").route, "Other roads");
});

test("a seasonal closure past the last stop leaves the route open to it and names where it runs to", () => {
  const [hwy4] = routeChains([
    seg("Hwy 4 — Angels Camp to Arnold", [[-120.5, 38.0], [-120.3, 38.2]]),
    seg("Hwy 4 — Arnold to Bear Valley", [[-120.3, 38.2], [-120.0, 38.4]], { beyond: [
      { name: "Ebbetts Pass winter closure", status: "CLOSED", side: "END", reason: "snow", from: "0.5 mi east of the Jct of SR 207 /Mt Reba Turnoff/", to: "the Jct of SR 89 /Ebbetts Pass/", description: "Is closed from …" },
    ] }),
  ]);
  const [b] = beyondClosures(hwy4);
  assert.deepEqual([b.side, b.name, b.last, b.toward, b.reason], ["END", "Ebbetts Pass winter closure", "Bear Valley", "Ebbetts Pass", "snow"]);
  assert.equal(beyondText("Hwy 4", b), "Hwy 4 closed past Bear Valley to Ebbetts Pass — snow");
  assert.equal(hwy4.sections.every((x) => x.segment.status === "OPEN"), true);
  // A closure listed on a middle section, or one that is not a closure, is not a route-end closure.
  const [other] = routeChains([
    seg("Hwy 4 — Angels Camp to Arnold", [[-120.5, 38.0], [-120.3, 38.2]], { beyond: [{ status: "CLOSED", side: "END" }] }),
    seg("Hwy 4 — Arnold to Bear Valley", [[-120.3, 38.2], [-120.0, 38.4]], { beyond: [{ status: "RESTRICTED", side: "END" }] }),
  ]);
  assert.deepEqual(beyondClosures(other), []);
  assert.deepEqual(beyondClosures(routeChains([seg("Hwy 49 — Angels Camp to Sonora", [[-121, 38], [-121, 38.2]])])[0]), []);
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
