/**
 * What a page says before any script runs: the record Grid held when the site
 * was built, and the page of a single report. Pure: the build reads the API
 * (`build/snapshot.ts`) and the components only render what these return.
 *
 * One rule decides every word here. A prerendered page is read long after it
 * was written, so it never says how things are: no "open", no "none active",
 * no "3 h ago". It says what was saved and when ("closed Nov 17, 2026, 15:35
 * PT"), which stays true whenever it is read. What is true now is live data,
 * and the page says where that is.
 */
import type { ViewId } from "../config/views.ts";
import { datedDay, datedTime } from "./time.ts";
import { humanize, isReading, reportChanges, reportFields, reportTitle, severityRank, typeLabel, type Report, type Revision } from "./event-model.ts";
import { isOwnService, recordList, roadRecord, sourceChanges } from "./record-model.ts";
import { acresText, customers, evacuationEpisodes, fireSeason, fires, isShutoff, startedAt, type Report as ConditionReport } from "./conditions-model.ts";
import { firstSaved, genericTimeline, phone, readingCalls, reportProfile } from "./report-profile.ts";
import { deepLink, eventSlug, recordPath } from "./seo-model.ts";
import { regionTimeZone } from "./time.ts";

const DAY = 86_400_000;
const ms = (value: unknown) => (typeof value === "string" && value ? Date.parse(value) : NaN);
const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const sentence = (text: string) => text.replace(/^./, (c) => c.toUpperCase());

// ---- What the build reads ------------------------------------------------

/** A report's saved revisions as the build read them; `complete` is false when the service had more than one page. */
export type History = { revisions: Revision[]; complete: boolean };
export type SourceRow = { id: string; name: string; kind?: string | null; attribution?: string; homepageUrl?: string; pollIntervalSeconds?: number };
export type ScannerRow = { feedId?: string; channelLabel?: string; agency?: string; broadcastifyUrl?: string };
export type CameraRow = { id?: string; name?: string; route?: string; nearbyPlace?: string; county?: string; elevationFeet?: number | null };
/** A list the build read up to a cap: `incomplete` when the service still had more, and then no count of it is a total. */
type Listed<T> = { items: T[]; incomplete: boolean };
export type Snapshot = {
  /** When the reads were made. Every "read at" on a prerendered page is this. */
  builtAt: number;
  /** The reports that get a page of their own (`isNotable`), every status. */
  notable: Listed<Report>;
  /** By report id. Absent: the revisions could not be read for that report in this build. */
  histories: Record<string, History | undefined>;
  roads: { segments: Report[]; revisions: Revision[]; incomplete: boolean; days: number; from: number };
  burn: { events: Report[]; histories: Record<string, History | undefined> };
  sources: { rows: SourceRow[]; health: Report[]; revisions: Revision[]; incomplete: boolean; days: number; from: number };
  mesh: Listed<Report>;
  /** Interruptions that have ended, over the last `weeks`. */
  power: Listed<Report> & { weeks: number };
  scanners: ScannerRow[];
  cameras: CameraRow[];
};

// ---- Which reports get a page -------------------------------------------

type Severity = "INFO" | "MINOR" | "MODERATE" | "SEVERE" | "EXTREME";
export type NotableLayer = "WILDFIRE" | "EVACUATION" | "WEATHER_ALERT" | "CHAIN_CONTROL" | "POWER" | "ROAD_INCIDENT";
/**
 * The reports worth an address of their own, as the queries that find them:
 * every wildfire, evacuation, weather alert and chain requirement; a power
 * interruption rated moderate or above (most outages affect one customer);
 * a road incident rated severe or above (moderate is every planned lane
 * closure, 742 of them in the first five months on record).
 */
export const NOTABLE: readonly { layer: NotableLayer; severityMin?: Severity }[] = [
  { layer: "WILDFIRE" }, { layer: "EVACUATION" }, { layer: "WEATHER_ALERT" }, { layer: "CHAIN_CONTROL" },
  { layer: "POWER", severityMin: "MODERATE" }, { layer: "ROAD_INCIDENT", severityMin: "SEVERE" },
];
export function isNotable(report: { layer: string; severity: string }) {
  const rule = NOTABLE.find((r) => r.layer === report.layer);
  return !!rule && (severityRank[report.severity] ?? -1) >= (rule.severityMin ? severityRank[rule.severityMin] : -1);
}
/**
 * Whether the lists the build read can be believed, against the pages already
 * published. A report keeps its page once it has one, so nearly every
 * published id should still be listed; when fewer than half are, the service
 * answered short, and publishing would say "none on record" of a record that
 * is there. Returns why not, or nothing.
 */
