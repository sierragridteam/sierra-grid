import { test } from "node:test";
import assert from "node:assert/strict";
import { chainStretch, chainPlaces, chainText, beyondClosures, beyondText, alongRoute, closureNotice, routeChains, segmentName, signBoard, workJobs } from "../src/lib/road-corridor.ts";

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

test("chain controls: both directions at a place are one entry, and the headline names the monitored routes only", () => {
  const cc = (id, highway, place, direction, level = "R2") => ({ id, level, highway, direction, place, since: 1000, coordinates: [-120, 38.4] });
  const places = chainPlaces([
    cc("a", "Highway 4", "TAMARACK", "Westbound"), cc("b", "Highway 4", "TAMARACK", "Eastbound", "R3"),
    cc("c", "Highway 4", "BEAR VALLEY", "Eastbound"), cc("d", "Highway 88", "PEDDLER VISTA", "Eastbound"), cc("e", "Highway 207", "MT. REBA SUMMIT", "Southbound"),
  ]);
  assert.deepEqual(places.map((p) => [p.highway, p.place, p.level, p.directions]), [["Hwy 4", "Tamarack", "R3", "Both directions"], ["Hwy 4", "Bear Valley", "R2", "Eastbound"], ["Hwy 88", "Peddler Vista", "R2", "Eastbound"], ["Hwy 207", "Mt. Reba Summit", "R2", "Southbound"]]);
  assert.equal(chainText(places, ["Hwy 4", "Hwy 49"]), "Chains required on Hwy 4 at Tamarack and Bear Valley (R2, R3)");
  assert.equal(chainText(places, ["Hwy 49"]), undefined);
});

test("chain control reads as a stretch along the route, lowest checkpoint first", () => {
  const [hwy4] = routeChains([seg("Hwy 4 — Arnold to Bear Valley", [[-120.3, 38.2], [-120.2, 38.3], [-120.0, 38.4]])]);
  const cc = (id, place, coordinates, level = "R2") => ({ id, level, highway: "Highway 4", direction: "Eastbound", place, since: 1000, coordinates });
  const places = chainPlaces([cc("a", "BEAR VALLEY", [-120.0, 38.4]), cc("b", "POISON SPRINGS", [-120.2, 38.3]), cc("c", "TAMARACK", [-120.1, 38.35]), { ...cc("d", "PEDDLER VISTA", [-120.27, 38.56]), highway: "Highway 88" }]);
  const s = chainStretch(hwy4, places);
  assert.equal(s.text, "Chains required on Hwy 4 from Poison Springs to Bear Valley (R2)");
  assert.deepEqual(s.places.map((p) => p.place), ["Poison Springs", "Tamarack", "Bear Valley"]);
  assert.ok(s.from.at < s.to.at);
  assert.equal(chainStretch(hwy4, chainPlaces([cc("a", "TAMARACK", [-120.1, 38.35])])).text, "Chains required on Hwy 4 at Tamarack (R2)");
  assert.equal(chainStretch(hwy4, chainPlaces([{ ...cc("d", "PEDDLER VISTA", [-120.27, 38.56]), highway: "Highway 88" }])), undefined);
});
