/**
 * The mesh as a fleet: what the overview map and dashboard show. Pure, so the
 * thresholds and rankings are tested rather than eyeballed.
 *
 * Inputs are the place's mesh_node and mesh_link layers and each monitored
 * node's telemetry archive. Nothing here invents a reading: a node without a
 * monitor is judged only on mesh activity, and missing data stays missing.
 */
import type { V1MeshTelemetryArchive } from "@sierragridteam/sdk";
import { telemetrySeries, type TelemetryMetric } from "./mesh-telemetry.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type MeshNode = {
  key: string; name: string; type: string; inRegion: boolean;
  coordinates?: [number, number];
  lastHeardAt?: number; lastRelayedAt?: number;
  reachability?: string;
  admin?: { lastSuccessAt?: number; batteryVolts?: number | null; reporterId?: string } | null;
};
export type MeshLink = { a: string; b: string; observations: number; bestSnr: number; lastSeen: number; coordinates: [number, number][] };

/** Latest of the two activity clocks, ignoring future stamps (node clocks drift; ours do not). */
export const lastActive = (n: MeshNode, now: number) => {
  const t = [n.lastHeardAt, n.lastRelayedAt].filter((v): v is number => Number.isFinite(v) && v! <= now);
  return t.length ? Math.max(...t) : undefined;
};

/** Link strength from the best SNR heard on it (MeshCore decodes down to about −7.5 dB at SF8). */
export function linkStrength(snr: number): "strong" | "fair" | "weak" {
  return snr >= 8 ? "strong" : snr >= 3 ? "fair" : "weak";
}
export const strengthTone = { strong: "pine", fair: "ochre", weak: "manzanita" } as const;

/** Line weight by traffic (1–3.5 px), log-scaled so one busy link does not drown the rest. */
export function linkWeight(observations: number, busiest: number) {
  if (busiest <= 1) return 1.25;
  return 1 + 2.5 * Math.log10(Math.max(1, observations)) / Math.log10(busiest);
}

export type Severity = "alarm" | "warn";
export type Issue = { severity: Severity; text: string };
export type Attention = { node: MeshNode; issues: Issue[]; worst: Severity };

/**
 * What needs investigating, worst first. Activity applies to every node;
 * monitor rules only where a monitor has reached the node at least once.
 */
export function attention(nodes: MeshNode[], archives: Map<string, V1MeshTelemetryArchive>, now: number): Attention[] {
  const out: Attention[] = [];
  const errorShares: number[] = [];
  const shareOf = (key: string) => {
    const archive = archives.get(key);
    if (!archive) return undefined;
    const errors = mean(telemetrySeries(archive, "receiveErrorsPerMinute").points, now - DAY);
    const received = mean(telemetrySeries(archive, "packetsReceivedPerMinute").points, now - DAY);
    return errors !== undefined && received ? errors / (errors + received) : undefined;
  };
  for (const n of nodes) { const s = shareOf(n.key); if (s !== undefined) errorShares.push(s); }
  const typicalShare = median(errorShares);

  for (const n of nodes.filter((node) => node.inRegion)) {
    const issues: Issue[] = [];
    const active = lastActive(n, now);
    if (active === undefined) issues.push({ severity: "warn", text: "No activity on record" });
    else if (now - active > 2 * DAY) issues.push({ severity: "alarm", text: `Silent for ${ageText(now - active)}` });
    else if (now - active > 12 * HOUR) issues.push({ severity: "warn", text: `Quiet for ${ageText(now - active)}` });

    if (n.admin) {
      const reached = n.admin.lastSuccessAt;
      if (n.reachability === "UNREACHABLE" && reached !== undefined)
        issues.push({ severity: now - reached > 7 * DAY ? "alarm" : "warn", text: `Monitor can't reach it (last ${ageText(now - reached)} ago)` });
      const archive = archives.get(n.key);
      if (archive) {
        const battery = telemetrySeries(archive, "batteryVolts");
        const recent = battery.points.filter((p) => p.value !== null && p.time >= now - DAY);
        const latest = recent.at(-1)?.value ?? undefined;
        if (latest !== undefined && latest !== null) {
          if (latest < 3.5) issues.push({ severity: "alarm", text: `Battery low · ${latest.toFixed(2)} V` });
          else if (latest < 3.7) issues.push({ severity: "warn", text: `Battery low · ${latest.toFixed(2)} V` });
          const first = recent[0]?.value;
          if (first !== null && first !== undefined && first - latest > 0.15) issues.push({ severity: "warn", text: `Battery falling · −${(first - latest).toFixed(2)} V in 24 h` });
        }
        const resets = archive.reboots.map((t) => Date.parse(t)).filter((t) => t >= now - DAY).length;
        if (resets) issues.push({ severity: resets > 2 ? "alarm" : "warn", text: resets === 1 ? "Rebooted in the last 24 h" : `Rebooted ${resets}× in 24 h` });
        const share = shareOf(n.key);
        if (share !== undefined && typicalShare !== undefined && share > 0.5 && share > typicalShare * 1.25)
          issues.push({ severity: "warn", text: `Receive errors ${Math.round(share * 100)}% of traffic (mesh typical ${Math.round(typicalShare * 100)}%)` });
        const temp = telemetrySeries(archive, "temperatureC").latest;
        if (temp !== undefined && temp >= 50) issues.push({ severity: temp >= 60 ? "alarm" : "warn", text: `Running hot · ${temp.toFixed(0)} °C` });
      }
    }
    if (issues.length) out.push({ node: n, issues, worst: issues.some((i) => i.severity === "alarm") ? "alarm" : "warn" });
  }
  const rank = (a: Attention) => (a.worst === "alarm" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || b.issues.length - a.issues.length || a.node.name.localeCompare(b.node.name));
}

