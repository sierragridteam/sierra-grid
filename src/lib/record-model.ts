/**
 * What the Grid has on record, read from revisions: when a source went quiet
 * and came back, and when a chain requirement or a road's status changed.
 * Pure: the pages only render what these return.
 */
import type { Report, Revision } from "./event-model.ts";

const ms = (value: unknown) => (typeof value === "string" && value ? Date.parse(value) : NaN);
export type RecordTone = "ok" | "elevated" | "alarm" | "muted";
export type RecordEntry = { at: number; id: string; revision: number; label: string; detail?: string; tone: RecordTone };

type SourceHealth = { sourceId?: string; status?: string; since?: string; error?: string };
const health = (report: Report) => report.sourceHealth as SourceHealth | undefined;
const statusWord = (status?: string) => ({ OK: "current", STALE: "stale", UNAVAILABLE: "unavailable" } as Record<string, string>)[status ?? ""] ?? "not read yet";
const statusTone = (status?: string): RecordTone => (status === "OK" ? "ok" : status === "STALE" ? "elevated" : status === "UNAVAILABLE" ? "alarm" : "muted");

/** Since when each source has been in its current status, by source id. */
export function sourceSince(events: Report[]): Map<string, { status: string; since: number; eventId: string }> {
  const out = new Map<string, { status: string; since: number; eventId: string }>();
  for (const event of events) {
    const h = health(event);
    if (event.layer === "SOURCE_HEALTH" && h?.sourceId && event.status === "ACTIVE") out.set(h.sourceId, { status: h.status ?? "", since: ms(h.since), eventId: event.id });
  }
  return out;
}

/**
 * The changes of status in a list of source-health revisions, newest first.
 * Revision 1 is where recording began, not a change, so it is left out.
 */
export function sourceChanges(revisions: Revision[]): RecordEntry[] {
  return revisions
    .filter((r) => r.event.layer === "SOURCE_HEALTH" && Number(r.revision) > 1 && r.event.status === "ACTIVE")
    .map((r) => {
      const h = health(r.event);
      const name = r.event.areaLabel || h?.sourceId || r.event.id;
      return {
        at: ms(h?.since) || ms(r.observedAt), id: r.event.id, revision: Number(r.revision),
        label: h?.status === "OK" ? `${name} is readable again` : `${name} went ${statusWord(h?.status)}`,
        detail: h?.error || undefined, tone: statusTone(h?.status),
      };
    })
    .filter((e) => Number.isFinite(e.at))
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

type Chain = { level?: string; highway?: string; from?: { place?: string }; to?: { place?: string } };
type Road = { name?: string; section?: string; status?: string; congestion?: string; beyond?: { name?: string }[] };
const shortHighway = (highway?: string) => String(highway ?? "").replace(/^Highway /, "Hwy ");
const extent = (c?: Chain) => (!c?.from?.place ? "" : !c.to?.place || c.to.place.toLowerCase() === c.from.place.toLowerCase() ? c.from.place : `${c.from.place} to ${c.to.place}`);
const chainTone = (level?: string): RecordTone => (level === "R3" ? "alarm" : level ? "elevated" : "muted");
const roadWord = (status?: string) => ({ OPEN: "open", CLOSED: "closed", RESTRICTED: "restricted", MAINTENANCE: "under roadwork" } as Record<string, string>)[status ?? ""] ?? "status unknown";
const roadTone = (status?: string): RecordTone => (status === "CLOSED" ? "alarm" : status === "OPEN" ? "ok" : "elevated");
const traffic = (v?: string) => (v ? v.toLowerCase() : "");

/**
 * The road record from CHAIN_CONTROL and ROAD_SEGMENT revisions, newest
 * first: a requirement posted, extended and lifted; a road closing and
 * reopening.
 *
 * A chain requirement's first revision is when it was posted (the source's
 * own time). A road's first revision is only where recording began and is
 * left out. A road revision is described by what differs from the revision
 * before it when that one is in the list, and by its state otherwise.
 */
export function roadRecord(revisions: Revision[]): RecordEntry[] {
  const byEvent = new Map<string, Map<number, Revision>>();
  for (const r of revisions) byEvent.set(r.event.id, (byEvent.get(r.event.id) ?? new Map()).set(Number(r.revision), r));
  const out: RecordEntry[] = [];
  for (const r of revisions) {
    const n = Number(r.revision), event = r.event, previous = byEvent.get(event.id)?.get(n - 1)?.event;
    const base = { id: event.id, revision: n };
    if (event.layer === "CHAIN_CONTROL") {
      const c = event.chainControl as Chain | undefined, where = [shortHighway(c?.highway), extent(c)].filter(Boolean).join(", ");
      const was = previous?.chainControl as Chain | undefined;
      if (event.status !== "ACTIVE") out.push({ ...base, at: ms(r.observedAt), label: `${c?.level} lifted`, detail: where, tone: "ok" });
      else if (n === 1) out.push({ ...base, at: ms(event.effective) || ms(r.observedAt), label: `${c?.level} posted`, detail: where, tone: chainTone(c?.level) });
      else if (previous && previous.status !== "ACTIVE") out.push({ ...base, at: ms(r.observedAt), label: `${c?.level} posted again`, detail: where, tone: chainTone(c?.level) });
      else if (!was || extent(was) !== extent(c)) out.push({ ...base, at: ms(r.observedAt), label: `${c?.level} now ${extent(c) || "changed"}`, detail: [shortHighway(c?.highway), was ? `was ${extent(was)}` : ""].filter(Boolean).join(" · "), tone: chainTone(c?.level) });
      // Otherwise only a sign inside the stretch changed: not a line in the record.
    } else if (event.layer === "ROAD_SEGMENT" && n > 1) {
      const road = event.roadSegment as Road | undefined, was = previous?.roadSegment as Road | undefined;
      const name = [road?.name, road?.section].filter(Boolean).join(" ");
      const names = (v?: Road) => (v?.beyond ?? []).map((b) => b.name).filter(Boolean).join("; ");
      if (!was) out.push({ ...base, at: ms(r.observedAt), label: `${name}: ${roadWord(road?.status)}`, detail: traffic(road?.congestion) ? `traffic ${traffic(road?.congestion)}` : undefined, tone: roadTone(road?.status) });
      else if (was.status !== road?.status) out.push({ ...base, at: ms(r.observedAt), label: `${name} ${road?.status === "OPEN" ? "reopened" : roadWord(road?.status)}`, detail: `was ${roadWord(was.status)}`, tone: roadTone(road?.status) });
      else if (names(was) !== names(road)) out.push({ ...base, at: ms(r.observedAt), label: names(road) ? `${names(road)} in effect` : `${names(was)} lifted`, detail: name, tone: names(road) ? "elevated" : "ok" });
      else if (was.congestion !== road?.congestion) out.push({ ...base, at: ms(r.observedAt), label: `${name}: traffic ${traffic(road?.congestion) || "unknown"}`, detail: was.congestion ? `was ${traffic(was.congestion)}` : undefined, tone: "muted" });
    }
  }
  return out.filter((e) => Number.isFinite(e.at)).sort((a, b) => b.at - a.at || b.revision - a.revision || a.id.localeCompare(b.id));
}
