import { test } from "node:test";
import assert from "node:assert/strict";
import { acresText, dotMaxZoom, withShapes, evacuationEpisodes, fireSeason, fires, latestEvacuation, latestFire, latestShutoff, powerNow, previewLive, since, weeklyCustomers } from "../src/lib/conditions-model.ts";

const report = (id, headline, extra = {}) => ({ id, headline, status: "RESOLVED", severity: "INFO", ingestedAt: "2026-08-20T03:00:00Z", provenance: { sourceId: id.split(":")[0], sourceName: id.split(":")[0] }, ...extra });
const now = Date.parse("2026-11-13T20:00:00Z");

test("CAL FIRE and FIRIS reports of one fire join by name; the incident leads, the perimeter gives the shape", () => {
  const list = fires([
    report("firis:woods", "WOODS — 60 ac", { observedAt: "2026-08-14T14:00:00Z", wildfire: { acres: 59.9 }, geometry: { object: { type: "Polygon", coordinates: [] }, centroid: { lat: 38.4, lng: -120 } } }),
    report("calfire:woods", "Woods Fire — 65 ac, 100% contained", { effective: "2026-08-09T14:31:51Z", areaLabel: "Carson Iceberg Wilderness", wildfire: { acres: 65.2 }, geometry: { object: { type: "Point", coordinates: [-120.1, 38.5] }, centroid: { lat: 38.5, lng: -120.1 } } }),
    report("calfire:links", "Links Fire — 2 ac, 100% contained", { effective: "2026-10-11T20:29:07Z", wildfire: { acres: 2 } }),
    report("firis:summit40y", "SUMMIT 40Y — 6 ac", { observedAt: "2026-11-09T00:00:33Z", status: "ACTIVE", wildfire: { acres: 6.43, containment: 0 } }),
  ]);
  assert.deepEqual(list.map((f) => f.name), ["Summit 40Y Fire", "Links Fire", "Woods Fire"]);
  const woods = list[2];
  assert.equal(woods.id, "calfire:woods");
  assert.equal(woods.acres, 65.2);
  assert.equal(woods.containment, 100);
  assert.equal(woods.place, "Carson Iceberg Wilderness");
  assert.equal(woods.started, Date.parse("2026-08-09T14:31:51Z"));
  assert.equal(woods.area.type, "Polygon");
  assert.deepEqual(woods.point, [-120.1, 38.5]);
  assert.equal(woods.sources.length, 2);
  assert.equal(list[0].active, true);
  assert.equal(list[0].containment, null);
  const season = fireSeason(list);
  assert.equal(season.count, 3);
  assert.equal(season.largest.name, "Woods Fire");
  assert.equal(Math.round(season.acres), 74);
});

test("acres read as a person would say them", () => {
  assert.equal(acresText(0.6), "0.6 ac");
  assert.equal(acresText(3), "3 ac");
  assert.equal(acresText(10339), "10,339 ac");
  assert.equal(acresText(null), "—");
});

test("evacuation zones of one day and county are one episode", () => {
  const zone = (id, at, county, level = "ORDER") => report(`evac:${id}`, `Evacuation Order — ${id}`, { observedAt: at, areaLabel: county, evacuation: { zoneId: id, level, county } });
  const eps = evacuationEpisodes([
    zone("CCU-110", "2026-08-06T20:00:00Z", "CALAVERAS"), zone("CCU-139", "2026-08-06T22:00:00Z", "CALAVERAS", "WARNING"),
    zone("T-104", "2026-08-06T21:00:00Z", "TUOLUMNE"), zone("CCU-043", "2026-08-21T03:01:00Z", "CALAVERAS"),
  ], "America/Los_Angeles");
  assert.deepEqual(eps.map((e) => [e.county, e.orders, e.warnings, e.zones.length]), [["Calaveras", 1, 0, 1], ["Tuolumne", 1, 0, 1], ["Calaveras", 1, 1, 2]]);
});

test("power now: outages by size, shutoffs apart, the next restoration estimate still ahead", () => {
  const p = powerNow([
    report("pge:1", "Power outage — 1 customer", { power: { customersAffected: 1, estimatedRestoration: "2026-11-13T19:00:00Z" } }),
    report("pge:2", "Power outage — 133 customers", { power: { customersAffected: 133, medicalBaselineAffected: 4, estimatedRestoration: "2026-11-14T00:00:00Z" } }),
    report("psps:9", "PSPS Warning — 23,491 customers", { power: { customersAffected: 23491, medicalBaselineAffected: 1372 } }),
  ], now);
  assert.equal(p.customers, 134);
  assert.equal(p.outages[0].id, "pge:2");
  assert.equal(p.shutoffs.length, 1);
  assert.equal(p.medical, 4);
  assert.equal(p.nextRestoration, Date.parse("2026-11-14T00:00:00Z"));
});

test("weekly customers end with the current week and keep shutoffs apart", () => {
  const w = weeklyCustomers([
    report("pge:a", "Power outage", { effective: "2026-11-12T00:00:00Z", power: { customersAffected: 100 } }),
    report("psps:b", "PSPS Warning", { effective: "2026-10-15T03:00:00Z", power: { customersAffected: 23491 } }),
    report("pge:old", "Power outage", { effective: "2026-01-01T00:00:00Z", power: { customersAffected: 5 } }),
  ], now, 8, "America/Los_Angeles");
  assert.equal(w.length, 8);
  assert.equal(w.at(-1).outages, 100);
  assert.equal(w.reduce((n, b) => n + b.shutoffs, 0), 23491);
  assert.equal(w.reduce((n, b) => n + b.count, 0), 2);
});

