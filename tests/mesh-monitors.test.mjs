import { test } from "node:test";
import assert from "node:assert/strict";
import { monitorGroups, radios, verdict } from "../src/lib/mesh-monitors.ts";

const now = Date.parse("2026-11-14T00:07:00Z");
const node = (name, nodeType, admin) => ({ id: `meshcore:${name}`, headline: nodeType === "companion" ? `${name} (companion)` : name, mesh: { publicKey: name.padEnd(8, "0"), name, nodeType, telemetry: admin ? { admin } : {} } });
const events = [
  node("SIERRA EAGLE GATEWAY", "companion", { reporterId: "relay", lastSuccessAt: "2026-11-14T00:06:17Z", lastAttemptAt: "2026-11-14T00:06:17Z", batteryVolts: 4.034, uptimeSeconds: "89303" }),
  node("SIERRA Eagle HQ", "repeater", { reporterId: "relay", lastSuccessAt: "2026-11-13T23:41:34Z", lastAttemptAt: "2026-11-13T23:41:34Z" }),
  node("SIERRA Mission Outpost", "repeater", { reporterId: "relay", lastSuccessAt: "2026-11-13T21:41:04Z", lastAttemptAt: "2026-11-13T23:41:05Z" }),
  node("SIERRA Lake Alpine", "repeater", { reporterId: "alanpi", lastSuccessAt: "2026-11-13T23:48:03Z", lastAttemptAt: "2026-11-13T23:48:03Z" }),
  node("Some Other Node", "repeater", null),
];

test("only radios a reporter has readings for are monitored; a companion is a gateway", () => {
  const list = radios(events);
  assert.deepEqual(list.map((r) => [r.name, r.role, r.reporterId]), [
    ["SIERRA EAGLE GATEWAY", "gateway", "relay"], ["SIERRA Eagle HQ", "repeater", "relay"], ["SIERRA Mission Outpost", "repeater", "relay"], ["SIERRA Lake Alpine", "repeater", "alanpi"]]);
  assert.equal(list[0].batteryVolts, 4.034);
  assert.equal(list[0].uptimeSeconds, 89303);
});

test("a gateway answered a minute ago is up; a repeater read on schedule is reachable with its next read", () => {
  const [gateway, hq, outpost] = radios(events);
  assert.deepEqual([verdict(gateway, now).label, verdict(gateway, now).detail], ["Up", "Answered 1 min ago"]);
  assert.equal(verdict(gateway, now).due, Date.parse("2026-11-14T00:11:17Z"));
  const v = verdict(hq, now);
  assert.deepEqual([v.label, v.detail], ["Reachable", "Read 25 min ago"]);
  assert.equal(v.due, Date.parse("2026-11-14T00:11:34Z"));
  // Tried two hours after the last good read: a real failure.
  assert.deepEqual([verdict(outpost, now).tone, verdict(outpost, now).label], ["alarm", "No answer"]);
  assert.match(verdict(outpost, now).detail, /^Tried 26 min ago; last answered 2 h ago$/);
});

test("a gateway not read lately is not called down: no try is recorded while it is in use or paused", () => {
  const [gateway] = radios([node("G", "companion", { reporterId: "relay", lastSuccessAt: "2026-11-13T22:00:00Z", lastAttemptAt: "2026-11-13T22:00:00Z" })]);
  const v = verdict(gateway, now);
  assert.deepEqual([v.tone, v.label], ["elevated", "Not read"]);
  assert.match(v.detail, /in use, paused by its host, or its bridge is offline$/);
  const [late] = radios([node("R", "repeater", { reporterId: "relay", lastSuccessAt: "2026-11-13T23:00:00Z", lastAttemptAt: "2026-11-13T23:00:00Z" })]);
  assert.equal(verdict(late, now).label, "Read overdue");
  // An operator's monitor keeps its own hours: the same age is fine there, and nothing is "due".
  const [other] = radios([node("A", "repeater", { reporterId: "alanpi", lastSuccessAt: "2026-11-13T23:00:00Z", lastAttemptAt: "2026-11-13T23:00:00Z" })]);
  assert.deepEqual([verdict(other, now).label, verdict(other, now).due], ["Reachable", undefined]);
});

test("groups: the relay first, gateways before repeaters, problems first, with the reporter's own state", () => {
  const groups = monitorGroups(radios(events), [
    { id: "relay", name: "SIERRA Mesh Relay", status: "OK", lastSuccessAt: "2026-11-14T00:06:19Z", pollIntervalSeconds: 60 },
    { id: "alanpi", name: "SIERRA Dorrington MeshCore Gateway", status: "STALE", lastSuccessAt: "2026-11-13T22:41:33Z", pollIntervalSeconds: 60 },
  ], now);
  assert.deepEqual(groups.map((g) => [g.id, g.name, g.reporting, g.gateways.length, g.repeaters.length, g.down]), [
    ["relay", "SIERRA Mesh Relay", true, 1, 2, 1], ["alanpi", "SIERRA Dorrington MeshCore Gateway", false, 0, 1, 0]]);
  assert.deepEqual(groups[0].repeaters.map((r) => r.name), ["SIERRA Mission Outpost", "SIERRA Eagle HQ"]);
});
