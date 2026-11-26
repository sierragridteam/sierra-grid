/**
 * What the Grid has on record, read from revisions: when a source went quiet
 * and came back, and when a chain requirement or a road's status changed.
 * Pure: the pages only render what these return, including the words on a
 * badge, what a panel says when its record could not be read, and how far
 * back a list really reaches.
 */
import type { Report, Revision } from "./event-model.ts";
import { regionTimeZone } from "./time.ts";
import { ROAD_CHAINS_ON_RECORD_FROM, beyondLabel, roadChainLevel, severityRankOf, severityTone } from "./road-corridor.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const ms = (value: unknown) => (typeof value === "string" && value ? Date.parse(value) : NaN);
const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, month: "short", day: "numeric" });
const words = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** The design system's badge tones. */
export type BadgeTone = "ok" | "elevated" | "alarm" | "muted";
export type RecordBadge = { label: string; tone: BadgeTone };
export type RecordEntry = {
  at: number; id: string; revision: number; label: string; detail?: string; badge: RecordBadge;
  /** In place of `detail`: the reason is word for word the one given at this time, on a newer entry for the same thing. */
  sameReasonAs?: number;
  /** In place of `detail`: the reason is word for word the one the page already gives above, for the same thing as it is now. */
  reasonAbove?: boolean;
};

// ---- Reading the record -------------------------------------------------

/** How often a record panel is read again: a week or a month of history does not move by the minute. */
export const RECORD_REFRESH_MS = 10 * 60_000;
/** Pages of history a record panel follows before it says the list is incomplete. */
export const RECORD_PAGES = 3;

/**
 * The period a record panel asks for, on whole hours, so the request repeats
 * between refreshes and an unchanged answer costs a 304.
 */
export function recordWindow(now: number, days: number): { from: string; to: string } {
  return { from: new Date(Math.floor((now - days * DAY) / HOUR) * HOUR).toISOString(), to: new Date(Math.ceil(now / HOUR) * HOUR).toISOString() };
}

export type Page<T> = { notModified: true } | { notModified: false; items: T[]; next: string; etag: string | null };
/**
 * A reader for one paged list that is asked again and again. It sends the
 * last answer's ETag with the first page (when the request is the same one)
 * and resolves "unchanged" on a 304: keep what you have. Otherwise it follows
 * `next` up to `cap` pages; `incomplete` is true when the service still had
 * more, and what was read is then a part of which no count is a total.
 *
 * A conditional request that fails is tried once more without the ETag, so a
 * service that refuses the header costs a request and not the panel.
 */
export function pagedReader<T>(cap = RECORD_PAGES) {
  let last = { key: "", etag: "" };
  return async (key: string, read: (pageToken: string, etag?: string) => Promise<Page<T>>): Promise<{ items: T[]; incomplete: boolean } | "unchanged"> => {
    const etag = last.key === key && last.etag ? last.etag : undefined;
    last = { key: "", etag: "" };
    let first: Page<T>;
    try { first = await read("", etag); }
    catch (error) { if (!etag) throw error; first = await read(""); }
    if (first.notModified) {
      if (!etag) throw new Error("Not modified, with nothing to compare against");
      last = { key, etag };
      return "unchanged";
    }
    const items = [...first.items];
    let token = first.next || "";
    for (let page = 1; token && page < cap; page++) {
      const more = await read(token);
      if (more.notModified) throw new Error("Not modified, for a page that was never read");
      items.push(...more.items);
      token = more.next || "";
    }
    last = { key, etag: first.etag ?? "" };
    return { items, incomplete: !!token };
  };
}

/**
 * One read of the record: not answered yet, failed (with what the last good
 * read gave, if any), or answered. "None on record" can only be said of an
 * answer.
 */