test("since", () => {
  assert.equal(since(now - 4 * 60_000, now), "4 min");
  assert.equal(since(now - 20_000, now), "under a minute");
  assert.equal(since(now - 3 * 3_600_000, now), "3 h");
  assert.equal(since(now - 5 * 86_400_000, now), "5 days");
});

test("preview: the latest fire (both sources), evacuation day or shutoff moves to active; nothing else changes", () => {
  const past = [
    report("firis:woods", "WOODS — 60 ac", { observedAt: "2026-08-14T14:00:00Z" }),
    report("calfire:woods", "Woods Fire — 65 ac", { effective: "2026-08-09T14:31:51Z" }),
    report("calfire:links", "Links Fire — 2 ac", { effective: "2026-07-11T20:29:07Z" }),
  ];
  const f = previewLive([], past, latestFire);
  assert.deepEqual(f.now.map((r) => [r.id, r.status]), [["firis:woods", "ACTIVE"], ["calfire:woods", "ACTIVE"]]);
  assert.deepEqual(f.past.map((r) => r.id), ["calfire:links"]);
  assert.equal(past[0].status, "RESOLVED");
  const zones = [report("evac:a", "Evacuation Order — a", { observedAt: "2026-08-21T03:00:00Z" }), report("evac:b", "Evacuation Order — b", { observedAt: "2026-08-20T20:00:00Z" }), report("evac:c", "Evacuation Order — c", { observedAt: "2026-08-06T20:00:00Z" })];
  assert.deepEqual(previewLive([], zones, latestEvacuation).now.map((r) => r.id), ["evac:a", "evac:b"]);
  const power = [report("pge:1", "Power outage — 9 customers", { effective: "2026-11-01T00:00:00Z" }), report("psps:9", "PSPS Warning — 23,491 customers", { effective: "2026-10-15T03:00:00Z" })];
  assert.deepEqual(previewLive([], power, latestShutoff).now.map((r) => r.id), ["psps:9"]);
  assert.deepEqual(previewLive([], [], latestFire), { now: [], past: [] });
});

test("a perimeter's size is known from its bounds before the shape loads; shapes attach later by report id", () => {
  const list = [report("firis:dove", "DOVE — 226 ac", { wildfire: { acres: 226, hasPerimeter: true }, geometry: { centroid: { lat: 38, lng: -120.3 }, bbox: { minLat: 37.99, maxLat: 38.01, minLng: -120.31, maxLng: -120.29 } } })];
  const [before] = fires(list);
  assert.equal(before.area, undefined);
  assert.ok(Math.abs(before.extent - 2226) < 5);
  const [after] = fires(withShapes(list, new Map([["firis:dove", { type: "Polygon", coordinates: [] }]])));
  assert.equal(after.area.type, "Polygon");
});

test("the dot gives way at the zoom where the area outgrows it", () => {
  // 2.2 km across against a 12 px dot at 38°N: about 0.18 km per pixel, zoom 8.4.
  assert.equal(dotMaxZoom(2226, 38, 6), 8.4);
  // A 150 m spot fire keeps its dot until the map is zoomed far in.
  assert.ok(dotMaxZoom(150, 38, 4) > 11.5);
  assert.equal(dotMaxZoom(0, 38, 6), undefined);
});

test("two fires of the same name in different months or places stay two fires", () => {
  const at = (lat, lng) => ({ centroid: { lat, lng } });
  const list = fires([
    report("calfire:creek-jul", "Creek Fire — 40 ac, 100% contained", { effective: "2026-07-10T00:00:00Z", geometry: at(38.2, -120.4) }),
    report("calfire:creek-oct", "Creek Fire — 3 ac", { effective: "2026-10-20T00:00:00Z", status: "ACTIVE", geometry: at(38.2, -120.4) }),
    report("firis:creek-oct", "CREEK — 3 ac", { observedAt: "2026-10-22T00:00:00Z", status: "ACTIVE", geometry: at(38.21, -120.41) }),
    report("calfire:creek-far", "Creek Fire — 9 ac", { effective: "2026-10-21T00:00:00Z", geometry: at(37.5, -119.0) }),
  ]);
  assert.equal(list.length, 3);
  const active = list.filter((f) => f.active);
  assert.equal(active.length, 1);
  assert.equal(active[0].sources.length, 2);
  assert.equal(active[0].containment, null);
});

test("evacuation episodes count orders, warnings and other notices apart; an unknown time is said so", () => {
  const zone = (id, level) => report(`evac:${id}`, `Evacuation — ${id}`, { observedAt: "2026-08-06T20:00:00Z", areaLabel: "CALAVERAS", evacuation: { zoneId: id, level, county: "CALAVERAS" } });
  const [e] = evacuationEpisodes([zone("a", "ORDER"), zone("b", "WARNING"), zone("c", "SHELTER_IN_PLACE"), zone("d", "ADVISORY")], "America/Los_Angeles");
  assert.deepEqual([e.orders, e.warnings, e.others], [1, 1, 2]);
  assert.equal(since(NaN, now), "an unknown time");
  assert.equal(since(Infinity, now), "an unknown time");
});
