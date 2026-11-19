/**
 * The region's roads as corridors: monitored segments chained into routes,
 * points placed along them, closure notices read, work windows grouped into
 * jobs, duplicate signs merged. Pure, so the roads page and tests share it.
 */

export type Position = [number, number];
export type Segment = {
  id: string; headline: string; status: string; description?: string | null;
  durationMinutes?: number | null; delayMinutes?: number | null; congestion?: string | null; distanceKm?: number | null;
  coordinates: Position[];
  /** When the current status began; `statusSinceAtLeast` when it may be older than the record. */
  statusSince?: string | null; statusSinceAtLeast?: boolean | null;
  /** Why the section has its status, when it is not simply open. */
  statusCauses?: { status?: string; source?: string; description?: string; extent?: string }[] | null;
  /** The section's own severity from the source; it does not include what is past its ends. */
  severity?: string | null; severityRank?: number | null;
  /** Named closures in effect past one of the section's ends; they do not change `status`. */
  beyond?: Beyond[] | null;
  /**
   * The chain requirements the source lists on this section; they do not
   * change `status`. An empty list is the source saying there are none; an
   * absent one is the source not knowing (or an API that does not say).
   */
  chains?: RoadChain[] | null;
};
/** One chain requirement on a section, as the API sends it: the whole stretch, whose ends can lie past the section's. */
export type RoadChain = { level: string; eventId?: string; from?: string; to?: string; headline?: string; since?: string | null; inferred?: boolean | null };
/**
 * A closure past a section's end, as the API sends it. `seasonal` is the
 * source's statement that it is a standing condition (absent means it is
 * not); `severity` is the closure's own rating. Nothing here is decided from
 * its name, its reason or the date.
 */
export type Beyond = {
  name?: string; status: string; side: string; reason?: string; from?: string; to?: string; description?: string; headline?: string;
  seasonal?: boolean | null; severity?: string | null; severityRank?: number | null;
};
const SEVERITY_RANK: Record<string, number> = { INFO: 0, MINOR: 1, MODERATE: 2, SEVERE: 3, EXTREME: 4 };
/** The source's rank for a rated thing: its `severityRank`, else its `severity`; unrated is 0, like INFO. */
export const severityRankOf = (x: { severity?: string | null; severityRank?: number | null }) =>
  typeof x.severityRank === "number" && Number.isFinite(x.severityRank) ? x.severityRank : SEVERITY_RANK[x.severity ?? ""] ?? 0;
/** How loud a rated thing is drawn: severe and extreme alarm, moderate is elevated, anything lower is quiet. */
export const severityTone = (rank: number) => (rank >= 3 ? "alarm" as const : rank === 2 ? "elevated" as const : "muted" as const);
export type Chain = {
  route: string;
  /** Places along the route with their distance from the start (km, along the geometry). */
  stops: { at: number; label: string }[];
  sections: { from: number; to: number; segment: Segment }[];
  length: number;
};

/** Great-circle distance in km. */
export function km([lon1, lat1]: Position, [lon2, lat2]: Position) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(a));
}
const lineLength = (line: Position[]) => line.slice(1).reduce((sum, p, i) => sum + km(line[i], p), 0);

/** "Hwy 4 — Arnold to Bear Valley" → route "Hwy 4", from "Arnold", to "Bear Valley". */
export function segmentName(headline: string) {
  const m = /^(.*?)\s+[—–-]\s+(.*?)\s+to\s+(.*)$/.exec(headline);
  return m ? { route: m[1], from: m[2], to: m[3] } : { route: headline, from: "Start", to: "End" };
}

/** Segments grouped by route and chained end to start (A→B, B→C), in source order otherwise. */
export function routeChains(segments: Segment[]): Chain[] {
  const byRoute = new Map<string, Segment[]>();
  for (const s of segments) {
    const { route } = segmentName(s.headline);
    byRoute.set(route, [...(byRoute.get(route) ?? []), s]);
  }
  return [...byRoute].map(([route, list]) => {
    const names = new Map(list.map((s) => [s, segmentName(s.headline)]));
    // Start from the segment whose start is no other segment's end.
    const ordered: Segment[] = [];
    let next = list.find((s) => !list.some((o) => names.get(o)!.to === names.get(s)!.from)) ?? list[0];
    while (next && !ordered.includes(next)) {
      ordered.push(next);
      next = list.find((s) => !ordered.includes(s) && names.get(s)!.from === names.get(next!)!.to)!;
    }
    ordered.push(...list.filter((s) => !ordered.includes(s)));
    let at = 0;
    const sections = ordered.map((segment) => {
      const from = at;
      at += lineLength(segment.coordinates) || segment.distanceKm || 0;
      return { from, to: at, segment };
    });
    const stops = [{ at: 0, label: names.get(ordered[0])!.from }, ...sections.map((s) => ({ at: s.to, label: names.get(s.segment)!.to }))];
    return { route, stops, sections, length: at };
  });
}