export type Read<T> = { state: "loading" } | { state: "failed"; last?: T; asOf?: number } | { state: "ok"; value: T; asOf: number };
export type RevisionPages = { revisions: Revision[]; incomplete: boolean };
/** A read that failed keeps what the last good one gave, marked with when that was. */
export function failedRead<T>(previous: Read<T>): Read<T> {
  return previous.state === "ok" ? { state: "failed", last: previous.value, asOf: previous.asOf }
    : previous.state === "failed" ? previous : { state: "failed" };
}

/** A settled read (from `pagedReader`) as `nextRead` takes it, its pages mapped to the value kept. */
export function settle<T, U>(result: PromiseSettledResult<T | "unchanged">, map: (value: T) => U): { ok: true; value: U | "unchanged" } | { ok: false } {
  return result.status === "fulfilled" ? { ok: true, value: result.value === "unchanged" ? "unchanged" : map(result.value) } : { ok: false };
}
/** The state of a read after it was asked again: a new answer, the same answer (a 304), or a failure. */
export function nextRead<T>(previous: Read<T>, result: { ok: true; value: T | "unchanged" } | { ok: false }, now: number): Read<T> {
  if (!result.ok) return failedRead(previous);
  if (result.value !== "unchanged") return { state: "ok", value: result.value, asOf: now };
  // "Unchanged" is only ever the answer to a read that sent the last good answer's ETag.
  return previous.state === "ok" ? { ...previous, asOf: now } : failedRead(previous);
}

/** The entries a panel shows, and what it must say about the ones it does not. */
export function recordList(entries: RecordEntry[], cap: number, incomplete: boolean): { shown: RecordEntry[]; note: string } {
  const hidden = Math.max(0, entries.length - cap);
  return {
    shown: entries.slice(0, cap),
    // With part of the period unread, a count of what is hidden would pretend to be a total.
    note: incomplete ? "Older entries not loaded: this list is incomplete." : hidden ? `${hidden} earlier ${hidden === 1 ? "entry" : "entries"} in this period not shown.` : "",
  };
}

// ---- Source health ------------------------------------------------------

type SourceHealth = { sourceId?: string; status?: string; since?: string; error?: string };
const health = (report: Report) => report.sourceHealth as SourceHealth | undefined;
/** The Sources page's words for a status, as an entry in the list of changes. */
const statusBadge = (status?: string): RecordBadge =>
  status === "OK" ? { label: "Current again", tone: "ok" }
    : status === "STALE" ? { label: "Stale", tone: "elevated" }
    : status === "UNAVAILABLE" ? { label: "Unavailable", tone: "alarm" }
    // A status this build does not know is shown as sent, and is not called an outage.
    : { label: status && !/UNSPECIFIED|UNKNOWN/.test(status) ? words(status) : "Not read yet", tone: "muted" };

/** The service's own row among the sources ("The Grid"): not an upstream feed, so not counted or listed as one. */
export const isOwnService = (source: { kind?: string | null }) => source.kind === "INTERNAL";

export type SourceHeld = {
  status: string; since: number; eventId: string;
  /**
   * True when the health event has never been revised: `since` is then when
   * Grid began recording the source, not when the status began.
   */
  recordedOnly: boolean;
};
/** Since when each source has been in its current status (or on record), by source id. */
export function sourceSince(events: Report[]): Map<string, SourceHeld> {
  const out = new Map<string, SourceHeld>();
  for (const event of events) {
    const h = health(event);
    if (event.layer === "SOURCE_HEALTH" && h?.sourceId && event.status === "ACTIVE")
      out.set(h.sourceId, { status: h.status ?? "", since: ms(h.since), eventId: event.id, recordedOnly: Number(event.revision) === 1 });
  }
  return out;
}

/**
 * The changes of status in a list of source-health revisions, newest first.
 * Revision 1 is where recording began, not a change, so it is left out; so is
 * a revision whose status is the one before it (the reason changed, not the
 * status). A source that fails the same way again (Caltrans' HTTP 500 three
 * times on 2026-11-18) gives its reason once, on the newest entry; the older
 * ones point at it by its time.
 */
