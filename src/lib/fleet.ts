import type { V1MeshTelemetryArchive } from "@sierragridteam/sdk";
import { deriveRates, type RateMetric } from "./mesh-rates.ts";

export type FleetNode = { key: string; name: string };
export type FleetArchiveResult =
  | { node: FleetNode; status: "fulfilled"; archive: V1MeshTelemetryArchive }
  | { node: FleetNode; status: "rejected"; error: unknown };

/** Load a whole roster without allowing one slow/failing node to hide the rest. */
export async function loadFleetArchives(
  nodes: FleetNode[],
  load: (node: FleetNode) => Promise<V1MeshTelemetryArchive>,
  concurrency = 4,
): Promise<FleetArchiveResult[]> {
  const results = new Array<FleetArchiveResult>(nodes.length);
  let cursor = 0;
  async function worker() {
    while (cursor < nodes.length) {
      const index = cursor++;
      const node = nodes[index];
      try {
        results[index] = {
          node,
          status: "fulfilled",
          archive: await load(node),
        };
      } catch (error) {
        results[index] = { node, status: "rejected", error };
      }
    }
  }
  const count = Math.min(
    nodes.length,
    Math.max(1, Math.floor(concurrency) || 1),
  );
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}

export type GaugeField = "batteryVolts" | "temperatureC";
const validSamples = (
  archive: V1MeshTelemetryArchive,
  from: number,
  to: number,
) =>
  archive.samples
    .filter((sample) => {
      const time = Date.parse(sample.reading.reportedAt || "");
      return Number.isFinite(time) && time >= from && time <= to;
    })
    .sort(
      (a, b) =>
        Date.parse(a.reading.reportedAt!) - Date.parse(b.reading.reportedAt!),
    );

export function fleetGaugeSeries(
  rows: FleetArchiveResult[],
  field: GaugeField,
  from: number,
  to: number,
) {
  return rows.flatMap((row) => {
    if (row.status !== "fulfilled")
      return [{ id: row.node.key, label: row.node.name, points: [] }];
    const samples = validSamples(row.archive, from, to);
    const cadence = Number(row.archive.cadenceSeconds);
    const maxGap =
      Number.isFinite(cadence) && cadence > 0 ? cadence * 3000 : null;
    const points: { time: number; value: number | null }[] = [];
    let previous: number | null = null;
    for (const sample of samples) {
      const time = Date.parse(sample.reading.reportedAt!);
      if (previous !== null && (maxGap === null || time - previous > maxGap))
        points.push({ time: previous + (time - previous) / 2, value: null });
      points.push({ time, value: numeric(sample.reading[field]) });
      previous = time;
    }
    return [{ id: row.node.key, label: row.node.name, points }];
  });
}

export function fleetRateSeries(
  rows: FleetArchiveResult[],
  metric: RateMetric,
  from: number,
  to: number,
) {
  return rows.map((row) =>
    row.status === "fulfilled"
      ? {
          id: row.node.key,
          label: row.node.name,
          points: deriveRates(row.archive, metric).points.filter(
            (point) => point.time >= from && point.time <= to,
          ),
        }
      : { id: row.node.key, label: row.node.name, points: [] },
  );
}

export function fleetCoverage(
  rows: FleetArchiveResult[],
  from: number,
  to: number,
) {
  let failed = 0,
    withSamples = 0,
    noHistory = 0,
    olderReadings = 0,
    outsideInterval = 0,
    truncated = 0;
  for (const row of rows) {
    if (row.status === "rejected") {
      failed++;
      continue;
    }
    if (row.archive.truncated) truncated++;
    if (validSamples(row.archive, from, to).length) withSamples++;
    else if (!row.archive.coverage.samples) noHistory++;
    else if (Date.parse(row.archive.coverage.to || "") < from) olderReadings++;
    else outsideInterval++;
  }
  return {
    requested: rows.length,
    failed,
    withSamples,
    noHistory,
    olderReadings,
    outsideInterval,
    truncated,
  };
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
