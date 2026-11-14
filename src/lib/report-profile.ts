/**
 * Per-type reading of a report: the few numbers worth calling out, the details
 * grouped by what they describe, and a timeline of key moments and important
 * changes. Pure data (no markup) so each type can be tested; the detail view
 * renders it with design-system components.
 */
import type { Report, Revision } from "./event-model.ts";
import { humanize } from "./event-model.ts";
import { regionTimeZone } from "./time.ts";
import { OTHER_OVERDUE, REPEATER_EVERY, REPEATER_OVERDUE, onRelaySchedule } from "./mesh-monitors.ts";

export type ProfileStat = { label: string; value: string; sub?: string; progress?: { value: number; text: string } };
export type ProfileItem = { label: string; value?: string; identifiers?: string[] };
export type ProfileSection = { title: string; items: ProfileItem[] };
/** `source`: an event in the world (report, log line, planned time). `system`: Grid's own record-keeping. */
export type MomentKind = "source" | "system";
export type ProfileMoment = { time: string; datetime: string; label: string; detail?: string; state: "past" | "now" | "future"; kind: MomentKind };
export type SourceLine = { at: number; n: number; text: string };
export type Profile = {
  /** "SR-108 E · Sullivan Creek → Hess Avenue Under-Crossing" style line, when the type knows better than areaLabel. */
  subtitle?: string;
  stats: ProfileStat[];
  sections: ProfileSection[];
  /** Short identifier strings for the header meta line ("CHP log 261109MR0185"). */
  identifiers: string[];
  /** CHP's numbered log lines (from data), oldest first. */
  log?: SourceLine[];
  /** Label for the map pin: where exactly. */
  place?: string;
  /** Replaces "Reported <time>" in the header when the type has a better clock (mesh: last relayed). */
  when?: string;
  /** The source's own words when the envelope has none (burn: the line's message and call transcript). */
  original?: { text: string; full?: string };
  timeline: ProfileMoment[];
  /** Day the timeline is on, when every moment shares it ("Nov 9"). */
  timelineDay?: string;
};

const DAY = 86_400_000;
const zoned = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, hourCycle: "h23", ...options });
const clock = zoned({ hour: "2-digit", minute: "2-digit" });
const dayLabel = zoned({ month: "short", day: "numeric" });
const dayKey = zoned({ year: "numeric", month: "2-digit", day: "2-digit" });
const ms = (value: unknown) => (typeof value === "string" && value ? Date.parse(value) : NaN);
const has = (value: unknown) => value !== null && value !== undefined && value !== "";
/** Enum-like values humanized; free text gets a capital first letter. */
const text = (value: unknown) => (typeof value === "string" && /^[A-Z][A-Z0-9_]+$/.test(value) ? humanize(value) : String(value).replace(/^./, (c) => c.toUpperCase()));
const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function duration(msValue: number) {
  // Under a minute, seconds: airtime of 8.8 s must not read as "0 m".
  if (Math.abs(msValue) < 60_000) return `${Math.round(Math.abs(msValue) / 1000)} s`;
  const minutes = Math.round(Math.abs(msValue) / 60_000);
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 48) return rest ? `${hours} h ${String(rest).padStart(2, "0")} m` : `${hours} h`;
  return plural(Math.round(minutes / 1440), "day");
}
/** "Hwy 108 from A to B, near Jamestown" → "near Jamestown" (the rest repeats the route line). */
export const nearPlace = (areaLabel?: string | null) => /\bnear ([^,]+)$/i.exec(areaLabel || "")?.[0];
const ago = (t: number, now: number) => (now - t < 60_000 ? "just now" : `${duration(now - t)} ago`);

/** Key times plus "now", sorted; times on another day than the rest carry their date. */
type Entry = { at: number; label: string; detail?: string; kind?: MomentKind };
function moments(entries: Entry[], now: number): Pick<Profile, "timeline" | "timelineDay"> {
  const seen = new Set<string>();
  const items = entries
    .filter((e) => Number.isFinite(e.at))
    .filter((e) => !seen.has(e.label + e.at) && seen.add(e.label + e.at))
    .concat([{ at: now, label: "Now" }])
    // Same instant: the world's event before Grid's record of it.
    .sort((a, b) => a.at - b.at || Number(a.kind === "system") - Number(b.kind === "system"));
  const days = new Set(items.map((e) => dayKey.format(e.at)));
  const single = days.size === 1;
  return {
    timelineDay: single ? dayLabel.format(items[0].at) : undefined,
    timeline: items.map((e) => ({
      time: single ? clock.format(e.at) : `${dayLabel.format(e.at)}, ${clock.format(e.at)}`,
      datetime: new Date(e.at).toISOString(),
      label: e.label,
      detail: e.detail,
      state: e.label === "Now" ? "now" : e.at > now ? "future" : "past",
      kind: e.kind ?? "source",
    })),
  };
}

