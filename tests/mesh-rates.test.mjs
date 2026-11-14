import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveRates } from "../src/lib/mesh-rates.ts";
const sample = (seconds, count, extra = {}) => ({
  reading: {
    reportedAt: new Date(seconds * 1000).toISOString(),
    packetsReceived: String(count),
    reporterId: "monitor-a",
    uptimeSeconds: String(seconds + 100),
    ...extra,
  },
});
const archive = (samples, extra = {}) => ({
  samples,
  cadenceSeconds: "60",
  reboots: [],
  ...extra,
});
test("rates use elapsed report time, exact bigint differences, and time-weighted mean", () => {
  const r = deriveRates(
    archive([
      sample(0, "90071992547409930"),
      sample(60, "90071992547409960"),
      sample(180, "90071992547409990"),
    ]),
    "packetsReceivedPerMinute",
  );
  assert.deepEqual(
    r.points.map((p) => p.value),
    [30, 15],
  );
  assert.equal(r.mean, 20);
  assert.equal(r.validSeconds, 180);
});
test("zero packet change is a valid zero, while resets and changed monitors are gaps", () => {
  const r = deriveRates(
    archive([
      sample(0, 100),
      sample(60, 100),
      sample(120, 3, { uptimeSeconds: "2" }),
      sample(180, 40, { reporterId: "monitor-b" }),
    ]),
    "packetsReceivedPerMinute",
  );
  assert.deepEqual(
    r.points.map((p) => p.value),
    [0, null, null],
  );
  assert.match(r.intervals[1].reason, /reboot/);
  assert.match(r.intervals[2].reason, /monitor/);
});
test("API reset boundaries reject intervals even if counters increased; gaps and duplicate times are excluded", () => {
  const r = deriveRates(
    archive([sample(0, 1), sample(60, 2), sample(60, 3), sample(600, 4)], {
      reboots: [new Date(30000).toISOString()],
    }),
    "packetsReceivedPerMinute",
  );
  assert.deepEqual(
    r.points.map((p) => p.value),
    [null, null, null],
  );
  assert.match(r.intervals[0].reason, /reboot/);
  assert.match(r.intervals[1].reason, /Duplicate/);
  assert.match(r.intervals[2].reason, /gap/);
});
test("missing, unsafe, decreased counters and unknown cadence never become zero rates", () => {
  for (const [a, b, extra] of [
    ["bad", "10", {}],
    ["0", "9007199254740992", {}],
    ["10", "5", {}],
    ["0", "3", { cadenceSeconds: null }],
  ]) {
    const r = deriveRates(
      archive([sample(0, a), sample(60, b)], extra),
      "packetsReceivedPerMinute",
    );
    assert.equal(r.points[0].value, null);
    assert.equal(r.mean, null);
  }
});

test("a re-sent cached reading (uptime did not advance) is a gap, not a zero rate", () => {
  const r = deriveRates(
    archive([sample(0, 100), sample(60, 160), sample(120, 160, { uptimeSeconds: String(160) })]),
    "packetsReceivedPerMinute",
  );
  assert.deepEqual(r.intervals.map((i) => i.value), [60, null]);
  assert.match(r.intervals[1].reason, /uptime did not advance/);
});