export function sourceChanges(revisions: Revision[]): RecordEntry[] {
  const byEvent = new Map<string, Map<number, Revision>>();
  for (const r of revisions) byEvent.set(r.event.id, (byEvent.get(r.event.id) ?? new Map()).set(Number(r.revision), r));
  return revisions
    .filter((r) => r.event.layer === "SOURCE_HEALTH" && Number(r.revision) > 1 && r.event.status === "ACTIVE")
    .filter((r) => { const before = byEvent.get(r.event.id)?.get(Number(r.revision) - 1); return !before || health(before.event)?.status !== health(r.event)?.status; })
    .map((r) => {
      const h = health(r.event);
      return {
        at: ms(h?.since) || ms(r.observedAt), id: r.event.id, revision: Number(r.revision),
        label: r.event.areaLabel || h?.sourceId || r.event.id,
        detail: h?.error || undefined, badge: statusBadge(h?.status),
      };
    })
    .filter((e) => Number.isFinite(e.at))
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    .map((e, i, all): RecordEntry => {
      const newer = e.detail ? all.slice(0, i).find((x) => x.id === e.id && x.detail === e.detail) : undefined;
      return newer ? { ...e, detail: undefined, sameReasonAs: newer.at } : e;
    });
}

/**
 * The entries with a reason left out where the page already prints it: `shown`
 * is, by record id, the reason given above the list for the thing as it is
 * now (the Sources page's "Needs attention"). An entry for that thing with
 * word for word that reason says so and does not print it again; an entry
 * with another reason, or for another thing, keeps its own.
 */
export function withoutReasonsShownAbove(entries: RecordEntry[], shown: Map<string, string>): RecordEntry[] {
  return entries.map((e) => (e.detail && shown.get(e.id) === e.detail ? { ...e, detail: undefined, reasonAbove: true } : e));
}

export type RecordPanel = {
  kicker: string; entries: RecordEntry[];
  /** Under the list: what is not shown. */
  note?: string;
  /** In place of a list: nothing on record, or the record could not be read. */
  message?: string;
  /** Set when the last read failed and the list is an earlier one. */
  staleAsOf?: number;
};
export type SourceRecord = {
  /** Empty unless the health events were just read: a failed read shows no "since". */
  held: Map<string, SourceHeld>;
  /** No panel while the record is not read yet, and when the API demonstrably keeps none. */
  panel?: RecordPanel;
  /** The footnote's sentence about the record; empty while it is unknown. */
  footnote: string;
};
const SOURCE_CAP = 40;

/**
 * What the Sources page says about the record of status changes, from its two
 * reads (the health events, and their revisions over the period from `from`).
 * Three things are kept apart: the record is not read yet, it could not be
 * read, and it was read (and holds this much).
 */