/** Status/severity and type-specific changes between saved versions, as timeline entries. */
function changes(revisions: Revision[], fields: (report: Report) => Record<string, string | undefined>) {
  const ordered = [...revisions].sort((a, b) => Number(a.revision) - Number(b.revision));
  const out: Entry[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const before = { Status: humanize(ordered[i - 1].event.status), Severity: humanize(ordered[i - 1].event.severity), ...fields(ordered[i - 1].event) };
    const after = { Status: humanize(ordered[i].event.status), Severity: humanize(ordered[i].event.severity), ...fields(ordered[i].event) };
    for (const [key, value] of Object.entries(after)) {
      const previous = before[key as keyof typeof before];
      if (value && previous && value !== previous)
        // Timed by when Grid saw the new version, so it is Grid's clock, not the source's.
        out.push({ at: ms(ordered[i].ingestedAt || ordered[i].observedAt), label: `${key}: ${value}`, detail: `was ${previous} · seen by Grid`, kind: "system" });
    }
  }
  return out;
}

const firstSaved = (revisions: Revision[], report: Report) => {
  const first = [...revisions].sort((a, b) => Number(a.revision) - Number(b.revision))[0];
  return ms(first?.ingestedAt || report.ingestedAt);
};
/**
 * When the source says it happened. Version timestamps are Grid's clock, so a
 * candidate later than Grid's first save is not a report time and is dropped.
 */
const reportedAt = (report: Report, revisions: Revision[], explicit?: number) => {
  const saved = firstSaved(revisions, report);
  const candidates = [explicit, ms(report.effective), ...revisions.map((r) => ms(r.event.observedAt)), ms(report.observedAt)]
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  const best = Number.isFinite(explicit ?? NaN) ? explicit! : Math.min(...candidates);
  return Number.isFinite(best) && (!Number.isFinite(saved) || best <= saved + 60_000) ? best : NaN;
};
const common = (report: Report, revisions: Revision[], explicit?: number): Entry[] => {
  const versions = revisions.length;
  return [
    { at: reportedAt(report, revisions, explicit), label: "Reported", detail: report.provenance.attribution || report.provenance.sourceName || undefined },
    { at: firstSaved(revisions, report), label: "First saved by Grid", kind: "system", detail: versions > 1 ? `${versions} versions since` : undefined },
  ];
};

/**
 * CHP's numbered log, from sierra-data (`roadIncident.log`, oldest first). The
 * SDK types predate the field, so it is read defensively; older data has none.
 */
function incidentLog(report: Report): SourceLine[] {
  const raw = (report.roadIncident as { log?: { number?: number; at?: string; text?: string }[] } | undefined)?.log ?? [];
  return raw
    .map((e) => ({ at: ms(e.at), n: Number(e.number) || 0, text: String(e.text ?? "").trim() }))
    .filter((e) => Number.isFinite(e.at) && e.text)
    .sort((a, b) => a.n - b.n);
}

/** Regional calendar day as a UTC midnight, so day differences ignore DST. */
const regionalDay = (t: number) => { const [m, d, y] = dayKey.format(t).split("/").map(Number); return Date.UTC(y, m - 1, d); };
const windowDay = (t: number, now: number) => {
  const days = Math.round((regionalDay(t) - regionalDay(now)) / DAY);
  return days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : dayLabel.format(t);
};

