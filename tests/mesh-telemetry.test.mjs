import { test } from "node:test";
import assert from "node:assert/strict";
import { telemetrySeries } from "../src/lib/mesh-telemetry.ts";

const sample = (seconds, extra = {}) => ({
  reading: { reportedAt: new Date(seconds * 1000).toISOString(), reporterId: "alanpi", uptimeSeconds: String(seconds + 100), packetsReceived: String(seconds * 2), batteryVolts: 4 + seconds / 6000, ...extra },
});
const archive = (samples, extra = {}) => ({ samples, cadenceSeconds: "60", reboots: [], ...extra });

test("gauges plot the reported value with change over the period", () => {
  const s = telemetrySeries(archive([sample(0), sample(60), sample(120)]), "batteryVolts");
  assert.deepEqual(s.points.map((p) => p.value), [4, 4.01, 4.02]);
  assert.equal(s.latest, 4.02);
  assert.equal(s.summary.label, "Change over the period");
  assert.ok(Math.abs(s.summary.value - 0.02) < 1e-9);
  assert.equal(s.count, 3);
  assert.equal(s.isRate, false);
});

test("a reboot breaks the gauge line instead of joining across it", () => {
  const s = telemetrySeries(archive([sample(0), sample(60), sample(120, { uptimeSeconds: "5" })]), "batteryVolts");
  assert.equal(s.breaks, 1);
  assert.equal(s.points.filter((p) => p.value === null).length, 1);
});

test("missing readings stay gaps, never zeros", () => {
  const s = telemetrySeries(archive([sample(0), sample(60, { batteryVolts: null }), sample(120)]), "batteryVolts");
  assert.deepEqual(s.points.map((p) => p.value), [4, null, 4.02]);
  assert.equal(s.count, 2);
});

test("counters plot interval-average rates with a time-weighted mean", () => {
  const s = telemetrySeries(archive([sample(0), sample(60), sample(120)]), "packetsReceivedPerMinute");
  assert.equal(s.isRate, true);
  assert.deepEqual(s.points.map((p) => p.value), [120, 120]);
  assert.equal(s.summary.label, "Time-weighted mean");
  assert.equal(s.summary.value, 120);
});