/** Map tone for a node: its worst issue, else live (relayed or heard in the last hour), else quiet. */
export function nodeTone(n: MeshNode, issues: Attention | undefined, now: number) {
  if (issues?.worst === "alarm") return "alarm";
  if (issues?.worst === "warn") return "ochre";
  const active = lastActive(n, now);
  return active !== undefined && now - active <= HOUR ? "pine" : "muted";
}

/** Hourly buckets across `days`, ending at the current hour. */
export function hourBuckets(now: number, days: number) {
  const end = Math.ceil(now / HOUR) * HOUR, start = end - days * DAY;
  return Array.from({ length: days * 24 }, (_, i) => start + i * HOUR);
}

/** One heatmap row per node: the metric's mean in each hourly bucket, null where nothing was reported. */
export function heatmapRows(nodes: MeshNode[], archives: Map<string, V1MeshTelemetryArchive>, metric: TelemetryMetric, buckets: number[]) {
  return nodes.flatMap((n) => {
    const archive = archives.get(n.key);
    if (!archive) return [];
    const points = telemetrySeries(archive, metric).points;
    return [{ node: n, values: buckets.map((start) => mean(points, start, start + HOUR) ?? null) }];
  });
}

/**
 * Mesh activity per hour: the median node's packet rate. A flooded packet is
 * heard by every node, so summing nodes counts it once per node; the median
 * node is what one node on this mesh typically hears, and a single node's
 * burst does not swing it.
 */
export function fleetTraffic(rows: { values: (number | null)[] }[], buckets: number[]) {
  return buckets.map((time, i) => {
    const values = rows.map((r) => r.values[i]).filter((v): v is number => v !== null);
    return { time, value: median(values) ?? null, reporting: values.length };
  });
}

/**
 * Receive errors as a percentage of everything the node took in, per hourly
 * bucket (null where either rate is missing or nothing arrived). Raw error
 * counts follow traffic; the share shows a node whose radio is struggling.
 */
export function errorRateRows(nodes: MeshNode[], archives: Map<string, V1MeshTelemetryArchive>, buckets: number[]) {
  const errors = heatmapRows(nodes, archives, "receiveErrorsPerMinute", buckets);
  const received = heatmapRows(nodes, archives, "packetsReceivedPerMinute", buckets);
  return errors.map((row, r) => ({
    node: row.node,
    values: row.values.map((e, i) => {
      const ok = received[r].values[i];
      return e === null || ok === null || e + ok <= 0 ? null : (100 * e) / (e + ok);
    }),
  }));
}

/** Links by strength band, for the link-quality panel. */
export function strengthCounts(links: MeshLink[]) {
  const counts = { strong: 0, fair: 0, weak: 0 };
  for (const l of links) counts[linkStrength(l.bestSnr)]++;
  return counts;
}

function mean(points: { time: number; value: number | null }[], from: number, to = Infinity) {
  const values = points.filter((p) => p.value !== null && p.time >= from && p.time < to).map((p) => p.value as number);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}
function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function ageText(ms: number) {
  const hours = ms / HOUR;
  return hours < 1 ? `${Math.max(1, Math.round(ms / 60_000))} min` : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} days`;
}