function roadClosure(report: Report, revisions: Revision[], now: number): Profile {
  const c = report.roadIncident!.closure!;
  const start = ms(c.plannedStart), end = ms(c.plannedEnd), setUp = ms(c.setUpAt);
  const lanes = String(c.lanesClosed || "").trim(), total = Number(c.totalLanes) || 0;
  const laneText = /^\d+$/.test(lanes) && total ? `Lane ${lanes} of ${total}` : lanes ? humanize(lanes) : "Not reported";
  const stats: ProfileStat[] = [
    { label: "Lanes", value: laneText, sub: [c.closureType && humanize(c.closureType).toLowerCase(), "closed"].filter(Boolean).reverse().join(" · ") },
    { label: "Est. delay", value: has(c.estimatedDelayMinutes) ? `${c.estimatedDelayMinutes} min` : "Not reported", sub: "Caltrans estimate" },
  ];
  if (Number.isFinite(start) && Number.isFinite(end)) {
    stats.push({ label: "Window", value: `${clock.format(start)} – ${clock.format(end)}`, sub: `${duration(end - start)} · ${now > end ? "ended" : "ends"} ${windowDay(end, now)}` });
    if (now >= start && now <= end) stats.push({ label: "Progress", value: `${Math.round(((now - start) / (end - start)) * 100)}%`, progress: { value: (now - start) / (end - start), text: `${duration(now - start)} elapsed · ${duration(end - now)} remaining` } });
    else stats.push({ label: now < start ? "Starts" : "Ended", value: now < start ? `in ${duration(start - now)}` : `${duration(now - end)} ago`, sub: now < start ? `${dayLabel.format(start)}, ${clock.format(start)} PT` : undefined });
  }
  const route = [c.route, c.direction && c.direction[0]].filter(Boolean).join(" ");
  const extent = c.beginLocation && c.endLocation && c.beginLocation !== c.endLocation ? `${c.beginLocation} → ${c.endLocation}` : c.beginLocation || c.endLocation || "";
  return {
    subtitle: [route, extent].filter(Boolean).join(" · ") || undefined,
    place: extent || undefined,
    stats,
    sections: [
      { title: "Where", items: [
        { label: "Route", value: [c.route, c.facility].filter(Boolean).join(" · ") },
        { label: "Direction", value: c.direction ? (/^(north|south|east|west)$/i.test(c.direction) ? `${c.direction}bound` : c.direction) : undefined },
        { label: "Extent", value: extent || undefined },
        { label: "District", value: has(c.district) ? `Caltrans D${c.district}` : undefined },
        { label: "Nearest place", value: nearPlace(report.areaLabel)?.replace(/^near /i, "") },
      ] },
      { title: "Work", items: [
        { label: "Work type", value: c.workType || undefined },
        { label: "Closure type", value: c.closureType || undefined },
        { label: "Duration class", value: [c.closureDuration, c.endIndefinite ? "indefinite" : "not indefinite"].filter(Boolean).join(" · ") },
        { label: "Lanes", value: lanes ? `${/^\d+$/.test(lanes) ? `Lane ${lanes}` : humanize(lanes)} closed${total ? ` · ${plural(total, "lane")} total` : ""}` : undefined },
      ] },
      // The window id restates the closure id and start; the closure id alone identifies it in the header.
      { title: "Identifiers", items: [{ label: "Closure", value: c.closureId || undefined }] },
    ],
    identifiers: [],
    ...moments([
      { at: start, label: "Planned start" },
      { at: setUp, label: "Set up on the road" },
      ...common(report, revisions),
      ...changes(revisions, (r) => ({ Lanes: r.roadIncident?.closure?.lanesClosed || undefined, "Planned end": r.roadIncident?.closure?.plannedEnd ? clock.format(ms(r.roadIncident.closure.plannedEnd)) : undefined })),
      { at: end, label: "Planned end" },
    ], now),
  };
}

