import { test } from "node:test";
import assert from "node:assert/strict";
import { attention, errorRateRows, fleetTraffic, heatmapRows, hourBuckets, lastActive, linkStrength, linkWeight, nodeTone, strengthCounts } from "../src/lib/mesh-fleet.ts";

const now = Date.parse("2026-11-10T00:00:00Z");
const H = 3_600_000;
const node = (over = {}) => ({ key: "k1", name: "Node A", type: "repeater", inRegion: true, lastRelayedAt: now - 10 * 60_000, ...over });
const sample = (t, extra = {}) => ({ reading: { reportedAt: new Date(t).toISOString(), reporterId: "alanpi", uptimeSeconds: String(Math.round((t - (now - 30 * H)) / 1000)), batteryVolts: 4.0, packetsReceived: "0", recvErrors: "0", temperatureC: 20, ...extra } });
const archive = (samples, extra = {}) => ({ samples, cadenceSeconds: "1200", reboots: [], coverage: {}, ...extra });

test("link strength bands and log-scaled weight", () => {
  assert.deepEqual([12, 8, 5, 3, 2.9, -1.5].map(linkStrength), ["strong", "strong", "fair", "fair", "weak", "weak"]);
  assert.equal(linkWeight(1, 868), 1);
  assert.ok(Math.abs(linkWeight(868, 868) - 3.5) < 1e-9);
  assert.ok(linkWeight(45, 868) > 2 && linkWeight(45, 868) < 2.7);
  assert.deepEqual(strengthCounts([{ bestSnr: 13 }, { bestSnr: 4 }, { bestSnr: 0 }, { bestSnr: 9 }]), { strong: 2, fair: 1, weak: 1 });
});

test("activity ignores future stamps from drifting node clocks", () => {
  assert.equal(lastActive(node({ lastHeardAt: now + 5 * H, lastRelayedAt: now - H }), now), now - H);
});

test("a healthy, active node needs no attention and shows as live", () => {
  const n = node({ admin: { lastSuccessAt: now - 20 * 60_000, reporterId: "alanpi" }, reachability: "REACHABLE" });
  const a = attention([n], new Map([["k1", archive([sample(now - 3 * H), sample(now - 2 * H), sample(now - H)])]]), now);
  assert.deepEqual(a, []);
  assert.equal(nodeTone(n, undefined, now), "pine");
});

test("silence, unreachability, low and falling battery, and reboots are ranked with reasons", () => {
  const quiet = node({ key: "q", name: "Quiet", lastRelayedAt: now - 20 * H });
  const silent = node({ key: "s", name: "Silent", lastRelayedAt: now - 5 * 24 * H });
  const sick = node({ key: "b", name: "Sick", reachability: "UNREACHABLE", admin: { lastSuccessAt: now - 9 * 24 * H, reporterId: "alanpi" } });
  const draining = node({ key: "d", name: "Draining", admin: { lastSuccessAt: now - 10 * 60_000 }, reachability: "REACHABLE" });
  const archives = new Map([
    ["d", archive([sample(now - 20 * H, { batteryVolts: 3.85 }), sample(now - 10 * H, { batteryVolts: 3.75 }), sample(now - H, { batteryVolts: 3.62 })], { reboots: [new Date(now - 5 * H).toISOString()] })],
  ]);
  const a = attention([quiet, silent, sick, draining, node({ key: "away", name: "Away", inRegion: false, lastRelayedAt: now - 9 * 24 * H })], archives, now);
  assert.deepEqual(a.map((x) => [x.node.name, x.worst]), [["Sick", "alarm"], ["Silent", "alarm"], ["Draining", "warn"], ["Quiet", "warn"]]);
  assert.deepEqual(a.find((x) => x.node.name === "Draining").issues.map((i) => i.text), ["Battery low · 3.62 V", "Battery falling · −0.23 V in 24 h", "Rebooted in the last 24 h"]);
  assert.equal(a.find((x) => x.node.name === "Silent").issues[0].text, "Silent for 5 days");
  assert.equal(nodeTone(sick, a[0], now), "alarm");
});

test("heatmap rows are hourly means; missing hours stay null; traffic is the median reporting node", () => {
  const buckets = hourBuckets(now, 1);
  assert.equal(buckets.length, 24);
  assert.equal(buckets.at(-1), now - H);
  const rows = heatmapRows([node()], new Map([["k1", archive([sample(now - 90 * 60_000, { batteryVolts: 3.9 }), sample(now - 80 * 60_000, { batteryVolts: 4.1 })])]]), "batteryVolts", buckets);
  assert.equal(rows[0].values.at(-2), 4.0);
  assert.equal(rows[0].values.at(-1), null);
  const traffic = fleetTraffic([{ values: [1, null] }, { values: [2, null] }, { values: [90, null] }], [0, H]);
  assert.deepEqual(traffic.map((t) => [t.value, t.reporting]), [[2, 3], [null, 0]]);
});

test("error rate is errors over everything received, per hour", () => {
  const buckets = hourBuckets(now, 1);
  // Every 20 minutes: 600 received and 200 errors per interval, so errors are 25% of intake.
  const samples = [0, 1, 2, 3].map((i) => sample(now - 80 * 60_000 + i * 20 * 60_000, { packetsReceived: String(600 * i), recvErrors: String(200 * i) }));
  const [row] = errorRateRows([node()], new Map([["k1", archive(samples)]]), buckets);
  const values = row.values.filter((v) => v !== null);
  assert.ok(values.length > 0);
  for (const v of values) assert.ok(Math.abs(v - 25) < 1e-9, `got ${v}`);
});