export function sourceRecord(input: { events: Read<Report[]>; history: Read<RevisionPages>; days: number; from: number }): SourceRecord {
  const { history, days } = input;
  const events = input.events.state === "ok" ? input.events.value.filter((e) => e.layer === "SOURCE_HEALTH") : undefined;
  const held = events ? sourceSince(events) : new Map<string, SourceHeld>();
  const pages = history.state === "ok" ? history.value : history.state === "failed" ? history.last : undefined;
  const revisions = (pages?.revisions ?? []).filter((r) => r.event.layer === "SOURCE_HEALTH");
  const some = !!events?.length || revisions.length > 0;
  const none = !!events && history.state === "ok" && !some && !history.value.incomplete;
  const footnote = some ? "Status changes are kept for upstream feeds from when Grid began recording them, not for devices that report in."
    : none ? "No uptime history is kept." : "";
  if (history.state === "loading" || none) return { held, footnote };
  if (!pages) return { held, footnote, panel: { kicker: `Up to the last ${days} days, as Grid saw them`, entries: [], message: "The record of status changes could not be read right now." } };

  // When recording began: the earliest revision 1. It is known only with every health event in
  // hand and the whole period read; an event whose revision 1 is not here began before the period.
  const firsts = new Map<string, number>(), ids = new Set<string>();
  for (const r of revisions) { ids.add(r.event.id); if (Number(r.revision) === 1) firsts.set(r.event.id, ms(health(r.event)?.since) || ms(r.observedAt)); }
  for (const e of events ?? []) { ids.add(e.id); if (Number(e.revision) === 1) firsts.set(e.id, ms(health(e)?.since)); }
  const earliest = Math.min(...firsts.values());
  const whole = !!events && !pages.incomplete;
  const began = whole && ids.size > 0 && [...ids].every((id) => Number.isFinite(firsts.get(id) ?? NaN)) && earliest >= input.from ? earliest : NaN;
  const span = Number.isFinite(began) ? "began" : whole ? "window" : "unknown";
  const on = Number.isFinite(began) ? dayLabel.format(began) : "";
  const list = recordList(sourceChanges(revisions), SOURCE_CAP, pages.incomplete);
  return { held, footnote, panel: {
    kicker: span === "began" ? `Since recording began on ${on}, as Grid saw them` : span === "window" ? `Last ${days} days, as Grid saw them` : `Up to the last ${days} days, as Grid saw them`,
    entries: list.shown,
    note: list.shown.length ? list.note || undefined : undefined,
    message: list.shown.length ? undefined
      : span === "began" ? `No source changed status since recording began on ${on}.`
      : span === "window" ? `No source changed status in the last ${days} days.`
      : pages.incomplete ? "No status change in the part of the record that was loaded. Older entries not loaded."
      : `No status change is on record in the last ${days} days. When recording began could not be read.`,
    staleAsOf: history.state === "failed" ? history.asOf : undefined,
  } };
}

// ---- Roads --------------------------------------------------------------

type Chain = { level?: string; highway?: string; from?: { place?: string }; to?: { place?: string } };
type RoadBeyond = { name?: string; seasonal?: boolean | null; severity?: string | null; severityRank?: number | null };
type Road = { name?: string; section?: string; status?: string; beyond?: RoadBeyond[]; chains?: { level?: string; eventId?: string }[] };
/**
 * A closure past a road's end coming into effect: "Seasonal closure" only
 * when the record says every one is seasonal, and as loud as the most severe
 * is rated. A record that carries neither is a plain, quiet "Closure".
 */
const beyondBadge = (beyond: RoadBeyond[]): RecordBadge => ({
  label: beyond.length && beyond.every((b) => b.seasonal === true) ? beyondLabel({ seasonal: true }) : "Closure",
  tone: severityTone(Math.max(0, ...beyond.map(severityRankOf))),
});
const shortHighway = (highway?: string) => String(highway ?? "").replace(/^Highway /, "Hwy ");
const extent = (c?: Chain) => (!c?.from?.place ? "" : !c.to?.place || c.to.place.toLowerCase() === c.from.place.toLowerCase() ? c.from.place : `${c.from.place} to ${c.to.place}`);
const chainTone = (level?: string): BadgeTone => (level === "R3" ? "alarm" : "elevated");
const ROAD_WORDS: Record<string, string> = { OPEN: "open", CLOSED: "closed", RESTRICTED: "restricted", MAINTENANCE: "under roadwork" };
const roadWord = (status?: string) => ROAD_WORDS[status ?? ""] ?? "status unknown";
/** A road's state, when what changed is not known. */
const roadStateBadge = (status?: string): RecordBadge =>
  status === "OPEN" ? { label: "Open", tone: "ok" } : status === "CLOSED" ? { label: "Closed", tone: "alarm" }
    : status === "RESTRICTED" ? { label: "Restricted", tone: "elevated" } : status === "MAINTENANCE" ? { label: "Roadwork", tone: "elevated" }
    : { label: "Status unknown", tone: "muted" };
