/** Data-site browser semantics, adapted for Grid: reports, not API envelopes. */
import type { Context } from "./context";
import type { FeedItemProps } from "@sierragridteam/design-system/lib/ui";
import { regionalTime } from "./time.ts";
export type Report = Extract<Awaited<ReturnType<Context["client"]["getEvent"]>>, { notModified: false }>["data"];
export type Revision = Extract<Awaited<ReturnType<Context["client"]["getEventHistory"]>>, { notModified: false }>["data"]["revisions"][number];
export const eventTypes = [
  ["ALL", "All types"], ["WILDFIRE", "Wildfires"], ["ROAD_INCIDENT", "Roads"],
  ["WEATHER_ALERT", "Weather notices"], ["POWER", "Power"], ["EVACUATION", "Evacuations"],
  ["BURN_STATUS", "Burn day"], ["MESH", "Mesh"],
] as const;
export const severityRank: Record<string, number> = { EXTREME: 4, SEVERE: 3, MODERATE: 2, MINOR: 1, INFO: 0 };
export const typeLabel = (type: string) => eventTypes.find(([id]) => id === type)?.[1] || humanize(type);
export function humanize(value: string) {
  return value.replace(/^(BURN_PERMISSION_|BURN_DAY_|CALFIRE_|EVACUATION_LEVEL_)/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase().replace(/^./, c => c.toUpperCase());
}
export function reportTime(report: Report): number {
  // Match data-site ordering: the Grid receipt time is not a node's drifting clock.
  return Date.parse(report.ingestedAt || "") || 0;
}
export const newestFirst = (a: Report, b: Report) => reportTime(b) - reportTime(a) || a.id.localeCompare(b.id);
export const feedOrder = (a: Report, b: Report) =>
  (severityRank[b.severity] ?? -1) - (severityRank[a.severity] ?? -1) || newestFirst(a, b);
export function headlineCounts(reports: Report[], truncated: boolean, place = "Ebbetts Pass Corridor") {
  const active = reports.filter(e => e.status === "ACTIVE").length;
  const scheduled = reports.filter(e => e.status === "SCHEDULED").length;
  const extreme = reports.filter(e => e.severity === "EXTREME").length;
  const severe = reports.filter(e => e.severity === "SEVERE").length;
  const total = reports.length;
  const count = `${truncated ? "At least " : ""}${total.toLocaleString()}`;
  const qualifier = scheduled ? "active or scheduled" : "active";
  const first = `${count} ${total === 1 ? "event is" : "events are"} ${qualifier} in ${place}.`;
  const second = extreme ? `${truncated ? "At least " : ""}${extreme} ${extreme === 1 ? "is" : "are"} extreme.`
    : severe ? `${truncated ? "At least " : ""}${severe} ${severe === 1 ? "is" : "are"} severe.`
    : truncated ? "More reports are available." : "None are rated severe or extreme.";
  return { first, second, active, scheduled, total, severe, extreme };
}
export function relativeTime(value: string | null | undefined, now = Date.now()) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "Time not supplied";
  const delta = now - time;
  if (delta < -60000) return "Source time is ahead";
  const minutes = Math.max(0, Math.floor(delta / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function reportFeedProps(report: Report, href: string, revision?: Revision): FeedItemProps {
  const time = revision?.observedAt || revision?.ingestedAt || report.ingestedAt;
  const closure = report.status === "SCHEDULED" ? report.roadIncident?.closure : undefined;
  return {
    title: report.headline || "Untitled report", href,
    severity: { tone: ["SEVERE", "EXTREME"].includes(report.severity) ? "alarm" : report.severity === "MODERATE" ? "elevated" : "muted", label: humanize(report.severity) },
    tags: [typeLabel(report.layer), humanize(report.status)], place: report.areaLabel,
    when: revision ? `${regionalTime(time)} · Update ${revision.revision}` : closure ? `${regionalTime(closure.plannedStart)} – ${regionalTime(closure.plannedEnd)}` : undefined,
    received: revision ? undefined : relativeTime(time), receivedAt: time,
    source: (report.provenance.attribution || report.provenance.sourceName || "Source not supplied") + (report.enhancement?.fields.length ? " · Grid summary" : ""),
  };
}

// As in sierra-data's diff.js, compare consecutive saved versions, not the
// current event against every historical row. Only reader-facing fields enter
// this projection: receipt clocks and generated model I/O are not event changes.
export function reportFields(report: Report): Record<string, string> {
  const values: Record<string, string> = {};
  const add = (name: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    values[name] = typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : typeof value === "boolean" ? (value ? "Yes" : "No")
      : /^[A-Z][A-Z0-9_]+$/.test(String(value)) ? humanize(String(value)) : String(value);
  };
  add("Status", humanize(report.status)); add("Severity", humanize(report.severity));
  add("Headline", report.headline); add("Summary", report.summary); add("Area", report.areaLabel);
  add("Original report", report.description);
  const detail = report.wildfire || report.power || report.evacuation || report.weatherAlert || report.earthquake || report.roadIncident || report.burnStatus || report.mesh;
  const labels: Record<string, string> = { acres: "Area (acres)", containment: "Containment (%)", depthKm: "Depth (km)", customersAffected: "Customers affected", estimatedRestoration: "Estimated restoration", plannedStart: "Planned start", plannedEnd: "Planned end", areaDesc: "Affected area", permission: "Burn permission", calfireObservedAt: "CAL FIRE report time" };
  const walk = (object: Record<string, unknown>, prefix = "") => {
    for (const [key, value] of Object.entries(object)) {
      if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
      const label = labels[key] || humanize(key);
      if (Array.isArray(value)) {
        if (value.every(v => typeof v !== "object")) add(prefix + label, value.join(", "));
      } else if (typeof value === "object") walk(value as Record<string, unknown>, prefix + (key === "closure" ? "" : label + " · "));
      else add(prefix + label, key === "containment" && value === 0 ? "0 / not reported" : value);
    }
  };
  if (detail) walk(detail as Record<string, unknown>);
  return values;
}
export function reportChanges(before: Report, after: Report) {
  const a = reportFields(before), b = reportFields(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(key => a[key] !== b[key])
    .map(label => ({ label, kind: !Object.hasOwn(a, label) ? "added" : !Object.hasOwn(b, label) ? "removed" : "changed", before: a[label] || "Not supplied", after: b[label] || "Not supplied" }));
}
