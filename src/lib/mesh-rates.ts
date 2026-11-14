import type { V1MeshTelemetryArchive } from "@sierragridteam/sdk";
export const rateMetrics = {
  packetsReceivedPerMinute: {
    field: "packetsReceived",
    label: "Packets received",
    unit: "packets/min",
  },
  packetsSentPerMinute: {
    field: "packetsSent",
    label: "Packets sent",
    unit: "packets/min",
  },
  receiveErrorsPerMinute: {
    field: "recvErrors",
    label: "Receive errors",
    unit: "errors/min",
  },
} as const;
export type RateMetric = keyof typeof rateMetrics;
export type RateInterval = {
  start: number;
  end: number;
  elapsedSeconds: number;
  before: string;
  after: string;
  reporter: string;
  delta: string | null;
  value: number | null;
  reason: string | null;
};
const integer = (value: unknown): bigint | null =>
  typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : null;
/** Interval-average counter rates, never instantaneous packet activity. */
export function deriveRates(
  archive: V1MeshTelemetryArchive,
  metric: RateMetric,
) {
  const field = rateMetrics[metric].field;
  const readings = archive.samples
    .map((s) => s.reading)
    .filter((r) => Number.isFinite(Date.parse(r.reportedAt || "")))
    .sort((a, b) => Date.parse(a.reportedAt!) - Date.parse(b.reportedAt!));
  const cadence = Number(archive.cadenceSeconds);
  const maxGapMs =
    Number.isFinite(cadence) && cadence > 0 ? cadence * 3000 : null;
  const resets = archive.reboots
    .map((t) => Date.parse(t))
    .filter(Number.isFinite);
  const intervals: RateInterval[] = [];
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1],
      b = readings[i];
    const start = Date.parse(a.reportedAt!),
      end = Date.parse(b.reportedAt!),
      elapsedSeconds = (end - start) / 1000;
    const before = integer(a[field]),
      after = integer(b[field]);
    const ua = integer(a.uptimeSeconds),
      ub = integer(b.uptimeSeconds);
    let reason: string | null = null;
    if (elapsedSeconds <= 0) reason = "Duplicate or reversed report time";
    else if (!a.reporterId || !b.reporterId || a.reporterId !== b.reporterId)
      reason = "Reporting monitor changed or is unknown";
    else if (
      resets.some((t) => t > start && t <= end) ||
      (ua !== null && ub !== null && ub < ua)
    )
      reason = "Inferred reboot between these reports";
    // A re-sent cached reading: new report time, same uptime and counters. Its
    // zero delta is not "no traffic", it is no new information.
    else if (ua !== null && ub !== null && ub === ua)
      reason = "Repeated reading; node uptime did not advance";
    else if (before === null || after === null)
      reason = "Counter is unavailable";
    else if (after < before)
      reason = "Counter decreased; reset or discontinuity";
    else if (maxGapMs === null) reason = "Sample cadence is unknown";
    else if (end - start > maxGapMs)
      reason = "Collection gap exceeds three median intervals";
    else if (after - before > BigInt(Number.MAX_SAFE_INTEGER))
      reason = "Counter change exceeds safe numeric precision";
    const delta =
      before !== null && after !== null && after >= before
        ? (after - before).toString()
        : null;
    const value =
      reason === null ? (Number(delta) / elapsedSeconds) * 60 : null;
    intervals.push({
      start,
      end,
      elapsedSeconds,
      before: a[field],
      after: b[field],
      reporter:
        a.reporterId === b.reporterId
          ? b.reporterId
          : `${a.reporterId || "unknown"} → ${b.reporterId || "unknown"}`,
      delta,
      value,
      reason,
    });
  }
  const valid = intervals.filter((i) => i.value !== null);
  const validSeconds = valid.reduce((n, i) => n + i.elapsedSeconds, 0);
  const total = valid.reduce((n, i) => n + BigInt(i.delta!), 0n);
  const mean =
    validSeconds && total <= BigInt(Number.MAX_SAFE_INTEGER)
      ? (Number(total) / validSeconds) * 60
      : null;
  return {
    intervals,
    points: intervals.map((i) => ({ time: i.end, value: i.value })),
    maxGapMs,
    validSeconds,
    mean,
    invalidTimes: archive.samples.length - readings.length,
  };
}