export function plausible({ published, listed }: { published: number; listed: number }): string | undefined {
  return published >= 20 && listed < published / 2
    ? `only ${listed} of the ${published} reports with a published page are in the lists read; refusing to publish a record that short`
    : undefined;
}
/** Over, as the API says it: not active and not scheduled. Only then is a report's page offered to search engines. */
export const hasEnded = (report: { status: string }) => report.status === "RESOLVED" || report.status === "EXPIRED";

const KIND: Record<string, string> = {
  WILDFIRE: "Wildfire report", EVACUATION: "Evacuation notice", WEATHER_ALERT: "National Weather Service alert",
  CHAIN_CONTROL: "Chain control requirement", POWER: "Power interruption", ROAD_INCIDENT: "Road incident",
};
/** Who said so, in words a reader knows, with the API's own attribution when it differs ("Caltrans (cwwp2.dot.ca.gov)"). */
function attributionOf(report: Report) {
  const name = report.provenance?.sourceName?.trim(), credit = report.provenance?.attribution?.trim();
  return name && credit && !credit.toLowerCase().includes(name.toLowerCase()) ? `${name} (${credit})` : credit || name || "a source that was not named";
}
/** Coordinates are on the map of the live report; they are not details a reader scans, and their jitter is not a change. */
const isCoordinate = (label: string) => /(^| · )(lat|lng|lon|long|latitude|longitude)$/i.test(label);
const kindOf = (report: Report) => KIND[report.layer] ?? `${typeLabel(report.layer)} report`;
/**
 * When a report began, and who says so. The source's own time (`effective`)
 * when it had come by the last saved revision; an alert's onset can lie after
 * the alert was withdrawn, and a scheduled closure's lies ahead, and neither
 * "began" then. Otherwise when Grid first saved it, known only with revision
 * 1 in hand. Never the report's `observedAt`: that is its newest revision's
 * time, which for an ended report is when it ended.
 */
export function beganAt(report: Report, history?: History): { at: number; by: "source" | "grid" | "unknown" } {
  const effective = ms(report.effective), last = lastSavedAt(report, history), first = firstSaved(history?.revisions ?? [], report);
  if (Number.isFinite(effective) && !(effective > last)) return { at: effective, by: "source" };
  return Number.isFinite(first) ? { at: first, by: "grid" } : { at: NaN, by: "unknown" };
}
/** The report with its start filled in, for the models that read `effective` first (`fires`, `evacuationEpisodes`, `startedAt`). */
function withStart<T extends Report>(report: T, history?: History): T {
  const began = beganAt(report, history);
  // With no start known, the models fall back to the newest revision's time; the entry then carries no time at all (`timed`).
  return Number.isFinite(began.at) ? { ...report, effective: new Date(began.at).toISOString() } : report;
}
/** An entry's time, only when the report's start is known. */
const timed = (report: Report, history?: History) => { const at = beganAt(report, history).at; return Number.isFinite(at) ? at : undefined; };
const LEVELS = ["ORDER", "WARNING"];
/** An evacuation zone at the highest level any saved revision gave it: a zone issued as an order and eased to a warning before it was lifted was an order. */
function atHighestLevel<T extends Report>(report: T, history?: History): T {
  const levels = [report, ...(history?.revisions ?? []).map((r) => r.event)].map((e) => e.evacuation?.level ?? "");
  const top = LEVELS.find((level) => levels.includes(level));
  return top && report.evacuation && report.evacuation.level !== top ? { ...report, evacuation: { ...report.evacuation, level: top } } : report;
}
/**
 * The record models word a change for a page rendered beside the live state
 * ("now restricted", "R2 in effect"). On a page read later the same entry is
 * said in the past, so that no line lifted from it reads as the present.
 */
export function inPastTense(label: string): string {
  return label
    .replace(/^Now /, "Changed to ")
    .replace(/: chains now /, ": chains changed to ")
    .replace(/^(R\d|Chain control) now /, "$1 stretch changed to ")
    .replace(/ now /, " became ")
    .replace(/ in effect$/, " was in effect");
}
/** When the report last changed, as far as the build read: its newest saved revision, else the report's own receipt time. */
function lastSavedAt(report: Report, history?: History) {
  const newest = [...(history?.revisions ?? [])].sort((a, b) => Number(b.revision) - Number(a.revision))[0];
  return [ms(newest?.ingestedAt), ms(newest?.observedAt), ms(report.ingestedAt), ms(report.observedAt)].find(Number.isFinite) ?? NaN;
}