/** A road's change of status: a road that opens has "reopened", which no chain entry says. */
const roadChangeBadge = (status?: string): RecordBadge => (status === "OPEN" ? { label: "Reopened", tone: "ok" } : roadStateBadge(status));

/**
 * The road record from CHAIN_CONTROL and ROAD_SEGMENT revisions, newest
 * first: a requirement posted, changed and lifted; a road closing and
 * reopening, going under chains and coming out; a closure past its end
 * starting and ending.
 *
 * Chains are in it twice, on purpose. The requirement's own entries say the
 * highway and how far it runs ("R2 posted · Hwy 4, Big Trees Park to Mount
 * Reba Road"); the road's say which monitored road is under it, which is
 * news of its own when a stretch grows down onto the next road or shrinks
 * off it with no posting or lifting at all. A road's revision that changes
 * its status and its chains at once is two entries. Chains are on a road's
 * record from `ROAD_CHAINS_ON_RECORD_FROM`; against a revision older than
 * that, a requirement is not said to have started.
 *
 * A chain requirement's event is a slot (one per highway and level): it is
 * ACTIVE while posted, not ACTIVE once lifted, and ACTIVE again in a new
 * revision the next time, so "posted again" is an ordinary entry. A road's
 * first revision is only where recording began and is left out.
 *
 * An entry says what changed only when the revision before it is in the list.
 * Without it the entry says the state at that time ("R2 in effect") and
 * claims no change. A revision that differs from the one before it in
 * nothing shown here (a sign inside the stretch) is not an entry.
 */
export function roadRecord(revisions: Revision[]): RecordEntry[] {
  const byEvent = new Map<string, Map<number, Revision>>();
  for (const r of revisions) byEvent.set(r.event.id, (byEvent.get(r.event.id) ?? new Map()).set(Number(r.revision), r));
  const out: RecordEntry[] = [];
  for (const r of revisions) {
    const n = Number(r.revision), event = r.event, prior = byEvent.get(event.id)?.get(n - 1), previous = prior?.event;
    const base = { id: event.id, revision: n }, seen = ms(r.observedAt) || ms(r.ingestedAt);
    if (event.layer === "CHAIN_CONTROL") {
      const c = event.chainControl as Chain | undefined, was = previous?.chainControl as Chain | undefined;
      const level = c?.level || "Chain control", tone = chainTone(c?.level);
      const where = [shortHighway(c?.highway), extent(c)].filter(Boolean).join(", ");
      // Posted at the source's own time when it gives one for this posting.
      const posted = ms(event.effective) || seen;
      if (event.status !== "ACTIVE") {
        if (!previous || previous.status === "ACTIVE") out.push({ ...base, at: seen, label: `${level} lifted`, detail: where, badge: { label: "Lifted", tone: "ok" } });
      } else if (n === 1) out.push({ ...base, at: posted, label: `${level} posted`, detail: where, badge: { label: "Posted", tone } });
      else if (!previous) out.push({ ...base, at: seen, label: `${level} in effect`, detail: where, badge: { label: "In effect", tone } });
      else if (previous.status !== "ACTIVE") out.push({ ...base, at: ms(event.effective) > ms(previous.effective) ? posted : seen, label: `${level} posted again`, detail: where, badge: { label: "Posted", tone } });
      else if (extent(was) !== extent(c)) out.push({ ...base, at: seen, label: `${level} now ${extent(c) || "without a stated extent"}`, detail: [shortHighway(c?.highway), extent(was) ? `was ${extent(was)}` : ""].filter(Boolean).join(" · "), badge: { label: "Changed", tone } });
    } else if (event.layer === "ROAD_SEGMENT" && n > 1) {
      const road = event.roadSegment as Road | undefined, was = previous?.roadSegment as Road | undefined;
      const name = [road?.name, road?.section].filter(Boolean).join(" ") || "Road";
      const names = (v?: Road) => (v?.beyond ?? []).map((b) => b.name).filter(Boolean).join("; ");
      const level = roadChainLevel(road), before = roadChainLevel(was);
      if (!was) out.push({ ...base, at: seen, label: `${name}: ${roadWord(road?.status)}${level ? `, chains required (${level})` : ""}`, detail: names(road) || undefined,
        badge: level && road?.status === "OPEN" ? { label: `Chains ${level}`, tone: chainTone(level) } : roadStateBadge(road?.status) });
      else if (was.status !== road?.status) out.push({ ...base, at: seen, label: `${name} ${road?.status === "OPEN" ? "reopened" : road?.status === "CLOSED" ? "closed" : `now ${roadWord(road?.status)}`}`, detail: `was ${roadWord(was.status)}`, badge: roadChangeBadge(road?.status) });
      else if (names(was) !== names(road)) out.push({ ...base, at: seen, label: names(road) ? `${names(road)} in effect` : `${names(was)} ended`, detail: name, badge: names(road) ? beyondBadge(road?.beyond ?? []) : { label: "Closure ended", tone: "ok" } });
      // Beside the status, never instead of it: chains do not close a road. A
      // revision from before chains were recorded does not say there were none.
      const chainsKnown = (ms(prior?.ingestedAt) || ms(prior?.observedAt)) >= ROAD_CHAINS_ON_RECORD_FROM;
      if (was && chainsKnown && level !== before) out.push(!level ? { ...base, at: seen, label: `${name}: chains lifted`, detail: `was ${before}`, badge: { label: "Chains lifted", tone: "ok" } }
        : { ...base, at: seen, label: before ? `${name}: chains now ${level}` : `${name}: chains required (${level})`, detail: before ? `was ${before}` : undefined, badge: { label: `Chains ${level}`, tone: chainTone(level) } });
    }
  }
  return out.filter((e) => Number.isFinite(e.at)).sort((a, b) => b.at - a.at || b.revision - a.revision || a.id.localeCompare(b.id));
}

