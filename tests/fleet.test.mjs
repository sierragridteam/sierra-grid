import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fleetCoverage,
  fleetGaugeSeries,
  fleetRateSeries,
  loadFleetArchives,
} from "../src/lib/fleet.ts";

const node = (key) => ({ key, name: `Node ${key}` });
const archive = (overrides = {}) => ({
  node: "a",
  from: "2026-11-08T00:00:00Z",
  to: "2026-11-08T01:00:00Z",
  cadenceSeconds: "60",
  reboots: [],
  truncated: false,
  coverage: {
    from: "2026-11-08T00:00:00Z",
    to: "2026-11-08T01:00:00Z",
    samples: 2,
  },
  samples: [
    {
      receivedAt: "2026-11-08T00:01:00Z",
      reading: {
        reportedAt: "2026-11-08T00:00:00Z",
        batteryVolts: 12,
        temperatureC: null,
        packetsReceived: "100",
        recvErrors: "1",
        reporterId: "monitor",
        uptimeSeconds: "10",
      },
    },
    {
      receivedAt: "2026-11-08T00:02:00Z",
      reading: {
        reportedAt: "2026-11-08T00:01:00Z",
        batteryVolts: 11.9,
        temperatureC: 20,
        packetsReceived: "160",
        recvErrors: "2",
        reporterId: "monitor",
        uptimeSeconds: "70",
      },
    },
  ],
  ...overrides,
});

test("all roster nodes load with bounded concurrency and individual failures retained", async () => {
  const nodes = ["a", "b", "c", "d", "e"].map(node);
  let active = 0,
    peak = 0;
  const rows = await loadFleetArchives(
    nodes,
    async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active--;
      if (n.key === "c") throw new Error("unavailable");
      return archive({ node: n.key });
    },
    2,
  );
  assert.equal(peak, 2);
  assert.deepEqual(
    rows.map((r) => r.node.key),
    nodes.map((n) => n.key),
  );
  assert.equal(rows[2].status, "rejected");
  assert.equal(rows.filter((r) => r.status === "fulfilled").length, 4);
});

test("fleet gauges retain missing values and count archive states without treating them as downtime", () => {
  const rows = [
    { node: node("a"), status: "fulfilled", archive: archive() },
    {
      node: node("b"),
      status: "fulfilled",
      archive: archive({
        samples: [],
        coverage: { from: null, to: null, samples: 0 },
      }),
    },
    {
      node: node("c"),
      status: "fulfilled",
      archive: archive({
        samples: [],
        coverage: {
          from: "2026-10-01T00:00:00Z",
          to: "2026-10-01T01:00:00Z",
          samples: 8,
        },
      }),
    },
    { node: node("d"), status: "rejected", error: new Error("offline") },
  ];
  const from = Date.parse("2026-11-08T00:00:00Z"),
    to = Date.parse("2026-11-08T01:00:00Z");
  assert.deepEqual(
    fleetGaugeSeries(rows, "temperatureC", from, to)[0].points.map(
      (p) => p.value,
    ),
    [null, 20],
  );
  assert.deepEqual(fleetCoverage(rows, from, to), {
    requested: 4,
    failed: 1,
    withSamples: 1,
    olderReadings: 1,
    noHistory: 1,
    outsideInterval: 0,
    truncated: 0,
  });
});

test("packet rates use actual adjacent report intervals and stay inside selected bounds", () => {
  const rows = [{ node: node("a"), status: "fulfilled", archive: archive() }];
  const from = Date.parse("2026-11-08T00:00:00Z"),
    to = Date.parse("2026-11-08T00:01:00Z");
  const series = fleetRateSeries(rows, "packetsReceivedPerMinute", from, to);
  assert.deepEqual(series[0].points, [{ time: to, value: 60 }]);
});

test("gauge series break across long collection gaps using each archive cadence", () => {
  const longGap = archive({
    samples: [
      {
        reading: { reportedAt: "2026-11-08T00:00:00Z", batteryVolts: 12 },
        receivedAt: "2026-11-08T00:00:00Z",
      },
      {
        reading: { reportedAt: "2026-11-08T00:10:00Z", batteryVolts: 11.8 },
        receivedAt: "2026-11-08T00:10:00Z",
      },
    ],
  });
  const rows = [{ node: node("a"), status: "fulfilled", archive: longGap }];
  const points = fleetGaugeSeries(
    rows,
    "batteryVolts",
    Date.parse("2026-11-08T00:00:00Z"),
    Date.parse("2026-11-08T00:10:00Z"),
  )[0].points;
  assert.deepEqual(
    points.map((p) => p.value),
    [12, null, 11.8],
  );
  assert.equal(points[1].time, Date.parse("2026-11-08T00:05:00Z"));
});