// ---- A report's own page -------------------------------------------------

export type RecordChange = { label: string; kind: string; before: string; after: string };
export type RecordRevision = { revision: number; at: number; what: "first" | "reading" | "changes" | "same" | "unknown"; changes: RecordChange[] };
export type RecordPage = {
  id: string; slug: string; path: string;
  /** The same report in the live explorer. */
  live: string;
  title: string; description: string; kicker: string; heading: string;
  /** Under the heading: where, who said so, when. */
  lines: string[];
  ended: boolean;
  /** Offered to search engines and listed in the sitemap: only a report that has ended. */
  indexable: boolean;
  /** ISO time of the newest saved revision, for the sitemap and the structured data. */
  lastSaved?: string;
  firstSaved?: string;
  /** What the page says about the report's state: always as of a saved revision, never as of now. */
  note: { tone: "green" | "brass"; text: string };
  summary?: string;
  original?: { text: string; transcript?: string };
  facts: { label: string; value: string }[];
  timeline: { at: number; label: string; detail?: string; system: boolean }[];
  revisions: RecordRevision[];
  /** Under the revisions: what is not shown, or that they could not be read. */
  historyNote?: string;
  source?: { label: string; href: string };
};

/** Revisions listed on a report's page; a chain requirement's slot can carry many more. */
export const RECORD_REVISIONS = 40;
const ISO_TIME = /^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)$/;
/** A field's value as text that carries its date: an ISO time is written out in Pacific time with its year. */
const dated = (value: string) => (ISO_TIME.test(value) ? datedTime(value) : value);