/**
 * The straight pieces of a chain's line with where each starts along it (km).
 * Positions are worked out in a local flat projection, fine at corridor
 * scale, and each section's pieces are scaled to fill the section exactly, so
 * the end of a section's line is the section's end on the strip. `alongRoute`
 * and `routeSlice` both walk these: a place found by one is the same place to
 * the other.
 */
function* pieces(chain: Chain) {
  for (const [section, { from, to, segment }] of chain.sections.entries()) {
    const line = segment.coordinates;
    const flat = line.slice(1).map((b, i) => {
      const a = line[i], kx = 111.32 * Math.cos((a[1] * Math.PI) / 180), ky = 110.57;
      return { a, b, kx, ky, bx: (b[0] - a[0]) * kx, by: (b[1] - a[1]) * ky };
    });
    const total = flat.reduce((sum, p) => sum + Math.hypot(p.bx, p.by), 0);
    const scale = total ? (to - from) / total : 1;
    let start = from;
    for (const [i, p] of flat.entries()) {
      // The last piece ends on the section's end exactly, not a rounding error short of it.
      const end = i === flat.length - 1 ? to : start + Math.hypot(p.bx, p.by) * scale;
      yield { section, ...p, start, end, len: end - start };
      start = end;
    }
  }
}

/**
 * Where a point falls along a chain: distance from the start (km) and how far
 * off the line it is.
 */
export function alongRoute(chain: Chain, point: Position) {
  let best = { at: 0, off: Infinity };
  for (const { a, kx, ky, bx, by, start, end, len } of pieces(chain)) {
    const px = (point[0] - a[0]) * kx, py = (point[1] - a[1]) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const off = Math.hypot(px - t * bx, py - t * by);
    if (off < best.off) best = { at: t === 1 ? end : start + t * len, off };
  }
  return best;
}

/**
 * The route's own line between two distances along it (km, as `alongRoute`
 * gives them): one line per section crossed, cut where the distances fall
 * inside a piece. It is the monitored geometry and nothing else: a section
 * without a line contributes nothing, and no line joins two sections.
 */
