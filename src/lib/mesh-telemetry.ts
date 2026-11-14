/**
 * A mesh node's archived monitor telemetry as chart series. Pure: the report
 * view renders it, tests check it.
 *
 * Gauges (battery, temperature, queue, SNR) plot the reported value at report
 * time, with the line broken at resets, monitor changes, duplicate times and
 * long gaps. Counters (packets, errors) plot interval-average rates from
 * adjacent reports (mesh-rates), never instantaneous traffic.
 */
import type { V1MeshTelemetryArchive } from "@sierragridteam/sdk";
import { deriveRates, rateMetrics, type RateMetric } from "./mesh-rates.ts";

export const telemetryMetrics: Record<string, { label: string; unit: string; decimals: number }> = {
  batteryVolts: { label: "Battery voltage", unit: "V", decimals: 2 },
  temperatureC: { label: "Temperature", unit: "°C", decimals: 1 },
  // Rates: the label names the counter, the unit says it is per minute.
  ...Object.fromEntries(Object.entries(rateMetrics).map(([key, m]) => [key, { label: m.label, unit: "/min", decimals: 1 }])),
  lastSnrDb: { label: "Last packet SNR", unit: "dB", decimals: 1 },
};
export type TelemetryMetric = keyof typeof telemetryMetrics;

export type TelemetrySeries = {
  points: { time: number; value: number | null }[];
  /** Latest plotted value. */
  latest?: number;
  /** Gauges: last minus first. Rates: time-weighted mean over valid intervals. */
  summary?: { label: string; value: number };
  /** Plotted values (gauges) or valid intervals (rates). */
  count: number;
  /** Line breaks at resets, monitor changes and gaps. */
  breaks: number;
  isRate: boolean;
};

export function telemetrySeries(archive: V1MeshTelemetryArchive, metric: TelemetryMetric): TelemetrySeries {
  const isRate = metric in rateMetrics;
  const derived = deriveRates(archive, isRate ? (metric as RateMetric) : "packetsReceivedPerMinute");
  const boundaries = derived.intervals.filter((r) => r.reason && /reboot|decreased|monitor|gap|Duplicate/.test(r.reason));
  if (isRate) {
    const values = derived.points.flatMap((p) => (p.value === null ? [] : [p.value]));
    return {
      points: derived.points,
      latest: values.at(-1),
      summary: derived.mean === null ? undefined : { label: "Time-weighted mean", value: derived.mean },
      count: derived.intervals.filter((i) => i.value !== null).length,
      breaks: boundaries.length,
      isRate,
    };
  }
  const cadence = Number(archive.cadenceSeconds);
  const boundaryTimes = new Set(boundaries.map((r) => r.end));
  const points: TelemetrySeries["points"] = [];
  let started = false;
  for (const sample of archive.samples) {
    const reading = sample.reading as Record<string, unknown> & { reportedAt?: string };
    const time = Date.parse(reading.reportedAt ?? "");
    if (!Number.isFinite(time)) continue;
    // A null point breaks the line at a reset/gap boundary (or everywhere when cadence is unknown).
    if (started && (boundaryTimes.has(time) || !(cadence > 0))) points.push({ time: time - 1, value: null });
    const value = reading[metric];
    points.push({ time, value: typeof value === "number" && Number.isFinite(value) ? value : null });
    started = true;
  }
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  return {
    points,
    latest: values.at(-1),
    summary: values.length > 1 ? { label: "Change over the period", value: values.at(-1)! - values[0] } : undefined,
    count: values.length,
    breaks: boundaries.length,
    isRate,
  };
}