function roadIncident(report: Report, revisions: Revision[], now: number): Profile {
  const r = report.roadIncident!, m = (r.metadata ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((k) => m[k]).find(has) as string | undefined;
  const log = incidentLog(report);
  const used = new Set(["incident_type", "lanes_blocked", "injuries", "roadway_status", "last_update_time", "log_number", "coordinates", "reported_times", "report_time", "location_cross_streets"]);
  // With the log parsed, fields that retell it ("fire report", "reported smoke", notes) are narrative, not details.
  const narrative = (key: string) => log.length > 0 && /report|notes|smoke|narrative|description|summary/i.test(key);
  const updated = ms(pick("last_update_time")) || (log.length ? log[log.length - 1].at : NaN);
  const lanes = pick("lanes_blocked", "roadway_status");
  const injuries = pick("injuries");
  return {
    place: pick("location_cross_streets") ? text(pick("location_cross_streets")) : undefined,
    stats: [
      { label: "Incident", value: pick("incident_type") ? text(pick("incident_type")) : humanize(report.category || "incident") },
      // One tile for road impact: lanes when given, else the impact class ("None to roads").
      { label: "Road impact", value: lanes ? text(lanes) : r.impact ? (/^none$/i.test(r.impact) ? "None" : text(r.impact)) : "Not reported", sub: !lanes && r.impact ? "to roads" : undefined },
      { label: "Injuries", value: injuries ? text(injuries) : "Not reported" },
      { label: "Last log entry", value: Number.isFinite(updated) ? ago(updated, now) : "Not reported", sub: Number.isFinite(updated) ? `${clock.format(updated)} PT` : undefined },
    ],
    sections: [
      { title: "Incident", items: Object.entries(m).filter(([k, v]) => !used.has(k) && !narrative(k) && has(v) && typeof v !== "object").map(([k, v]) => ({ label: humanize(k), value: text(v) })) },
      { title: "Identifiers", items: [{ label: "CHP log", value: r.logNumber || pick("log_number") }] },
    ],
    identifiers: [],
    log,
    ...moments([
      // The report time is `effective` (CHP's dispatch time), which reportedAt prefers.
      ...common(report, revisions),
      ...log.map((l): Entry => ({ at: l.at, label: l.text, detail: `CHP log [${l.n}]` })),
      ...changes(revisions, (e) => ({ Lanes: (e.roadIncident?.metadata as Record<string, string> | undefined)?.lanes_blocked })),
    ], now),
  };
}

function wildfire(report: Report, revisions: Revision[], now: number): Profile {
  const w = report.wildfire!;
  const acres = (a: number) => `${a.toLocaleString("en-US", { maximumFractionDigits: a < 10 ? 1 : 0 })} ac`;
  const updated = ms(report.observedAt) || ms(report.ingestedAt);
  return {
    stats: [
      { label: "Size", value: has(w.acres) ? acres(Number(w.acres)) : "Not reported", sub: w.hasPerimeter ? "Mapped perimeter" : "No perimeter yet" },
      { label: "Containment", value: has(w.containment) && Number(w.containment) > 0 ? `${w.containment}%` : "Not reported", progress: has(w.containment) && Number(w.containment) > 0 ? { value: Number(w.containment) / 100, text: "contained" } : undefined },
      { label: "Last update", value: Number.isFinite(updated) ? ago(updated, now) : "Not reported", sub: Number.isFinite(updated) ? `${dayLabel.format(updated)}, ${clock.format(updated)} PT` : undefined },
    ],
    sections: [{ title: "Fire", items: [
      { label: "County", value: w.county || undefined },
      { label: "Cause", value: w.cause ? text(w.cause) : undefined },
      { label: "Started", value: report.effective ? `${dayLabel.format(ms(report.effective))}, ${clock.format(ms(report.effective))} PT` : undefined },
    ] }],
    identifiers: [],
    ...moments([
      { at: ms(report.effective), label: "Started" },
      ...common(report, revisions),
      ...changes(revisions, (e) => ({ Size: has(e.wildfire?.acres) ? acres(Number(e.wildfire!.acres)) : undefined, Containment: has(e.wildfire?.containment) ? `${e.wildfire!.containment}%` : undefined })),
    ], now),
  };
}

function power(report: Report, revisions: Revision[], now: number): Profile {
  const p = report.power!;
  const restore = ms(p.estimatedRestoration);
  const psps = !!(p.eventName || p.stage);
  return {
    stats: [
      { label: "Customers", value: has(p.customersAffected) ? Number(p.customersAffected).toLocaleString("en-US") : "Not reported", sub: "without power" },
      { label: "Medical baseline", value: has(p.medicalBaselineAffected) ? Number(p.medicalBaselineAffected).toLocaleString("en-US") : "Not reported", sub: "customers affected" },
      { label: "Est. restoration", value: Number.isFinite(restore) ? `${clock.format(restore)} PT` : "Not given", sub: Number.isFinite(restore) ? (restore > now ? `in ${duration(restore - now)} · ${windowDay(restore, now)}` : `${duration(now - restore)} ago`) : undefined },
      { label: psps ? "Shutoff stage" : "Crew", value: psps ? text(p.stage || "Not reported") : p.crewStatus || "Not reported" },
    ],
    sections: [
      { title: psps ? "Public safety power shutoff" : "Outage", items: [
        { label: "Cause", value: p.cause ? text(p.cause) : undefined },
        { label: "Crew status", value: psps ? p.crewStatus || undefined : undefined },
        { label: "Event", value: p.eventName || undefined },
        { label: "Time period", value: p.timePeriod || undefined },
      ] },
      { title: "Identifiers", items: [{ label: "Outage", value: p.outageId || undefined }, { label: "Event ID", value: p.eventId || undefined }] },
    ],
    identifiers: [],
    ...moments([
      { at: ms(p.deEnergizationStart), label: "De-energization starts" },
      { at: ms(p.deEnergizationEnd), label: "De-energization ends" },
      ...common(report, revisions),
      ...changes(revisions, (e) => ({ Crew: e.power?.crewStatus || undefined, Customers: has(e.power?.customersAffected) ? Number(e.power!.customersAffected).toLocaleString("en-US") : undefined })),
      { at: restore, label: "Estimated restoration" },
      { at: ms(p.allClear), label: "All clear" },
    ], now),
  };
}

function evacuation(report: Report, revisions: Revision[], now: number): Profile {
  const e = report.evacuation!;
  return {
    stats: [
      { label: "Level", value: e.level ? text(e.level) : "Not reported", sub: e.level === "ORDER" ? "Leave now" : e.level === "WARNING" ? "Prepare to leave" : undefined },
      { label: "Zone", value: e.zoneId || "Not reported" },
      { label: "County", value: e.county ? text(e.county) : "Not reported" },
    ],
    sections: [{ title: "Zone", items: [{ label: "Event type", value: e.eventType ? text(e.eventType) : undefined }, { label: "Area", value: report.areaLabel || undefined }] }],
    identifiers: [],
    ...moments([{ at: ms(report.effective), label: "In effect" }, ...common(report, revisions), ...changes(revisions, (r) => ({ Level: r.evacuation?.level ? text(r.evacuation.level) : undefined })), { at: ms(report.expires), label: "Expires" }], now),
  };
}

function weatherAlert(report: Report, revisions: Revision[], now: number): Profile {
  const w = report.weatherAlert!;
  const ends = ms(report.expires);
  return {
    stats: [
      { label: "NWS severity", value: w.nwsSeverity || "Not reported" },
      { label: "Certainty", value: w.certainty || "Not reported" },
      { label: "Urgency", value: w.urgency || "Not reported" },
      { label: "Ends", value: Number.isFinite(ends) ? `${clock.format(ends)} PT` : "Not given", sub: Number.isFinite(ends) ? (ends > now ? `in ${duration(ends - now)} · ${windowDay(ends, now)}` : "ended") : undefined },
    ],
    // The NWS area description lists every zone in words; the zone codes say the same compactly.
    sections: [{ title: "Notice", items: [{ label: "Instruction", value: w.instruction ? w.instruction.replace(/\s*\n\s*/g, " ") : undefined }, { label: "Zones", identifiers: w.zones?.length ? w.zones : undefined }] }],
    identifiers: [],
    ...moments([{ at: ms(report.effective), label: "In effect" }, ...common(report, revisions), ...changes(revisions, () => ({})), { at: ends, label: "Ends" }], now),
  };
}


// The same schedule and thresholds the Mesh page's relay panel uses, so a node's report and the panel agree.
const READ_EVERY = REPEATER_EVERY;
type MeshAdmin = Partial<Record<"reporterId" | "reportedAt" | "lastSuccessAt" | "lastAttemptAt" | "batteryPercentSource", string>> &
  Partial<Record<"batteryVolts" | "batteryPercent" | "temperatureC" | "humidity" | "pressure" | "noiseFloorDbm" | "lastSnrDb" | "lastRssiDbm" | "txQueueLen", number | null>> &
  Partial<Record<"uptimeSeconds" | "airtimeMs" | "rxAirtimeMs" | "packetsSent" | "packetsReceived" | "sentFlood" | "sentDirect" | "recvFlood" | "recvDirect" | "directDups" | "floodDups" | "fullEvents" | "recvErrors", string | number>>;
type MeshTelemetry = { snr?: number; rssi?: number; hopCount?: number; gateways?: string[]; lastAdvertAt?: string; lastHeardAt?: string; lastRelayedAt?: string; admin?: MeshAdmin | null };
const count = (v: unknown) => (has(v) && Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-US") : undefined);
const num = (v: unknown, unit: string, digits = 1) => (has(v) && Number.isFinite(Number(v)) ? `${Number(v).toLocaleString("en-US", { maximumFractionDigits: digits })} ${unit}` : undefined);
const at = (t: number, now: number) => (Number.isFinite(t) ? `${ago(t, now)} · ${dayLabel.format(t)}, ${clock.format(t)} PT` : undefined);

/**
 * A mesh node. Two clocks matter and neither is `observedAt` (which moves only
 * with a revision): when the mesh last heard or relayed through it, and when an
 * operator's monitor last reached it. Admin readings are as of that last reach,
 * which can be weeks old while the node relays happily, so they say so.
 */
function meshNode(report: Report, revisions: Revision[], now: number): Profile {
  const m = report.mesh!;
  const t = (m.telemetry ?? {}) as MeshTelemetry;
  const a = (t.admin ?? {}) as MeshAdmin;
  const heard = ms(t.lastHeardAt), relayed = ms(t.lastRelayedAt), advert = ms(t.lastAdvertAt);
  const reached = ms(a.lastSuccessAt), tried = ms(a.lastAttemptAt);
  const latest = Math.max(...[heard, relayed].filter(Number.isFinite), -Infinity);
  const asOf = Number.isFinite(reached) ? `as of ${dayLabel.format(reached)}${now - reached > DAY ? ` (${ago(reached, now)})` : ""}` : undefined;
  // Reachability is a monitor's verdict. Without monitor readings (no monitor, or
  // one that has never reached the node) it says nothing about the node, so it
  // is not shown: "Unreachable" there would read as the node being down.
  const monitored = !!t.admin;
  // A repeater is read on a schedule, not continuously: about every 30 minutes
  // (the relay's `RepeaterInterval`). A read 26 minutes old is on time, so a
  // problem is only a read that failed, or none for well past one interval.
  const scheduled = /repeater/i.test(m.nodeType ?? "") && onRelaySchedule(a.reporterId);
  const failed = Number.isFinite(tried) && (!Number.isFinite(reached) || tried > reached + 60_000);
  const overdue = /repeater/i.test(m.nodeType ?? "") && Number.isFinite(reached) && now - reached > (scheduled ? REPEATER_OVERDUE : OTHER_OVERDUE);
  const due = scheduled && Number.isFinite(tried) ? tried + READ_EVERY : NaN;
  const monitorLine = !monitored ? undefined
    : failed ? `Last read failed ${ago(tried, now)}${Number.isFinite(reached) ? ` · last good read ${ago(reached, now)}` : " · never read"}`
    : overdue ? `No read for ${duration(now - reached)}${scheduled ? " · expected about every 30 min" : ""}`
    : Number.isFinite(reached) ? `Read ${ago(reached, now)}${Number.isFinite(due) ? ` · next due ${due > now ? `about ${clock.format(due)} PT` : "now"}` : ""}` : undefined;
  const reach = monitored && m.reachability && !/UNSPECIFIED/.test(m.reachability) ? text(m.reachability) : undefined;
  const gateways = Array.isArray(t.gateways) ? t.gateways : [];
  const ms2 = (v: unknown) => (has(v) && Number.isFinite(Number(v)) ? duration(Number(v)) : undefined);
  return {
    when: Number.isFinite(latest) ? `Last ${latest === relayed ? "relayed" : "heard"} ${ago(latest, now)}` : undefined,
    place: m.name || undefined,
    stats: [
      { label: "Last relayed", value: Number.isFinite(relayed) ? ago(relayed, now) : "Not reported", sub: Number.isFinite(heard) ? `Advert heard ${ago(heard, now)}` : undefined },
      ...(monitored ? [{ label: "Monitor", value: failed || overdue ? (reach === "Unreachable" ? "Unreachable" : "Read overdue") : reach ?? "Not reported", sub: monitorLine }] : []),
      { label: "Battery", value: num(a.batteryVolts, "V", 2) ?? "Not reported", sub: [has(a.batteryPercent) ? `${Math.round(Number(a.batteryPercent))}%${a.batteryPercentSource ? ` ${a.batteryPercentSource}` : ""}` : "", asOf].filter(Boolean).join(" · ") || undefined },
      { label: "Signal", value: num(t.snr, "dB SNR") ?? "Not reported", sub: [num(t.rssi, "dBm", 0), gateways.length ? plural(gateways.length, "gateway") : ""].filter(Boolean).join(" · ") || undefined },
    ],
    sections: [
      { title: "Node", items: [
        { label: "Type", value: m.nodeType ? text(m.nodeType) : undefined },
        { label: "Public key", identifiers: m.publicKey ? [m.publicKey] : undefined },
      ] },
      { title: "Mesh activity", items: [
        { label: "Last relayed", value: at(relayed, now) },
        { label: "Advert last heard", value: at(heard, now) },
        // The advert's own stamp is the node's clock; say so when it is ahead of ours.
        { label: "Advert time (node clock)", value: Number.isFinite(advert) ? `${dayLabel.format(advert)}, ${clock.format(advert)} PT${advert > now + 5 * 60_000 ? " · ahead of real time" : ""}` : undefined },
        { label: "Path", value: [has(t.hopCount) ? plural(Number(t.hopCount), "hop") : "", num(t.snr, "dB SNR"), num(t.rssi, "dBm RSSI", 0)].filter(Boolean).join(" · ") },
      ] },
      { title: a.reporterId ? `Monitor · ${a.reporterId}` : "Monitor", items: !monitored ? [] : [
        { label: "Reachability", value: reach },
        { label: "Last read", value: at(reached, now) },
        // Shown only when it differs: on a good read the try and the read are the same moment.
        { label: "Last try (failed)", value: failed ? at(tried, now) : undefined },
        { label: "Next read due", value: Number.isFinite(due) ? (due > now ? `about ${clock.format(due)} PT · read about every 30 min` : "now · read about every 30 min") : undefined },
        { label: "How to read this", value: scheduled ? "The monitor reads this repeater about every 30 minutes. The health and traffic figures below are from the last good read, not live." : undefined },
      ] },
      { title: asOf ? `Health · ${asOf}` : "Health", items: [
        { label: "Battery", value: [num(a.batteryVolts, "V", 2), has(a.batteryPercent) ? `${Math.round(Number(a.batteryPercent))}%${a.batteryPercentSource ? ` (${a.batteryPercentSource})` : ""}` : ""].filter(Boolean).join(" · ") },
        { label: "Temperature", value: num(a.temperatureC, "°C") },
        { label: "Humidity", value: num(a.humidity, "%") },
        { label: "Pressure", value: num(a.pressure, "hPa") },
        { label: "Uptime", value: has(a.uptimeSeconds) ? duration(Number(a.uptimeSeconds) * 1000) : undefined },
        { label: "Noise floor", value: num(a.noiseFloorDbm, "dBm", 0) },
        { label: "Last packet", value: [num(a.lastSnrDb, "dB SNR", 2), num(a.lastRssiDbm, "dBm RSSI", 0)].filter(Boolean).join(" · ") },
        { label: "Transmit queue", value: count(a.txQueueLen) },
        { label: "Airtime", value: [ms2(a.airtimeMs) && `${ms2(a.airtimeMs)} transmit`, ms2(a.rxAirtimeMs) && `${ms2(a.rxAirtimeMs)} receive`].filter(Boolean).join(" · ") },
      ] },
      { title: "Traffic since boot", items: [
        { label: "Packets received", value: count(a.packetsReceived) },
        { label: "Packets sent", value: count(a.packetsSent) },
        { label: "Flood received / sent", value: has(a.recvFlood) || has(a.sentFlood) ? `${count(a.recvFlood) ?? "—"} / ${count(a.sentFlood) ?? "—"}` : undefined },
        { label: "Direct received / sent", value: has(a.recvDirect) || has(a.sentDirect) ? `${count(a.recvDirect) ?? "—"} / ${count(a.sentDirect) ?? "—"}` : undefined },
        { label: "Duplicates flood / direct", value: has(a.floodDups) || has(a.directDups) ? `${count(a.floodDups) ?? "—"} / ${count(a.directDups) ?? "—"}` : undefined },
        { label: "Receive errors", value: count(a.recvErrors) },
        { label: "Queue-full events", value: count(a.fullEvents) },
      ] },
      { title: gateways.length ? `Heard by ${plural(gateways.length, "gateway")}` : "Gateways", items: [{ label: "Gateways", identifiers: gateways }] },
    ],
    identifiers: [],
    // Activity, not "reported": a node has no report time, and observedAt only moves with a revision.
    ...moments([
      { at: reached, label: "Monitor read it", detail: a.reporterId || undefined },
      { at: heard, label: "Advert heard" },
      // A try is its own moment only when it failed; a good read is already above.
      ...(failed ? [{ at: tried, label: "Monitor tried", detail: "no answer" }] : []),
      { at: relayed, label: "Last relayed" },
      { at: firstSaved(revisions, report), label: "First saved by Grid", kind: "system" as const },
    ].filter((e) => !Number.isFinite(e.at) || e.at <= now), now),
  };
}

type BurnObservation = { message?: string; transcript?: string; confidence?: number; observedAt?: string };
type BurnLine = { id?: string; name?: string; phone?: string; burnDay?: string; observation?: BurnObservation | null };
type BurnStatus = { burnDay?: string; calfireStatus?: string; permission?: string; calfireEffective?: string; calfireArea?: string; calfireObservedAt?: string; burnLines?: BurnLine[] };
/** Changes older than this are counted, not listed: a burn event never ends and can change daily. */
export const BURN_WINDOW_DAYS = 30;
const burnDayText = (v?: string) => ({ BURN_DAY_YES: "Burn day", BURN_DAY_NO: "No-burn day", BURN_DAY_MARGINAL: "Burn day above 3,500 ft" } as Record<string, string>)[v ?? ""] ?? "Unknown";
const permissionText = (v?: string) => ({ BURN_PERMISSION_ALLOWED: "Allowed", BURN_PERMISSION_PROHIBITED: "Not allowed" } as Record<string, string>)[v ?? ""] ?? "Unknown";
const calfireText = (v?: string) => (v ? humanize(v) : "Unknown");
const phone = (v?: string) => (v && /^\+1\d{10}$/.test(v) ? `(${v.slice(2, 5)}) ${v.slice(5, 8)}-${v.slice(8)}` : v);

/**
 * County burn status: an ambient event that never ends and whose value is when
 * it changed. Callouts are today's answer and how long it has held; the
 * timeline lists only transitions (burn day, permission, CAL FIRE status)
 * within BURN_WINDOW_DAYS, and counts older ones.
 */
function burnStatus(report: Report, revisions: Revision[], now: number): Profile {
  const b = report.burnStatus as BurnStatus;
  const lines = b.burnLines ?? [];
  const read = lines.map((l) => l.observation).filter((o): o is BurnObservation => !!o?.observedAt);
  const latestRead = read.map((o) => ms(o.observedAt)).filter(Number.isFinite).sort((x, y) => y - x)[0];
  const fields = (e: Report) => {
    const v = e.burnStatus as BurnStatus | undefined;
    return { "Burning": v ? permissionText(v.permission) : undefined, "Air district": v ? burnDayText(v.burnDay) : undefined, "CAL FIRE": v?.calfireStatus ? calfireText(v.calfireStatus) : undefined };
  };
  // A failed reading ("Unknown") is a gap, not a decision: only real flips go on the timeline.
  const transitions = changes(revisions, fields)
    .filter((e) => !/: Unknown$/.test(e.label) && !/^was Unknown/.test(e.detail ?? ""))
    .map((e) => ({ ...e, kind: "source" as const, detail: e.detail?.replace(" · seen by Grid", "") }));
  // Since when has "Burning: <now>" held? The latest transition of the permission, else the first save.
  const since = [...transitions].reverse().find((e) => e.label.startsWith("Burning:"))?.at ?? firstSaved(revisions, report);
  const cutoff = now - BURN_WINDOW_DAYS * DAY;
  const recent = transitions.filter((e) => e.at >= cutoff), older = transitions.length - recent.length;
  const first = lines.find((l) => l.observation?.message);
  return {
    when: Number.isFinite(latestRead) ? `Burn line read ${ago(latestRead, now)}` : undefined,
    original: first?.observation?.message ? { text: first.observation.message, full: first.observation.transcript || undefined } : undefined,
    stats: [
      { label: "Burning today", value: permissionText(b.permission), sub: b.permission === "BURN_PERMISSION_ALLOWED" ? "Air district and CAL FIRE both permit" : b.permission === "BURN_PERMISSION_PROHIBITED" ? "Either authority prohibits it" : "One authority could not be read" },
      { label: "Air district", value: burnDayText(b.burnDay), sub: Number.isFinite(latestRead) ? `Burn line read ${clock.format(latestRead)} PT` : "No reading today" },
      { label: "CAL FIRE", value: calfireText(b.calfireStatus), sub: [b.calfireArea, b.calfireEffective ? `since ${dayLabel.format(ms(b.calfireEffective))}` : ""].filter(Boolean).join(" · ") || undefined },
      { label: "Unchanged for", value: Number.isFinite(since) ? duration(now - since) : "Not known", sub: Number.isFinite(since) ? `since ${dayLabel.format(since)}` : undefined },
    ],
    sections: [
      ...lines.map((l) => ({ title: l.name || "Burn line", items: [
        { label: "Today", value: burnDayText(l.burnDay) },
        { label: "Message", value: l.observation?.message },
        { label: "Read", value: l.observation?.observedAt ? at(ms(l.observation.observedAt), now) : "No reading" },
        { label: "Confidence", value: has(l.observation?.confidence) ? `${l.observation!.confidence}% (transcribed call)` : undefined },
        { label: "Phone", value: phone(l.phone) },
      ] })),
      { title: "CAL FIRE", items: [
        { label: "Status", value: calfireText(b.calfireStatus) },
        { label: "Area", value: b.calfireArea },
        { label: "Effective", value: b.calfireEffective ? `${dayLabel.format(ms(b.calfireEffective))}, ${clock.format(ms(b.calfireEffective))} PT` : undefined },
        { label: "Checked", value: b.calfireObservedAt ? at(ms(b.calfireObservedAt), now) : undefined },
      ] },
    ],
    identifiers: [],
    ...moments([
      ...recent,
      ...(older > 0 ? [{ at: cutoff, label: `${plural(older, "earlier change")} not shown`, kind: "system" as const }] : []),
      ...(Number.isFinite(latestRead) ? [{ at: latestRead, label: `Burn line: ${burnDayText(b.burnDay)}`, detail: "today's reading" }] : []),
    ], now),
  };
}

const PROFILES: Partial<Record<string, (report: Report, revisions: Revision[], now: number) => Profile>> = {
  WILDFIRE: wildfire, POWER: power, EVACUATION: evacuation, WEATHER_ALERT: weatherAlert, MESH: meshNode, BURN_STATUS: burnStatus,
};

/** The profile for a report's type, or undefined (render generic details instead). */
export function reportProfile(report: Report, revisions: Revision[] = [], now = Date.now()): Profile | undefined {
  const detail = { WILDFIRE: report.wildfire, POWER: report.power, EVACUATION: report.evacuation, WEATHER_ALERT: report.weatherAlert, MESH: report.mesh, BURN_STATUS: report.burnStatus }[report.layer as string];
  const profile = report.layer === "ROAD_INCIDENT" && report.roadIncident
    ? (report.roadIncident.closure ? roadClosure : roadIncident)(report, revisions, now)
    : detail ? PROFILES[report.layer]?.(report, revisions, now) : undefined;
  if (!profile) return undefined;
  // Absence of information is not a callout: drop unknown tiles (keep at least one).
  const known = profile.stats.filter((stat) => !/^(not reported|not given|unknown|none reported)$/i.test(stat.value));
  profile.stats = known.length ? known : profile.stats.slice(0, 1);
  // Identifiers belong in the header meta line, not a card of their own.
  const ids = profile.sections.find((section) => section.title === "Identifiers");
  profile.sections = profile.sections.filter((section) => section !== ids);
  profile.identifiers.push(...(ids?.items ?? []).filter((item) => has(item.value)).map((item) => `${item.label} ${item.value}`));
  // Empty values and sections are dropped, so a sparse source does not show blank rows.
  profile.sections = profile.sections
    .map((section) => ({ ...section, items: section.items.filter((item) => (item.identifiers ? item.identifiers.length : has(item.value))) }))
    .filter((section) => section.items.length);
  return profile;
}

/** Generic timeline for types without a profile: report, first save, status changes, now. */
export function genericTimeline(report: Report, revisions: Revision[], now = Date.now()) {
  return moments([...common(report, revisions), ...changes(revisions, () => ({})), { at: ms(report.expires), label: "Expires" }], now);
}