export function routeSlice(chain: Chain, from: number, to: number): Position[][] {
  const lines = new Map<number, Position[]>();
  for (const { section, a, b, start, end, len } of pieces(chain)) {
    const lo = Math.max(from, start), hi = Math.min(to, end);
    if (len <= 0 || hi <= lo) continue;
    const at = (d: number): Position => { const t = (d - start) / len; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    const line = lines.get(section) ?? [at(lo)];
    line.push(at(hi));
    lines.set(section, line);
  }
  return [...lines.values()];
}

/**
 * Caltrans closure text, e.g. "Is closed from 0.5 mi east of the Jct of SR 207
 * /Mt Reba Turnoff/ to the Jct of SR 89 /Ebbetts Pass/ (Alpine Co) - Due to
 * snow - …": the named places (between slashes) and the reason.
 */
export function closureNotice(text?: string | null) {
  if (!text || !/closed/i.test(text)) return undefined;
  const span = /closed from (.*?) to (.*?)(?: - |$)/i.exec(text);
  const named = (part?: string) => (part ? /\/([^/]+)\//.exec(part)?.[1]?.trim() : undefined);
  const reason = /due to ([^-.]+)/i.exec(text)?.[1]?.trim().toLowerCase();
  return { from: named(span?.[1]), to: named(span?.[2]), reason };
}

export type WorkWindow = { id: string; headline: string; area: string; status: string; start: number; end: number; work?: string; closureType?: string; lanes?: string; route?: string };
/** Windows of the same work (same headline at the same place) as one job, earliest first. */
export function workJobs(windows: WorkWindow[]) {
  const jobs = new Map<string, { key: string; headline: string; area: string; windows: WorkWindow[] }>();
  for (const w of windows) {
    const key = `${w.headline}|${w.area}`;
    const job = jobs.get(key) ?? { key, headline: w.headline, area: w.area, windows: [] };
    job.windows.push(w);
    jobs.set(key, job);
  }
  for (const job of jobs.values()) job.windows.sort((a, b) => a.start - b.start);
  return [...jobs.values()].sort((a, b) => a.windows[0].start - b.windows[0].start);
}

export type Sign = { id: string; location: string; route?: string; direction?: string; pages: string[][]; inService: boolean; since?: number; coordinates?: Position };
/** Signs showing the same message on the same route and direction read as one; blanks are counted, not shown. */
export function signBoard(signs: Sign[]) {
  const text = (s: Sign) => s.pages.map((p) => p.filter((l) => l.trim()).join(" ")).filter(Boolean).join(" / ");
  const showing = new Map<string, Sign & { count: number }>();
  const blank: Sign[] = [];
  for (const s of signs) {
    if (!s.inService || !text(s)) { blank.push(s); continue; }
    const key = `${s.route}|${s.direction}|${text(s)}`;
    const seen = showing.get(key);
    if (seen) seen.count++;
    else showing.set(key, { ...s, count: 1 });
  }
  return { showing: [...showing.values()], blank, text };
}

/** "Hwy 4 one-way traffic control (Drainage Work)" at "Hwy 4 at Horeshoe Drive (Right), near Hathaway Pines" → Hwy 4 / One-way traffic control · drainage work / Horeshoe Drive, near Hathaway Pines. */
export function workName(headline: string, area: string) {
  const m = /^(Hwy \d+)\s+(.*?)(?:\s*\(([^)]+)\))?$/.exec(headline);
  const route = m?.[1] ?? "Other roads";
  const what = m ? `${m[2][0].toUpperCase()}${m[2].slice(1)}${m[3] ? ` · ${m[3].toLowerCase()}` : ""}` : headline;
  const where = area.replace(/^Hwy \d+\s+(at|from)\s+/i, "").replace(/\s*\((Left|Right)\)/g, "");
  return { route, what, where };
}

/**
 * Closures in effect past a route's ends: the route is open as far as its
 * last stop and closed beyond it. Each carries what the source says of it:
 * whether it is seasonal (a standing condition), its severity, its name and
 * headline. `toward` is where the closure runs to, when the source names it.
 * The most severe come first.
 */
export function beyondClosures(c: Chain) {
  const named = (part?: string) => (part ? (/\/([^/]+)\//.exec(part)?.[1] ?? part).trim() : undefined);
  const at = (side: "END" | "START") => {
    const section = side === "END" ? c.sections.at(-1) : c.sections[0];
    const stop = side === "END" ? c.stops.at(-1) : c.stops[0];
    return (section?.segment.beyond ?? []).filter((b) => b.status === "CLOSED" && (b.side || "END") === side).map((b) => {
      const rank = severityRankOf(b);
      return {
        side, route: c.route, name: b.name || "Closure", headline: b.headline || undefined, reason: b.reason?.toLowerCase() || undefined, last: stop?.label ?? "", description: b.description || undefined,
        toward: named(side === "END" ? b.to : b.from),
        /** Only the source's own `true` makes it seasonal; a response without the field is not. */
        seasonal: b.seasonal === true, rank, tone: severityTone(rank),
      };
    });
  };
  return [...at("END"), ...at("START")].sort((a, b) => b.rank - a.rank);
}
export type BeyondClosure = ReturnType<typeof beyondClosures>[number];
/** The closure's name and where it is: "<name> past Bear Valley". */
export const beyondText = (b: BeyondClosure) => `${b.name} ${b.side === "END" ? "past" : "before"} ${b.last}`;
/** The closure in one line: the source's headline when it gives one. */
export const beyondHeadline = (b: BeyondClosure) => b.headline ?? `${b.route}: ${beyondText(b)}`;
/** The class of closure, from the source's flag: the label is for the class, never for one closure. */
export const beyondLabel = (b: { seasonal?: boolean | null }) => (b.seasonal === true ? "Seasonal closure" : "Closed");

export type ChainSign = { id: string; place: string; direction?: string; level: string; since: number; coordinates?: Position };
/**
 * One feature of the chain-control layer that is not a closure point. The
 * source groups its signs: a requirement is one stretch of highway at one
 * level, with its ends named and every Caltrans sign listed in `signs`. A
 * truck or hold restriction is a single point with no level and no signs.
 */
export type ChainControl = {
  id: string; level: string; highway: string; direction?: string; place: string; since: number; description?: string; coordinates: Position;
  /** The ends of the stretch as the source names them. */
  from?: string; to?: string; signs?: ChainSign[];
  /** The extent was put together from nearby signs; nothing reports the road between them. */
  inferred?: boolean;
};
const titleCase = (text: string) => text.toLowerCase().replace(/(^|[\s./(])([a-z])/g, (_, a, b) => a + b.toUpperCase());
const shortRoute = (highway: string) => highway.replace(/^Highway /, "Hwy ");
const levelRank = (level: string) => Number(/\d/.exec(level)?.[0] ?? 0);

/**
 * The checkpoints of a control as places: the two directions at one place are
 * one entry, keeping the strictest level. A control without signs is its own
 * single checkpoint.
 */
export function chainCheckpoints(control: ChainControl) {
  const signs: ChainSign[] = control.signs?.length ? control.signs
    : [{ id: control.id, place: control.place, direction: control.direction, level: control.level, since: control.since, coordinates: control.coordinates }];
  const groups = new Map<string, ChainSign[]>();
  for (const sign of signs) { const key = sign.place.toUpperCase(); groups.set(key, [...(groups.get(key) ?? []), sign]); }
  return [...groups.values()].map((group) => {
    const top = group.reduce((a, c) => (levelRank(c.level) > levelRank(a.level) ? c : a));
    const directions = [...new Set(group.map((c) => c.direction).filter(Boolean))] as string[];
    return {
      id: top.id, control: control.id, level: top.level, highway: shortRoute(control.highway), place: titleCase(top.place),
      directions: directions.length > 1 ? "Both directions" : directions[0] ?? "", since: Math.min(...group.map((c) => c.since).filter(Number.isFinite)),
      coordinates: group.find((c) => c.coordinates)?.coordinates,
    };
  });
}
export type ChainCheckpoint = ReturnType<typeof chainCheckpoints>[number];

/** "Poison Springs to Mount Reba Road", or the one place when the stretch has a single end. */
export function chainExtent(control: ChainControl) {
  const from = control.from || titleCase(control.place), to = control.to || from;
  return { from, to, single: from === to, text: from === to ? `at ${from}` : `from ${from} to ${to}` };
}

/** A checkpoint off the route counts as past one of its ends when the nearest point of the route is this close to that end (km). */
const END_KM = 0.5;
/**
 * Chain control on a monitored route: the source's stretches that touch it,
 * in order along it. A stretch belongs to the route when any of its signs is
 * near the route, not only its low end, so one that begins before the
 * monitored sections still counts. Restrictions without a level (truck or
 * hold) are not chain requirements and are left out.
 *
 * Each stretch has its extent on the route (`from` to `to`, km): from its
 * first to its last checkpoint there, clamped to the route. A checkpoint that
 * lies past an end of the route means the stretch runs on through that end,
 * so the extent reaches it.
 */
export function chainStretch(c: Chain, controls: ChainControl[], nearKm = 8) {
  const clamp = (at: number) => Math.max(0, Math.min(c.length, at));
  const stretches = controls.filter((x) => x.level && shortRoute(x.highway) === c.route).flatMap((control) => {
    const checkpoints = chainCheckpoints(control).flatMap((p) => (p.coordinates ? [{ ...p, ...alongRoute(c, p.coordinates) }] : []));
    const on = checkpoints.filter((p) => p.off <= nearKm).sort((a, b) => a.at - b.at);
    if (!on.length) return [];
    const past = checkpoints.filter((p) => p.off > nearKm);
    const from = past.some((p) => p.at <= END_KM) ? 0 : clamp(on[0].at);
    const to = past.some((p) => p.at >= c.length - END_KM) ? c.length : clamp(on.at(-1)!.at);
    return [{ control, level: control.level, extent: chainExtent(control), at: on[0].at, from, to, checkpoints: on, since: control.since, inferred: !!control.inferred }];
  }).sort((a, b) => a.at - b.at);
  if (!stretches.length) return undefined;
  const levels = [...new Set(stretches.map((x) => x.level))].sort();
  const parts = stretches.map((x) => `${x.extent.text} (${x.level})`);
  return {
    route: c.route, stretches, levels, at: stretches[0].at, since: Math.min(...stretches.map((x) => x.since).filter(Number.isFinite)),
    /** "Hwy 4 from Poison Springs to Mount Reba Road (R2)". */
    where: `${c.route} ${listOf(parts)}`,
    text: `Chains required on ${c.route} ${listOf(parts)}`,
  };
}
export type RouteChains = NonNullable<ReturnType<typeof chainStretch>>;

/**
 * How far the chain-control layer can be trusted: read now, held from the
 * last good read (the request failed, or the source says it is behind), or
 * not known at all. Only `current` supports saying there are no chains.
 */
export type ChainRead = "current" | "last-known" | "unknown";
export const chainRead = (r: { failed: boolean; stale: boolean; held: number }): ChainRead =>
  r.failed ? (r.held ? "last-known" : "unknown") : r.stale ? "last-known" : "current";

/** A stretch counts as on a section when this much of it lies there (km): a checkpoint that sits at a joint does not mark the section before it. */
const TOUCH_KM = 0.1;
/**
 * The stretches under chain control as extents to draw along a route's
 * strip. A requirement at a single checkpoint has no length and gives none:
 * it stays a marker. The label carries the level, and says so when the layer
 * is not current.
 */
export function chainBands(route: RouteChains | undefined, read: ChainRead = "current") {
  return (route?.stretches ?? []).filter((x) => x.to - x.from > TOUCH_KM).map((x) => ({
    id: x.control.id, from: x.from, to: x.to, level: x.level,
    /** "Chains R2". */
    label: `Chains ${x.level}${read === "current" ? "" : " · last read"}`,
    /** "Mill Creek to Mount Reba Road": the source's ends, which may lie past the route's. */
    where: x.extent.single ? x.extent.from : `${x.extent.from} to ${x.extent.to}`,
    inferred: x.inferred,
  }));
}
export type ChainBand = ReturnType<typeof chainBands>[number];

/**
 * What chain control adds to one section of a route, or nothing when no
 * stretch is on it. The section's status is not changed: an open road under
 * chain control is open. `label` goes in the section's short text ("chains
 * R2"), `text` in its sentence ("chains required (R2) from Mill Creek to
 * Mount Reba Road").
 *
 * Which stretch is on which section is the source's to say: the section's
 * own `chains` list is used when it has one, and an empty list is none even
 * when a checkpoint stands a little way into the section. Only when the
 * source does not say is it read from where the stretches lie on the route.
 */
export function sectionChains(c: Chain, index: number, route: RouteChains | undefined) {
  const section = c.sections[index];
  if (!section) return undefined;
  const listed = section.segment.chains;
  const on = Array.isArray(listed) ? listedChains(listed, route) : stretchesOn(c, index, route).map((x) => ({ level: x.level, extent: x.extent.text }));
  if (!on.length) return undefined;
  const levels = [...new Set(on.map((x) => x.level))].sort();
  return { levels, label: `chains ${levels.join(", ")}`, text: `chains required ${listOf(on.map((x) => `(${x.level}) ${x.extent}`))}` };
}
/** The source's list for a section, in order along the route where the stretches are placed on it. */
function listedChains(listed: RoadChain[], route: RouteChains | undefined) {
  const at = (x: RoadChain) => route?.stretches.find((s) => s.control.id === x.eventId)?.at ?? Infinity;
  const extent = (x: RoadChain) => { const from = x.from || x.to, to = x.to || x.from; return !from ? "here" : from === to ? `at ${from}` : `from ${from} to ${to}`; };
  return listed.filter((x) => x.level).map((x, i) => ({ x, i, at: at(x) })).sort((a, b) => a.at - b.at || a.i - b.i)
    .map(({ x }) => ({ level: x.level, id: x.eventId, extent: extent(x) }));
}
/** The stretches lying on a section, from their extents on the route. */
function stretchesOn(c: Chain, index: number, route: RouteChains | undefined) {
  const section = c.sections[index], last = index === c.sections.length - 1;
  return (route?.stretches ?? []).filter((x) => (x.to - x.from > TOUCH_KM
    ? Math.min(x.to, section.to) - Math.max(x.from, section.from) > TOUCH_KM
    // A single checkpoint is on the section it stands in; one at a joint is on the section it begins.
    : x.from >= section.from && (x.from < section.to || (last && x.from <= section.to))));
}

/**
 * Chain control in a route's one-line summary: the stretches on it, or what
 * is not known. The stretches come from the chain-control layer; when that
 * could not be read, the requirements the sections themselves list are named
 * instead. Nothing is returned only when there is no stretch and that is
 * known: the layer is current, or every section says it has none.
 */
export function routeChainNote(c: Chain, route: RouteChains | undefined, read: ChainRead = "current") {
  if (route) return `chains ${listOf(route.stretches.map((x) => `${x.level} ${x.extent.text}`))}${read === "current" ? "" : " when last read"}`;
  const listed = new Map(c.sections.flatMap((x) => (Array.isArray(x.segment.chains) ? listedChains(x.segment.chains, undefined) : [])).map((x) => [x.id ?? `${x.level} ${x.extent}`, x]));
  if (listed.size) return `chains ${listOf([...listed.values()].map((x) => `${x.level} ${x.extent}`))}`;
  if (read === "current" || c.sections.every((x) => Array.isArray(x.segment.chains))) return undefined;
  return read === "unknown" ? "chain control unavailable" : "chain control not current";
}
const listOf = (items: string[]) => (items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

export type RoadsAnswer = { title: string; lines: string[]; tone: "alarm" | "elevated" | "ok" };
/**
 * The Roads page's title and the lines under it. The title is what is rated
 * above INFO, most severe first: a closure on a monitored section, a closure
 * past a route's end, then a restriction, chain control, or that all is open.
 * A closure past a route's end leads only by its own severity; one the source
 * rates INFO (a seasonal closure is) is a line under the title instead.
 */
export function roadsAnswer(chains: Chain[], s: { segments: Segment[]; controls: ChainControl[]; activeWork: number }): RoadsAnswer {
  const lines: string[] = [];
  const beyond = chains.flatMap(beyondClosures).sort((a, b) => b.rank - a.rank);
  const closures = [
    ...s.segments.filter((x) => x.status === "CLOSED").map((x) => {
      const name = segmentName(x.headline), notice = closureNotice(x.description);
      const where = notice?.from ? `past ${notice.from}` : `${name.from} to ${name.to}`;
      // A closed monitored section is an alarm whatever the source rates the section.
      return { text: `${name.route} closed ${where}${notice?.reason ? ` — ${notice.reason}` : ""}`, rank: Math.max(3, severityRankOf(x)) };
    }),
    ...beyond.filter((b) => b.rank > 0).map((b) => ({ text: beyondHeadline(b), rank: b.rank })),
  ].sort((a, b) => b.rank - a.rank);
  const standing = beyond.filter((b) => b.rank <= 0).map(beyondHeadline);
  for (const c of chains) {
    // The open stretch from the start of the route, as one phrase.
    const openRun = [];
    for (const sec of c.sections) { if (sec.segment.status !== "OPEN") break; openRun.push(sec); }
    if (openRun.length === c.sections.length) lines.push(`${c.route} open ${c.stops[0].label} to ${c.stops.at(-1)!.label}`);
    else if (openRun.length) lines.push(`${c.route} open ${c.stops[0].label} to ${c.stops[openRun.length].label}`);
  }
  const chained = chains.flatMap((c) => chainStretch(c, s.controls)?.text ?? []).join("; ") || undefined;
  if (chained) lines.unshift(chained);
  const restricted = s.segments.filter((x) => x.status === "RESTRICTED").map((x) => `${x.headline} restricted`);
  if (s.activeWork) lines.push(`${s.activeWork} work zone${s.activeWork === 1 ? "" : "s"} active`);
  const answer = (): RoadsAnswer => {
    if (closures.length) return { title: closures.map((x) => x.text).join("; "), lines: [...restricted, ...lines], tone: closures[0].rank >= 3 ? "alarm" : "elevated" };
    if (restricted.length) return { title: restricted.join("; "), lines, tone: "elevated" };
    if (chained) return { title: chained, lines: lines.filter((l) => l !== chained && !/ open /.test(l)), tone: "elevated" };
    if (!s.segments.length) return { title: "Route status unavailable", lines: lines.filter((l) => !/ open /.test(l)), tone: "ok" };
    // "Open" is only said of sections the source reports open; any other status (maintenance, unspecified) is named.
    const other = s.segments.filter((x) => x.status !== "OPEN");
    if (other.length) return { title: other.map((x) => `${x.headline}: ${x.status.toLowerCase().replaceAll("_", " ")}`).join("; "), lines, tone: "elevated" };
    return { title: "All monitored routes are open", lines: lines.filter((l) => !/ open /.test(l)), tone: "ok" };
  };
  const a = answer();
  return { ...a, lines: [...a.lines, ...standing] };
}