export function recordPage(report: Report, history: History | undefined, builtAt: number): RecordPage {
  const ended = hasEnded(report);
  const revisions = history?.revisions ?? [];
  const ordered = [...revisions].sort((a, b) => Number(b.revision) - Number(a.revision));
  const last = lastSavedAt(report, history), first = firstSaved(revisions, report), began = beganAt(report, history);
  const kind = kindOf(report), from = attributionOf(report), where = report.areaLabel || "";
  const heading = reportTitle(report);
  const complete = !!history?.complete;

  // The profile gives the timeline its domain words ("R2 posted", "Lifted"). Its tiles are left out:
  // they are written for a page rendered now ("3 h ago", "ends in"), and this one is read later.
  const profile = reportProfile(report, revisions, builtAt, { complete });
  const moments = (profile ?? genericTimeline(report, revisions, builtAt)).timeline
    .filter((m) => m.label !== "Now" && Number.isFinite(ms(m.datetime)))
    .map((m) => ({ at: ms(m.datetime), label: inPastTense(String(m.label)), detail: m.detail ? String(m.detail) : undefined, system: m.kind === "system" }));

  const byNumber = new Map(revisions.map((r) => [Number(r.revision), r]));
  const listed: RecordRevision[] = ordered.slice(0, RECORD_REVISIONS).map((r) => {
    const n = Number(r.revision), before = byNumber.get(n - 1), at = ms(r.ingestedAt) || ms(r.observedAt);
    if (isReading(r)) return { revision: n, at, what: "reading", changes: [] };
    if (n === 1) return { revision: n, at, what: "first", changes: [] };
    // Without the revision before it, what changed is not known, and is not guessed.
    if (!before) return { revision: n, at, what: "unknown", changes: [] };
    const changes = reportChanges(before.event, r.event).filter((c) => !isCoordinate(c.label)).map((c) => ({ ...c, before: dated(c.before), after: dated(c.after) }));
    return { revision: n, at, what: changes.length ? "changes" : "same", changes };
  });
  const total = Math.max(Number(report.revision) || 0, revisions.length);
  const historyNote = !history ? "The saved revisions of this report could not be read when this page was built."
    : !complete || total > listed.length ? `${plural(listed.length, "revision")} of ${total.toLocaleString("en-US")} shown. The rest are in the live report.`
    : undefined;

  const facts = Object.entries(reportFields(report))
    .filter(([label]) => !["Headline", "Summary", "Original report", "Area"].includes(label))
    // A status on its own reads as how things are; the note above says it with its time.
    .filter(([label]) => label !== "Status" && !isCoordinate(label))
    .map(([label, value]) => ({ label, value: dated(value) }));

  // Both are said of a saved revision at its time. A chain requirement or an evacuation zone is a
  // slot that can be issued again, so even "ended" is only what the last revision said.
  const note = ended
    ? { tone: "green" as const, text: `At Grid's last saved revision, ${datedTime(last)}, this report had ended (status “${humanize(report.status)}”). This page was built ${datedTime(builtAt)}; the live report shows it as it stands.` }
    : { tone: "brass" as const, text: `This report had not ended at Grid's last saved revision, ${datedTime(last)}. This page is a snapshot built ${datedTime(builtAt)} and says nothing of the present: open the live report for that.` };
  const sourceUrl = [report.provenance?.sourceUrl, report.canonicalUrl].find((u) => typeof u === "string" && /^https?:\/\//i.test(u));
  const original = report.description || profile?.original?.text || "";

  return {
    id: report.id, slug: eventSlug(report.id), path: recordPath(report.id), live: deepLink(report.id),
    title: Number.isFinite(began.at) ? `${heading}, ${datedDay(began.at)}` : heading,
    description: `${kind}${where ? ` for ${where}` : ""}, from ${from}. ${Number.isFinite(first) ? `First saved by Grid ${datedTime(first)}` : "On record with Grid"}${ended ? `; ended by ${datedTime(last)}` : ""}. ${total > 1 ? `${plural(total, "saved revision")}${history && !historyNote ? ", with what changed in each" : ""}.` : "One saved revision."}`,
    kicker: `${kind} · on record`, heading,
    lines: [where, from, began.by === "source" ? `Began ${datedTime(began.at)}` : began.by === "grid" ? `First saved by Grid ${datedTime(began.at)}` : ""].filter(Boolean),
    ended, indexable: ended,
    lastSaved: Number.isFinite(last) ? new Date(last).toISOString() : undefined,
    firstSaved: Number.isFinite(first) ? new Date(first).toISOString() : undefined,
    note, summary: report.summary || undefined,
    original: original ? { text: original, transcript: report.description ? undefined : profile?.original?.full } : undefined,
    facts, timeline: moments, revisions: listed, historyNote,
    source: sourceUrl ? { label: from, href: sourceUrl } : undefined,
  };
}

/** Structured data for a report's page: a `Report` with its publisher, its place and the source it is based on. */
export function recordLd(page: RecordPage, report: Report, absolute: (path: string) => string, organizationId: string) {
  return {
    "@type": "Report", "@id": `${absolute(page.path)}#report`, headline: page.heading.slice(0, 110), name: page.title, description: page.description,
    url: absolute(page.path), mainEntityOfPage: absolute(page.path), inLanguage: "en-US",
    ...(page.firstSaved ? { datePublished: page.firstSaved } : {}), ...(page.lastSaved ? { dateModified: page.lastSaved } : {}),
    publisher: { "@id": organizationId },
    sourceOrganization: { "@type": "Organization", name: attributionOf(report) },
    ...(page.source ? { isBasedOn: page.source.href } : {}),
    ...(report.areaLabel ? { contentLocation: { "@type": "Place", name: report.areaLabel } } : {}),
  };
}

// ---- The record on each page --------------------------------------------

export type StaticEntry = { at?: number; text: string; detail?: string; href?: string };
export type StaticSection = {
  id: string; title: string; lead?: string; entries: StaticEntry[]; note?: string;
  /** The lead without what it says of its own list ("listed below"), for the Overview, which repeats the lead and not the list. */
  summary?: string;
};

/** Entries a section lists; the rest are counted in its note. */
const CAP = 40;
function capped(entries: StaticEntry[], incomplete: boolean, what: string): Pick<StaticSection, "entries" | "note"> {
  const hidden = Math.max(0, entries.length - CAP);
  return { entries: entries.slice(0, CAP), note: incomplete ? `Older ${what} were not read: this list is incomplete.` : hidden ? `${plural(hidden, `earlier ${what.replace(/s$/, "")}`, `earlier ${what}`)} not shown.` : undefined };
}

/** Where a report is linked to: its own page when it has one, else the live explorer (at a revision, when one is meant). */
function linker(snap: Snapshot) {
  const paged = new Set(snap.notable.items.map((r) => r.id));
  return (id: string, revision?: number) => (paged.has(id) ? recordPath(id) : deepLink(id, revision));
}

function roadSections(snap: Snapshot): StaticSection[] {
  const { roads } = snap, link = linker(snap);
  const list = recordList(roadRecord(roads.revisions), ROAD_ENTRIES, roads.incomplete);
  const period = `the ${roads.days} days before ${datedTime(snap.builtAt)}`;
  // When every monitored road's first revision is inside the period, recording began inside it.
  const firsts = roads.revisions.filter((r) => r.event.layer === "ROAD_SEGMENT" && Number(r.revision) === 1).map((r) => ms(r.observedAt) || ms(r.ingestedAt)).filter(Number.isFinite);
  const roadIds = new Set(roads.revisions.filter((r) => r.event.layer === "ROAD_SEGMENT").map((r) => r.event.id));
  const began = !roads.incomplete && roadIds.size > 0 && firsts.length === roadIds.size && Math.min(...firsts) >= roads.from ? Math.min(...firsts) : NaN;
  return [
    {
      id: "road-record", title: "Chain controls and road status on record",
      lead: `Each chain requirement posted, changed and lifted, and each monitored road closing, reopening or coming under chains, as Grid saved it in ${roads.incomplete ? "up to " : ""}${period}, newest first.${Number.isFinite(began) ? ` Road status has been on record since ${datedDay(began)}.` : ""}`,
      entries: list.shown.map((e) => ({ at: e.at, text: inPastTense(e.label), detail: e.detail, href: link(e.id, e.revision) })),
      note: list.shown.length ? list.note || undefined
        : roads.incomplete ? "No change in the part of the record that was read. Older entries were not read." : `No change is on record in ${period}. That is what Grid saved, not proof that nothing changed.`,
    },
    {
      id: "road-monitored", title: "Monitored roads",
      lead: "Grid keeps a standing report for each of these roads and revises it when the road closes, reopens or comes under chain control. Each links to the road's report and its revisions.",
      entries: roads.segments.map((r) => ({ text: [r.roadSegment?.name, r.roadSegment?.section].filter(Boolean).join(" ") || r.areaLabel || r.headline, href: link(r.id) }))
        .sort((a, b) => a.text.localeCompare(b.text)),
    },
  ];
}

function fireSections(snap: Snapshot): StaticSection[] {
  const link = linker(snap), least = snap.notable.incomplete ? "At least " : "";
  const reports = snap.notable.items.map((r) => atHighestLevel(withStart(r, snap.histories[r.id]), snap.histories[r.id])) as unknown as (ConditionReport & { layer: string })[];
  const all = fires(reports.filter((r) => r.layer === "WILDFIRE")), season = fireSeason(all);
  const episodes = evacuationEpisodes(reports.filter((r) => r.layer === "EVACUATION"), regionTimeZone);
  const zones = episodes.reduce((n, e) => n + e.orders + e.warnings + e.others, 0);
  return [
    {
      id: "fire-record", title: "Wildfires on record",
      lead: all.length
        ? `${least}${plural(all.length, "wildfire")} in the corridor ${all.length === 1 ? "is" : "are"} on record with Grid, the first from ${datedDay(season.since)}${season.largest ? `; the largest reported is the ${season.largest.name} at ${acresText(season.largest.acres)}` : ""}. This is what Grid has saved from CAL FIRE and FIRIS, not a census of every fire. Read ${datedTime(snap.builtAt)}.`
        : `No wildfire in the corridor is on record with Grid as read ${datedTime(snap.builtAt)}. That is what Grid has saved, not proof that there was none.`,
      ...capped(all.map((f) => ({
        at: f.started, text: f.name, href: link(f.id),
        detail: [acresText(f.acres) === "—" ? "" : acresText(f.acres), f.containment ? `${f.containment}% contained` : "", f.place, Number.isFinite(f.updated) ? `as last reported ${datedTime(f.updated)}` : ""].filter(Boolean).join(" · "),
      })), snap.notable.incomplete, "fires"),
    },
    {
      id: "evacuation-record", title: "Evacuation orders and warnings on record",
      lead: episodes.length
        ? `${least}${plural(zones, "evacuation zone notice")} on record, grouped by county and by the day each took effect or, where the source gave no time, the day Grid first saved it. Each is counted at the highest level it reached. From Cal OES zone data, for reference only: an order or warning in effect now is live data.`
        : `No evacuation order or warning in the corridor is on record with Grid as read ${datedTime(snap.builtAt)}. That is what Grid has saved, not the state of any zone now.`,
      ...capped(episodes.map((e) => ({
        at: e.at, href: link(e.id),
        text: `${e.county} County: ${[e.orders ? plural(e.orders, "order") : "", e.warnings ? plural(e.warnings, "warning") : "", e.others ? plural(e.others, "other notice") : ""].filter(Boolean).join(", ")}`,
        detail: e.zones.length ? `Zones ${e.zones.slice(0, 8).join(", ")}${e.zones.length > 8 ? ` and ${e.zones.length - 8} more` : ""}` : undefined,
      })), snap.notable.incomplete, "notices"),
    },
  ];
}

function powerSections(snap: Snapshot): StaticSection[] {
  const link = linker(snap), past = snap.power.items as unknown as ConditionReport[], least = snap.power.incomplete ? "At least " : "";
  const shutoffs = past.filter(isShutoff).length, total = past.reduce((n, r) => n + customers(r), 0);
  const from = snap.builtAt - snap.power.weeks * 7 * DAY;
  const notable = (snap.notable.items.filter((r) => r.layer === "POWER" && hasEnded(r)).map((r) => withStart(r, snap.histories[r.id])) as unknown as ConditionReport[])
    .filter((r) => startedAt(r) >= from).sort((a, b) => startedAt(b) - startedAt(a));
  const counted = `${least}${plural(past.length, "interruption")} that ${past.length === 1 ? "has" : "have"} ended ${past.length === 1 ? "is" : "are"} on record for the ${snap.power.weeks} weeks before ${datedTime(snap.builtAt)}, ${shutoffs ? `${plural(shutoffs, "of them a safety shutoff", "of them safety shutoffs")}, ` : ""}with ${least.toLowerCase()}${total.toLocaleString("en-US")} customers affected in all (a customer out twice is counted twice). From PG&E's outage data as Grid saved it.`;
  return [{
    id: "power-record", title: "Power interruptions on record",
    summary: counted, lead: `${counted} Listed below are those of that period with a page of their own.`,
    ...capped(notable.map((r) => ({
      at: startedAt(r), text: r.headline.replace(/\.$/, ""), href: link(r.id),
      detail: r.areaLabel || undefined,
    })), snap.notable.incomplete, "interruptions"),
  }];
}

function alertSections(snap: Snapshot): StaticSection[] {
  const link = linker(snap);
  const at = (r: Report) => timed(r, snap.histories[r.id]);
  const alerts = snap.notable.items.filter((r) => r.layer === "WEATHER_ALERT" && hasEnded(r)).sort((a, b) => (at(b) ?? 0) - (at(a) ?? 0));
  return [{
    id: "alert-record", title: "Weather alerts on record",
    lead: `National Weather Service watches, warnings and advisories for the corridor that Grid saved and that have since ended, newest first, as read ${datedTime(snap.builtAt)}. An alert in effect now is live data.`,
    ...capped(alerts.map((r) => ({
      at: at(r), text: reportTitle(r), href: link(r.id),
      // One NWS product is several alerts, one per zone group: where each applies is what tells them apart.
      detail: [Number.isFinite(ms(r.expires)) ? `until ${datedTime(r.expires)}` : "", clip(r.areaLabel || r.weatherAlert?.areaDesc || "", 140)].filter(Boolean).join(" · ") || undefined,
    })), snap.notable.incomplete, "alerts"),
  }];
}

type BurnLine = { id?: string; name?: string; phone?: string };
function burnSections(snap: Snapshot): StaticSection[] {
  return [...snap.burn.events].sort((a, b) => (a.areaLabel || "").localeCompare(b.areaLabel || "")).map((event) => {
    const history = snap.burn.histories[event.id];
    const ordered = [...(history?.revisions ?? [])].sort((a, b) => Number(a.revision) - Number(b.revision));
    // Every recorded call to the county's line, whether it changed the answer or confirmed it.
    const calls = new Map<string, StaticEntry>();
    ordered.forEach((r, i) => {
      for (const call of readingCalls(r, ordered[i - 1]))
        calls.set(`${call.line}|${call.at}`, { at: call.at, text: call.answer, detail: [call.message ? `“${call.message}”` : "", call.line].filter(Boolean).join(" · ") });
    });
    const lines = ((event.burnStatus?.burnLines ?? []) as BurnLine[]).map((l) => [l.name, phone(l.phone)].filter(Boolean).join(": ")).filter(Boolean);
    const b = event.burnStatus;
    const calfire = b?.calfireStatus && Number.isFinite(ms(b.calfireObservedAt)) ? ` CAL FIRE's own status, which burning also depends on, was “${humanize(b.calfireStatus)}” when checked ${datedTime(b.calfireObservedAt)}.` : "";
    const list = capped([...calls.values()].sort((x, y) => (y.at ?? 0) - (x.at ?? 0)), !history?.complete, "calls");
    return {
      id: `burn-${eventSlug(event.id)}`, title: `${event.areaLabel || "County"} burn line: each recorded call`,
      lead: `What the county air district's burn line said each time Grid called it, newest first; each answer is for the day of its call.${lines.length ? ` ${lines.join("; ")}.` : ""}${calfire}`,
      entries: list.entries,
      note: !history ? "The record of calls could not be read when this page was built." : list.entries.length ? list.note : "No call is on record.",
    } satisfies StaticSection;
  });
}

function sourceSections(snap: Snapshot): StaticSection[] {
  const { sources } = snap;
  const feeds = sources.rows.filter((s) => !isOwnService(s));
  // A record is shown when the API keeps one: health events, or revisions of them.
  const kept = sources.health.some((e) => e.layer === "SOURCE_HEALTH") || sources.revisions.some((r) => r.event.layer === "SOURCE_HEALTH");
  const list = recordList(sourceChanges(sources.revisions), SOURCE_ENTRIES, sources.incomplete);
  const period = `the ${sources.days} days before ${datedTime(snap.builtAt)}`;
  const every = (seconds?: number) => (!seconds ? "" : seconds < 3600 ? `read every ${Math.round(seconds / 60)} min` : `read every ${Math.round(seconds / 3600)} h`);
  return [
    {
      id: "source-catalogue", title: "The feeds Grid reads",
      lead: "Every upstream source behind these pages, with how often it is read. Whether each is current now is live data.",
      entries: feeds.map((s) => ({ text: s.name, detail: [s.attribution, every(s.pollIntervalSeconds)].filter(Boolean).join(" · ") || undefined, href: /^https?:\/\//i.test(s.homepageUrl ?? "") ? s.homepageUrl : undefined }))
        .sort((a, b) => a.text.localeCompare(b.text)),
    },
    ...(kept ? [{
      id: "source-record", title: "Status changes on record",
      lead: `Each time a feed went stale or unavailable and came back, as Grid saved it in ${sources.incomplete ? "up to " : ""}${period}, newest first. Whether each feed is current now is live data.`,
      // The reason a feed gave is upstream error text (addresses, stack fragments); it stays on the live page and in the report.
      entries: list.shown.map((e) => ({ at: e.at, text: `${e.label}: ${e.badge.label.toLowerCase()}`, href: deepLink(e.id, e.revision) })),
      note: list.shown.length ? list.note || undefined
        : sources.incomplete ? "No status change in the part of the record that was read. Older entries were not read."
        : `No status change is on record in ${period}. That is what Grid saved, not proof that every feed was current throughout.`,
    } satisfies StaticSection] : []),
  ];
}

function meshSections(snap: Snapshot): StaticSection[] {
  const nodes = snap.mesh.items.filter((r) => r.layer === "MESH");
  return [{
    id: "mesh-roster", title: "Mesh nodes on record",
    lead: `${snap.mesh.incomplete ? "At least " : ""}${plural(nodes.length, "MeshCore node")} located in the corridor had a report with Grid when read ${datedTime(snap.builtAt)}. A name here says a node is known, not that it is being heard: when each was last heard is live data, and Grid knows only what reached it.`,
    entries: nodes.map((r) => ({ text: r.mesh?.name || r.headline, detail: r.mesh?.nodeType ? humanize(r.mesh.nodeType.replace(/^(MESH_)?NODE_TYPE_/, "")) : r.category ? sentence(r.category) : undefined, href: deepLink(r.id) }))
      .sort((a, b) => a.text.localeCompare(b.text)),
  }];
}

function eventsSections(snap: Snapshot): StaticSection[] {
  const at = (r: Report) => timed(r, snap.histories[r.id]);
  const ended = snap.notable.items.filter(hasEnded).sort((a, b) => (at(b) ?? 0) - (at(a) ?? 0));
  const counts = NOTABLE.map(({ layer }) => [layer, ended.filter((r) => r.layer === layer).length] as const).filter(([, n]) => n);
  const words: Record<string, [string, string]> = { WILDFIRE: ["wildfire", "wildfires"], EVACUATION: ["evacuation notice", "evacuation notices"], WEATHER_ALERT: ["weather alert", "weather alerts"], CHAIN_CONTROL: ["chain requirement", "chain requirements"], POWER: ["power interruption", "power interruptions"], ROAD_INCIDENT: ["road incident", "road incidents"] };
  return [{
    id: "events-record", title: "Ended reports with a page of their own",
    lead: `${snap.notable.incomplete ? "At least " : ""}${plural(ended.length, "ended report")} ${ended.length === 1 ? "has" : "have"} a page with its timeline and what changed at each saved revision${counts.length ? `: ${counts.map(([layer, n]) => plural(n, ...words[layer])).join(", ")}` : ""}. Newest first, as read ${datedTime(snap.builtAt)}. Every other report, and anything still in effect, is in the live explorer.`,
    ...capped(ended.map((r) => ({ at: at(r), text: reportTitle(r), detail: [kindOf(r), r.areaLabel].filter(Boolean).join(" · "), href: recordPath(r.id) })), snap.notable.incomplete, "reports"),
  }];
}

const scannerSections = (snap: Snapshot): StaticSection[] => [{
  id: "scanner-catalogue", title: "Scanner feeds",
  lead: "Public-safety radio feeds for the area, each on Broadcastify.",
  entries: snap.scanners.map((s) => ({ text: s.channelLabel || s.agency || "Feed", detail: s.agency && s.agency !== s.channelLabel ? s.agency : undefined, href: /^https?:\/\//i.test(s.broadcastifyUrl ?? "") ? s.broadcastifyUrl : undefined })),
}];

const cameraSections = (snap: Snapshot): StaticSection[] => [{
  id: "camera-catalogue", title: "Road cameras",
  lead: "Caltrans cameras in and near the corridor. Their pictures are live and are not reproduced here.",
  entries: snap.cameras.map((c) => ({ text: c.name || "Camera", detail: [c.route, [c.nearbyPlace, c.county ? `${c.county} County` : ""].filter(Boolean).join(", "), c.elevationFeet ? `${c.elevationFeet.toLocaleString("en-US")} ft` : ""].filter(Boolean).join(" · ") || undefined })),
}];

/** The Overview's record is where each page's record is, with that page's own first sentence. */
function overviewSections(snap: Snapshot, paths: Partial<Record<ViewId, string>>): StaticSection[] {
  const from: [ViewId, StaticSection[]][] = [["roads", roadSections(snap)], ["WILDFIRE", fireSections(snap)], ["POWER", powerSections(snap)], ["WEATHER_ALERT", alertSections(snap)], ["mesh", meshSections(snap)], ["sources", sourceSections(snap)]];
  return [{
    id: "overview-record", title: "What Grid has on record",
    lead: `Grid keeps every version of every report it reads. This is where the record is, as read ${datedTime(snap.builtAt)}; what is happening now is live data.`,
    entries: from.flatMap(([id, sections]) => (sections[0] && paths[id] ? [{ text: sections[0].title, detail: sections[0].summary ?? sections[0].lead, href: paths[id] }] : [])),
  }];
}

/** The record a page shows before any script runs. Empty for a page with none of its own (Search, a route that sends its reader on). */
export function staticSections(view: ViewId, snap: Snapshot, paths: Partial<Record<ViewId, string>> = {}): StaticSection[] {
  switch (view) {
    case "discover": return overviewSections(snap, paths);
    case "events": return eventsSections(snap);
    case "roads": return roadSections(snap);
    case "weather": case "WEATHER_ALERT": return alertSections(snap);
    case "WILDFIRE": return fireSections(snap);
    case "POWER": return powerSections(snap);
    case "BURN_STATUS": return burnSections(snap);
    case "mesh": return meshSections(snap);
    case "sources": return sourceSections(snap);
    case "scanners": return scannerSections(snap);
    case "cameras": return cameraSections(snap);
    default: return [];
  }
}

/** Road entries listed: a storm week alone is some ninety. */
const ROAD_ENTRIES = 100, SOURCE_ENTRIES = 60;
/** The power record reaches this far back, as the Power page's own does. */
export const POWER_WEEKS = 13;
/** The road and source records on a prerendered page: a month, where the live panels show a week and a month. */
export const ROAD_DAYS = 30, SOURCE_DAYS = 30;
export const periodFrom = (builtAt: number, days: number) => Math.floor((builtAt - days * DAY) / 3_600_000) * 3_600_000;