const ROAD_CAP = 30;
/**
 * The Roads page's "On record" panel from the read of the last `days` days
 * (from `from`). No panel until the record is read and while it holds
 * nothing; the list when there is one, marked when it could not be refreshed;
 * a plain statement when it could not be read at all.
 *
 * It claims the whole period only when road status was being recorded before
 * it: when every monitored road's first revision is in the period, it says
 * since when instead.
 */
export function roadRecordPanel(read: Read<RevisionPages>, days: number, from: number): RecordPanel | undefined {
  const pages = read.state === "ok" ? read.value : read.state === "failed" ? read.last : undefined;
  const period = `Chain controls and road status, ${pages?.incomplete || !pages ? "up to the " : ""}last ${days} days`;
  if (!pages) return read.state === "failed" ? { kicker: period, entries: [], message: "The record could not be read right now." } : undefined;
  const staleAsOf = read.state === "failed" ? read.asOf : undefined;
  const roads = pages.revisions.filter((r) => r.event.layer === "ROAD_SEGMENT");
  const firsts = new Map<string, number>();
  for (const r of roads) if (Number(r.revision) === 1) firsts.set(r.event.id, ms(r.observedAt) || ms(r.ingestedAt));
  const earliest = Math.min(...firsts.values());
  const began = !pages.incomplete && roads.length > 0 && roads.every((r) => Number.isFinite(firsts.get(r.event.id) ?? NaN)) && earliest >= from ? earliest : NaN;
  const list = recordList(roadRecord(pages.revisions), ROAD_CAP, pages.incomplete);
  const kicker = `${period}${Number.isFinite(began) ? ` · road status on record since ${dayLabel.format(began)}` : ""}`;
  if (!list.shown.length) return staleAsOf ? { kicker, entries: [], message: "The record could not be read right now.", staleAsOf } : undefined;
  return { kicker, entries: list.shown, note: list.note || undefined, staleAsOf };
}
