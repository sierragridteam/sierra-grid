/**
 * Roads: the answer first (what is closed, what is open), then the routes as
 * corridor strips, a large map, and a dashboard of work, reports, signs and,
 * low down, cameras.
 */
import type { Context } from "../context";
import { pageHero } from "../hero";
import { data } from "../context";
import { fmt, httpUrl } from "../render";
import { stateUrl } from "../state";
import { regionTimeZone } from "../time";
import { ageText } from "../mesh-fleet";
import {
  alongRoute, beyondClosures, beyondText, chainPlaces, chainStretch, closureNotice, routeChains, segmentName, signBoard, workJobs, workName,
  type Chain, type ChainControl, type Position, type Segment, type Sign, type WorkWindow,
} from "../road-corridor";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { html, nothing } from "@sierragridteam/design-system/lib/template";
import { badge, card, corridor, feedItem, messageSign, schedule, stat, type CorridorMarker, type StateTone } from "@sierragridteam/design-system/lib/ui";
import { createGeoMap, type SierraGeoMap } from "@sierragridteam/design-system/lib/geo-map";

const HOUR = 3_600_000, DAY = 24 * HOUR, REFRESH_MS = 120_000;
/** A point counts as on a route within this distance of its line (km). */
const ON_ROUTE_KM = 1;
/** Closure points sit at the end of what the source closes; allow more room. */
const CLOSURE_NEAR_KM = 8;

type Layer = Extract<Awaited<ReturnType<Context["client"]["getMapLayer"]>>, { notModified: false }>["data"];
type EventList = Extract<Awaited<ReturnType<Context["client"]["listEvents"]>>, { notModified: false }>["data"];
type RoadEvent = EventList["events"][number];
type Cameras = Extract<Awaited<ReturnType<Context["client"]["listCameras"]>>, { notModified: false }>["data"];
type Closure = { id: string; headline: string; highway?: string; direction?: string; description?: string; coordinates: Position };

type State = {
  segments: Segment[]; closures: Closure[]; chains: ChainControl[]; signs: Sign[]; events: RoadEvent[]; cameras?: Cameras;
  chp?: { status: string; lastSuccessAt?: string | null };
  loaded: boolean; errors: string[]; stale: string[]; updatedAt: number; now: number;
};

const ms = (v?: string | null) => (v ? Date.parse(v) : NaN);
const isChp = (e: RoadEvent) => /chp|highway patrol/i.test(`${e.provenance.sourceId} ${e.provenance.sourceName}`);
const pointOf = (g: any): Position | undefined => (g?.type === "Point" ? (g.coordinates as Position) : undefined);
/** Events carry encoded GeoJSON plus a centroid; the centroid is enough to place a report. */
const eventPoint = (e: RoadEvent): Position | undefined => {
  const c = (e.geometry as any)?.centroid;
  return c && Number.isFinite(c.lng) && Number.isFinite(c.lat) ? [c.lng, c.lat] : undefined;
};
const toneVar = (tone: StateTone | "lake" | "glacier") => (tone === "lake" || tone === "glacier" ? `var(--chart-${tone})` : `var(--state-${tone})`);
const segmentTone = (s: Segment): StateTone => (s.status === "CLOSED" ? "alarm" : s.status === "RESTRICTED" || (s.congestion && s.congestion !== "CLEAR") || (s.delayMinutes ?? 0) > 0 ? "elevated" : s.status === "OPEN" ? "ok" : "muted");
/** "since Nov 12, 12:40 PT", or "since before …" when the status is older than the record of it. */
const sinceText = (s: Segment, bare = false) => {
  const t = ms(s.statusSince);
  if (!Number.isFinite(t)) return undefined;
  return `${bare ? "" : `${s.status === "OPEN" ? "open " : ""}since `}${s.statusSinceAtLeast ? "before " : ""}${fmt(t)}`;
};
const minutes = (m?: number | null) => (m === null || m === undefined ? "—" : `${Math.round(m)} min`);

function windows(events: RoadEvent[]): WorkWindow[] {
  return events.flatMap((e) => {
    const c = e.roadIncident?.closure as any;
    if (!c) return [];
    const start = ms(c.plannedStart ?? e.effective), end = ms(c.plannedEnd ?? e.expires);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    return [{ id: e.id, headline: e.headline, area: e.areaLabel, status: e.status, start, end, work: c.workType, closureType: c.closureType, lanes: c.lanesClosed, route: c.route }];
  });
}

export async function mount(ctx: Context) {
  const { client, state, $, signal } = ctx;
  const recordUrl = (id: string) => stateUrl({ ...state, topic: "events", layer: "ROAD_INCIDENT", record: id, revision: "", compare: "", autoSelect: true, timeExplicit: false } as any);
  const eventsUrl = stateUrl({ ...state, topic: "events", layer: "ROAD_INCIDENT", record: "", timeExplicit: false } as any);
  const store = createStore<State>({ segments: [], closures: [], chains: [], signs: [], events: [], loaded: false, errors: [], stale: [], updatedAt: 0, now: Date.now() });

  async function load() {
    const [segments, closures, signs, events, cameras, sources] = await Promise.allSettled([
      data(client.getMapLayer(state.place, "road_segment")),
      data(client.getMapLayer(state.place, "chain_control")),
      data(client.getMapLayer(state.place, "message_sign")),
      data(client.listEvents({ place: state.place, layer: ["ROAD_INCIDENT"], pageSize: 100 })),
      data(client.listCameras({ place: state.place })),
      data(client.listSources()),
    ]);
    if (signal.aborted) return;
    const value = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : undefined);
    const seg = value(segments) as Layer | undefined, cc = value(closures) as Layer | undefined, ms_ = value(signs) as Layer | undefined;
    const errors = [
      !seg && "route status", !cc && "chain controls and closure points", !ms_ && "highway signs", events.status === "rejected" && "road reports", cameras.status === "rejected" && "cameras",
    ].filter(Boolean) as string[];
    const chp = value(sources)?.sources.find((s) => /chp|highway patrol/i.test(`${s.id} ${s.name}`));
    // A layer can arrive while its source is stale: say so rather than present old data as current.
    const stale = [
      ...[["route status", seg], ["chain controls and closure points", cc], ["highway signs", ms_]].flatMap(([name, layer]) => { const st = (layer as Layer | undefined)?.metadata?.sourceStatus; return st && st !== "OK" ? [`${name} (${String(st).toLowerCase()})`] : []; }),
      ...(value(sources)?.sources ?? []).filter((x) => ["caltrans", "chp"].includes(x.id) && x.status !== "OK").map((x) => `${x.name} (${x.status.toLowerCase()})`),
    ];
    const prev = store.get();
    store.set({
      segments: seg ? seg.features.filter((f) => f.geometry?.type === "LineString").map((f) => {
        const p = f.properties as any;
        return { id: p.id, headline: p.headline, status: p.status, description: p.description, coordinates: (f.geometry as any).coordinates, ...p.road };
      }) : prev.segments,
      closures: cc ? cc.features.flatMap((f) => {
        const at = pointOf(f.geometry), p = f.properties as any;
        return at && (p.category === "closed" || p.status === "CLOSED") ? [{ id: p.id, headline: p.headline, highway: String(p.chainControl?.highway ?? "").replace(/^Highway /, "Hwy "), direction: p.chainControl?.direction, description: p.description || p.summary, coordinates: at }] : [];
      }) : prev.closures,
      chains: cc ? cc.features.flatMap((f) => {
        const at = pointOf(f.geometry), p = f.properties as any;
        // Everything in this layer that is not a closure point is a chain requirement in effect.
        return at && p.category !== "closed" && p.status !== "CLOSED" ? [{ id: p.id, level: p.chainControl?.level || String(p.category ?? "").toUpperCase(), highway: p.chainControl?.highway ?? "", direction: p.chainControl?.direction, place: p.areaLabel || p.headline, since: ms(p.effective), description: p.description, coordinates: at }] : [];
      }) : prev.chains,
      signs: ms_ ? ms_.features.map((f) => {
        const p = f.properties as any, s = p.messageSign ?? {};
        return { id: p.id, location: p.areaLabel || p.headline, route: s.route, direction: s.direction, pages: s.pages ?? [], inService: s.inService !== false, since: ms(p.effective), coordinates: pointOf(f.geometry) };
      }) : prev.signs,
      events: value(events)?.events ?? prev.events,
      cameras: value(cameras) ?? prev.cameras,
      chp: chp ? { status: chp.status, lastSuccessAt: chp.lastSuccessAt } : prev.chp,
      loaded: true, errors, stale: [...new Set(stale)], updatedAt: seg ? Date.now() : prev.updatedAt, now: Date.now(),
    });
  }

  $("content").innerHTML = `<div id="roads-page"></div>`;
  let map: SierraGeoMap | undefined;

  region($("roads-page"), store, (s) => {
    const chains = routeChains(s.segments);
    const work = windows(s.events);
    const active = s.events.filter((e) => e.status === "ACTIVE");
    const activeWork = work.filter((w) => w.status === "ACTIVE");
    const chpActive = active.filter(isChp);
    const horizon = s.now + 7 * DAY;
    const jobs = workJobs(work.filter((w) => w.end > s.now - 12 * HOUR && w.start < horizon));
    const upcoming = work.filter((w) => w.status !== "ACTIVE" && w.start > s.now && w.start < horizon);
    const board = signBoard(s.signs);
    const closed = s.segments.filter((x) => x.status === "CLOSED");
    const open = s.segments.filter((x) => x.status === "OPEN");
    const delay = s.segments.reduce((sum, x) => sum + (x.delayMinutes ?? 0), 0);
    const answer = headline(chains, s);
    // A strip can run past its route (a closed stub beyond the last stop), so the shared scale comes from the strips.
    const strips = chains.map((c) => strip(c, s, work, recordUrl));
    const chainAt = chainPlaces(s.chains);
    const stretches = chains.flatMap((c) => chainStretch(c, chainAt) ?? []);
    const chainsUnknown = s.errors.includes("chain controls and closure points") && !s.chains.length && !s.closures.length;
    const reportsUnknown = s.errors.includes("road reports") && !s.events.length;
    const past = chains.flatMap((c) => beyondClosures(c).map((b) => beyondText(c.route, b)));
    return html`
      ${pageHero({ kicker: "Roads & travel · Caltrans and CHP", title: s.loaded ? answer.title : "Checking the roads…", titleClass: "roads-answer", alarm: answer.tone === "alarm", lines: answer.lines })}
      ${s.errors.length ? html`<p class="callout">Not available right now: ${s.errors.join(", ")}. What depends on them is shown as unknown or as last read.</p>` : nothing}
      ${s.stale.length ? html`<p class="callout">The source is behind for: ${s.stale.join(", ")}. Treat those parts as last known, not current.</p>` : nothing}
      <div class="stats stats--compact roads-kpis">
        ${stat({ label: "Routes open", value: s.segments.length ? `${open.length} of ${s.segments.length}` : "—", sub: closed.length ? `closure notice: ${closed.map((x) => { const n = segmentName(x.headline); return `${n.route} ${n.from}–${n.to}`; }).join(", ")}` : past.length ? past.join("; ") : "monitored sections" })}
        ${stat({ label: "Chain controls", value: chainsUnknown ? "—" : s.segments.length || chainAt.length ? (stretches.length ? [...new Set(stretches.flatMap((x) => x.levels))].sort().join(", ") : "None") : "—",
          sub: stretches.length ? stretches.map((x) => `${x.route} ${x.from.place === x.to.place ? `at ${x.from.place}` : `${x.from.place} to ${x.to.place}`}${Number.isFinite(x.since) ? ` · since ${fmt(x.since)}` : ""}`).join("; ") : chainsUnknown ? "chain control status is unavailable" : chainAt.length ? `none on monitored routes · ${chainAt.map((p) => p.highway).filter((h, i, a) => a.indexOf(h) === i).join(", ")} nearby` : "no chain requirements" })}
        ${stat({ label: "Delay on routes", value: s.segments.length ? minutes(delay) : "—", sub: delay ? "reported across monitored sections" : "traffic is moving freely" })}
        ${stat({ label: "Work zones now", value: reportsUnknown ? "—" : String(activeWork.length), sub: reportsUnknown ? "road reports are unavailable" : activeWork.length ? `lane closures on ${[...new Set(activeWork.map((w) => /^(Hwy \d+)/.exec(w.headline)?.[1] ?? "the corridor"))].join(" and ")}` : "no lane closures in place" })}
        ${stat({ label: "Planned work · 7 days", value: String(jobs.filter((j) => j.windows.some((w) => w.status !== "ACTIVE")).length), sub: upcoming.length ? `${upcoming.length} windows · next ${fmt(Math.min(...upcoming.map((w) => w.start)))}` : "nothing scheduled" })}
        ${stat({ label: "CHP incidents", value: String(chpActive.length), href: eventsUrl, actionLabel: "Browse road reports", sub: s.chp ? `feed ${s.chp.status.toLowerCase()}${s.chp.lastSuccessAt ? ` · checked ${ageText(Math.max(0, s.now - ms(s.chp.lastSuccessAt)))} ago` : ""}` : "live traffic incidents" })}
      </div>
      ${card({ variant: "panel", title: "Routes", kicker: "Monitored sections, to scale", as: "section", class: "roads-corridors" },
        chains.length ? html`<div class="roads-strips">${strips.map((p) => corridor({ ...p, length: Math.max(...strips.map((x) => x.length)) }))}</div>` : html`<p class="meta">${s.loaded ? "No monitored routes returned." : "Loading routes…"}</p>`)}
      <section class="roads-map-section" aria-label="Road map">
        <ul class="roads-legend" aria-label="Map key">
          <li><span class="roads-key roads-key--line" style="--key: var(--state-ok)"></span>Open</li>
          <li><span class="roads-key roads-key--line" style="--key: var(--state-elevated)"></span>Delays or restrictions</li>
          <li><span class="roads-key roads-key--line" style="--key: var(--state-alarm)"></span>Closure notice</li>
          <li><span class="roads-key roads-key--dot" style="--key: var(--state-elevated)"></span>Work zone</li>
          <li><span class="roads-key roads-key--dot" style="--key: var(--chart-glacier)"></span>Chain control</li>
          <li><span class="roads-key roads-key--dot" style="--key: var(--chart-lake)"></span>Highway sign</li>
          <li><span class="roads-key roads-key--dot" style="--key: var(--state-muted)"></span>Planned work · camera</li>
        </ul>
        <div id="roads-map"></div>
      </section>
      <div class="dashboard roads-dashboard">
        ${card({ variant: "panel", title: "Work schedule", kicker: "Lane closures, next 7 days", as: "section", class: "roads-schedule" },
          jobs.length ? schedule({ label: "Planned and active road work, next 7 days", from: s.now - 12 * HOUR, to: horizon, now: s.now, timeZone: regionTimeZone,
            rows: scheduleRows(jobs, chains, s.now, recordUrl) })
            : html`<p class="meta">${s.loaded ? "No lane closures planned in the next 7 days." : "Loading work…"}</p>`)}
        ${card({ variant: "panel", title: "Reports now", kicker: `${active.length} active`, as: "section", class: "roads-reports" },
          html`${active.length ? html`<div class="feed roads-feed">${active.map((e) => feedItem({
              title: e.headline, href: recordUrl(e.id), level: 3, place: e.areaLabel,
              severity: { tone: e.severity === "SEVERE" || e.severity === "EXTREME" ? "alarm" : e.severity === "MODERATE" ? "elevated" : "muted", label: isChp(e) ? "Incident" : "Work zone" },
              when: (e.roadIncident?.closure as any)?.plannedEnd ? `Until ${fmt((e.roadIncident!.closure as any).plannedEnd)}` : `Since ${fmt(e.effective || e.observedAt)}`,
              source: e.provenance.sourceName,
            }))}</div>` : html`<p class="meta">${!s.loaded ? "Loading reports…" : reportsUnknown ? "Road reports are unavailable right now." : "No active road reports."}</p>`}
          ${s.loaded && !chpActive.length ? html`<p class="meta roads-chp-none">${reportsUnknown || (s.chp && s.chp.status !== "OK") || !s.chp ? "CHP traffic incidents could not be checked right now." : "No CHP traffic incidents in the region right now."}</p>` : nothing}`)}
        ${card({ variant: "panel", title: "Highway signs", kicker: `${board.showing.reduce((n, x) => n + x.count, 0)} of ${s.signs.length} showing a message`, as: "section", class: "roads-signs" },
          html`${board.showing.length ? html`<div class="roads-sign-grid">${board.showing.map((x) => messageSign({ location: x.location, route: x.route, direction: x.direction, pages: x.pages, inService: x.inService,
              detail: [x.count > 1 ? `${x.count} signs show this` : "", Number.isFinite(x.since) ? `since ${fmt(x.since)}` : ""].filter(Boolean).join(" · ") }))}</div>` : html`<p class="meta">${s.loaded ? "No sign is showing a message." : "Loading signs…"}</p>`}
          ${board.blank.length ? html`<p class="meta">Blank: ${board.blank.map((x) => [x.location, x.inService ? "" : "(not in service)"].filter(Boolean).join(" ")).join(" · ")}</p>` : nothing}`)}
        ${cameraPanel(s)}
      </div>
      <p class="meta roads-footnote" data-page-updated>Route status, travel times, closure points, signs and lane closures from Caltrans; traffic incidents from CHP. Section status is attached by the source to the whole section; a closure notice may cover only part of it. Updated ${s.updatedAt ? fmt(s.updatedAt) : "—"}, refreshing every 2 minutes.</p>`;
  }, { signal });

  // The map is built once and updated in place; the selection is kept by feature id.
  let lastKey = "", selectedId: string | undefined;
  store.subscribe((s) => {
    const host = document.getElementById("roads-map");
    if (!host || !s.loaded) return;
    const fc = mapFeatures(s);
    const key = JSON.stringify(fc.features.map((f) => f.properties));
    if (!map) {
      map = createGeoMap({ label: "Monitored routes with their status, work zones, closure points, highway signs and cameras", data: fc, basemap: true, large: true, fitFocus: true, labels: "selected", featureList: false,
        card: (f) => mapCard(store.get(), f.properties ?? {}, recordUrl) });
      host.replaceChildren(map);
      map.addEventListener("feature-select", (e) => { selectedId = (e as CustomEvent).detail.feature.properties?.id; }, { signal });
      map.addEventListener("feature-clear", () => { selectedId = undefined; }, { signal });
    } else if (key !== lastKey) {
      map.data = fc;
      const index = selectedId ? fc.features.findIndex((f) => f.properties.id === selectedId) : -1;
      map.selected = index >= 0 ? index : undefined;
      if (index < 0) selectedId = undefined;
    }
    lastKey = key;
  }, { signal });

  await load();
  // Left during the first load: start nothing that would outlive the page.
  if (signal.aborted) return;
  const refresh = setInterval(() => void load(), REFRESH_MS);
  const tick = setInterval(() => store.set({ now: Date.now() }), 30_000);
  signal.addEventListener("abort", () => { clearInterval(refresh); clearInterval(tick); });
}

/**
 * Jobs grouped by highway (the corridor's routes first, in strip order), each
 * row named by the work and its place: the route is the group heading, so it
 * is not repeated on every row.
 */
function scheduleRows(jobs: ReturnType<typeof workJobs>, chains: Chain[], now: number, recordUrl: (id: string) => string) {
  const order = chains.map((c) => c.route);
  const rank = (route: string) => (order.includes(route) ? order.indexOf(route) : 100 + (Number(/\d+/.exec(route)?.[0]) || 0));
  return jobs.map((j) => {
    const name = workName(j.headline, j.area);
    const current = j.windows.find((w) => w.status === "ACTIVE") ?? j.windows.find((w) => w.end > now) ?? j.windows[0];
    return {
      group: name.route, label: name.what, detail: name.where, href: recordUrl(current.id),
      bars: j.windows.map((w) => ({
        start: w.start, end: w.end, tone: "elevated" as const, planned: w.status !== "ACTIVE",
        label: [w.closureType, w.work].filter(Boolean).join(" · "), detail: w.status === "ACTIVE" ? "In place now" : "Planned", href: recordUrl(w.id),
      })),
    };
  }).sort((a, b) => rank(a.group) - rank(b.group));
}

/** The page's headline: closures first, then what is open, then work. */
function headline(chains: Chain[], s: State) {
  const lines: string[] = [];
  const closures = s.segments.filter((x) => x.status === "CLOSED").map((x) => {
    const name = segmentName(x.headline), notice = closureNotice(x.description);
    const where = notice?.from ? `past ${notice.from}` : `${name.from} to ${name.to}`;
    return `${name.route} closed ${where}${notice?.reason ? ` — ${notice.reason}` : ""}`;
  });
  for (const c of chains) {
    // The open stretch from the start of the route, as one phrase.
    const openRun = [];
    for (const sec of c.sections) { if (sec.segment.status !== "OPEN") break; openRun.push(sec); }
    if (openRun.length === c.sections.length) lines.push(`${c.route} open ${c.stops[0].label} to ${c.stops.at(-1)!.label}`);
    else if (openRun.length) lines.push(`${c.route} open ${c.stops[0].label} to ${c.stops[openRun.length].label}`);
  }
  // A seasonal closure past a route's end leads too: the route is open, but not through.
  for (const c of chains) for (const b of beyondClosures(c)) closures.push(beyondText(c.route, b));
  const chained = chains.flatMap((c) => chainStretch(c, chainPlaces(s.chains))?.text ?? []).join("; ") || undefined;
  if (chained) lines.unshift(chained);
  const restricted = s.segments.filter((x) => x.status === "RESTRICTED").map((x) => `${x.headline} restricted`);
  const activeWork = s.events.filter((e) => e.status === "ACTIVE" && e.roadIncident?.closure).length;
  if (activeWork) lines.push(`${activeWork} work zone${activeWork === 1 ? "" : "s"} active`);
  if (closures.length) return { title: closures.join("; "), lines: [...restricted, ...lines], tone: "alarm" as const };
  if (restricted.length) return { title: restricted.join("; "), lines, tone: "elevated" as const };
  if (chained) return { title: chained, lines: lines.filter((l) => l !== chained && !/ open /.test(l)), tone: "elevated" as const };
  if (!s.segments.length) return { title: "Route status unavailable", lines: lines.filter((l) => !/ open /.test(l)), tone: "ok" as const };
  // "Open" is only said of sections the source reports open; any other status (maintenance, unspecified) is named.
  const other = s.segments.filter((x) => x.status !== "OPEN");
  if (other.length) return { title: other.map((x) => `${x.headline}: ${x.status.toLowerCase().replaceAll("_", " ")}`).join("; "), lines, tone: "elevated" as const };
  return { title: "All monitored routes are open", lines: lines.filter((l) => !/ open /.test(l)), tone: "ok" as const };
}

/** A chain as a corridor strip, with what sits on it. */
function strip(c: Chain, s: State, work: WorkWindow[], recordUrl: (id: string) => string) {
  const markers: CorridorMarker[] = [];
  const place = (point: Position | undefined, near = ON_ROUTE_KM) => {
    if (!point) return undefined;
    const p = alongRoute(c, point);
    return p.off <= near ? Math.min(c.length, p.at) : undefined;
  };
  // A closure point that names its highway belongs to that route only (a Hwy 207 gate sits beside Hwy 4).
  for (const closure of s.closures.filter((x) => !x.highway || x.highway === c.route)) {
    const at = place(closure.coordinates, CLOSURE_NEAR_KM);
    if (at !== undefined) markers.push({ at, kind: "closure", tone: "alarm", label: [closure.headline, closure.direction].filter(Boolean).join(" · "), detail: closure.description });
  }
  // One marker where chain control begins on the way up; its card lists every checkpoint.
  const chained = chainStretch(c, chainPlaces(s.chains), CLOSURE_NEAR_KM);
  if (chained) markers.push({ at: Math.min(c.length, chained.from.at), kind: "chain", label: `${chained.levels.join(", ")} chain control${chained.from.place === chained.to.place ? ` at ${chained.from.place}` : ` from ${chained.from.place} to ${chained.to.place}`}`,
    detail: chained.places.map((p) => `${p.place}${p.directions ? ` (${p.directions.toLowerCase()})` : ""}${Number.isFinite(p.since) ? ` since ${fmt(p.since)}` : ""}`).join(" · ") });
  const now = s.now;
  // Work that is in place now, or starts within a day: one marker per job.
  const seen = new Set<string>();
  for (const w of [...work].sort((a, b) => (a.status === "ACTIVE" ? -1 : 0) - (b.status === "ACTIVE" ? -1 : 0) || a.start - b.start)) {
    if (w.end < now || w.start > now + DAY || seen.has(w.headline + w.area)) continue;
    const e = s.events.find((x) => x.id === w.id);
    const at = place(e && eventPoint(e));
    if (at === undefined) continue;
    seen.add(w.headline + w.area);
    const live = w.status === "ACTIVE";
    markers.push({ at, kind: "work", tone: live ? "elevated" : "muted", label: w.headline, detail: `${w.area} · ${live ? `in place until ${fmt(w.end)}` : `starts ${fmt(w.start)}`}`, href: recordUrl(w.id), linkLabel: "Report" });
  }
  for (const e of s.events.filter((x) => x.status === "ACTIVE" && isChp(x))) {
    const at = place(eventPoint(e));
    if (at !== undefined) markers.push({ at, kind: "incident", tone: "alarm", label: e.headline, detail: e.areaLabel, href: recordUrl(e.id), linkLabel: "Report" });
  }
  const board = signBoard(s.signs);
  for (const sign of s.signs) {
    const text = board.text(sign);
    const at = text && sign.inService ? place(sign.coordinates) : undefined;
    // A sign warns about somewhere else, so it never takes a closure's colour; its card shows the face.
    if (at !== undefined) markers.push({ at, kind: "sign", label: sign.location, detail: [sign.route, sign.direction].filter(Boolean).join(" "),
      card: messageSign({ location: "", pages: sign.pages, inService: sign.inService, detail: Number.isFinite(sign.since) ? `Showing since ${fmt(sign.since)}` : undefined }) });
  }
  const closed = c.sections.find((x) => x.segment.status === "CLOSED");
  const notice = closureNotice(closed?.segment.description);
  // A closure past the last stop is drawn as a closed stub beyond it. Its length is nominal: the source gives no distance.
  const beyond = beyondClosures(c).find((b) => b.side === "END");
  const stub = beyond ? Math.max(4, c.length * 0.14) : 0;
  const allOpen = c.sections.every((x) => x.segment.status === "OPEN");
  const base = strip0();
  return beyond ? {
    ...base,
    summary: allOpen ? `Open to ${beyond.last} · closed past it${beyond.reason ? ` · ${beyond.reason}` : ""}` : base.summary,
    summaryTone: "alarm" as StateTone,
    length: c.length + stub,
    stops: [...c.stops, { at: c.length + stub, label: beyond.toward ?? "Closed" }],
    sections: [...base.sections, { from: c.length, to: c.length + stub, tone: "alarm" as StateTone, partial: true, label: `Closed${beyond.reason ? ` · ${beyond.reason}` : ""}`, detail: `${beyond.name}. ${beyond.description ?? ""} Not to scale.`.trim() }],
  } : base;
  function strip0() {
  return {
    name: c.route,
    summary: closed ? `Closed${notice?.from ? ` past ${notice.from}` : ""}${notice?.reason ? ` · ${notice.reason}` : ""}` : c.sections.every((x) => x.segment.status === "OPEN") ? `Open · ${minutes(c.sections.reduce((n, x) => n + (x.segment.durationMinutes ?? 0), 0))} end to end` : undefined,
    summaryTone: (closed ? "alarm" : "ok") as StateTone,
    length: c.length,
    stops: c.stops,
    sections: c.sections.map(({ from, to, segment }) => {
      const tone = segmentTone(segment), n = closureNotice(segment.description);
      return {
        from, to, tone,
        // The source attaches a closure to the whole section; hatch it so the strip does not claim all of it is shut.
        partial: segment.status === "CLOSED",
        label: segment.status === "CLOSED" ? `Closure notice${n?.reason ? ` · ${n.reason}` : ""}` : `${segment.status === "OPEN" ? "Open" : segment.status.toLowerCase()} · ${minutes(segment.durationMinutes)}${(segment.delayMinutes ?? 0) > 0 ? ` +${segment.delayMinutes}` : ""}`,
        detail: [segment.description || segment.statusCauses?.[0]?.description || `${segment.headline}: ${minutes(segment.durationMinutes)} for ${segment.distanceKm ?? "—"} km`, sinceText(segment)].filter(Boolean).join(" · "),
      };
    }),
    markers,
  };
  }
}

function mapFeatures(s: State) {
  const features: { type: "Feature"; geometry: any; properties: Record<string, unknown> }[] = [];
  for (const seg of s.segments) {
    const tone = segmentTone(seg);
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: seg.coordinates }, properties: {
      id: `segment:${seg.id}`, kind: "segment", ref: seg.id, label: seg.headline, focus: true,
      tone: tone === "ok" ? "pine" : tone === "elevated" ? "ochre" : tone === "alarm" ? "alarm" : "muted", weight: 4, opacity: 0.9, z: 2,
    } });
  }
  for (const c of s.closures)
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: c.coordinates }, properties: { id: `closure:${c.id}`, kind: "closure", ref: c.id, label: c.headline, tone: "alarm", radius: 7, pulse: true, z: 6 } });
  for (const p of chainPlaces(s.chains))
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: p.coordinates }, properties: { id: `chain:${p.id}`, kind: "chain", ref: p.id, label: `${p.level} chain control · ${p.place}`, tone: "glacier", radius: 5, z: 5 } });
  // Work: everything active, and the next window of each upcoming job within 7 days.
  const seen = new Set<string>();
  for (const e of [...s.events].sort((a, b) => (a.status === "ACTIVE" ? -1 : 1) - (b.status === "ACTIVE" ? -1 : 1) || ms(a.effective) - ms(b.effective))) {
    const at = eventPoint(e);
    const key = e.headline + e.areaLabel;
    if (!at || seen.has(key)) continue;
    seen.add(key);
    const live = e.status === "ACTIVE";
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: { id: `event:${e.id}`, kind: "event", ref: e.id, label: e.headline, tone: live ? (isChp(e) ? "alarm" : "ochre") : "muted", radius: live ? 7 : 5, pulse: live, z: live ? 5 : 3 } });
  }
  const board = signBoard(s.signs);
  for (const sign of s.signs) {
    if (!sign.coordinates) continue;
    const showing = !!board.text(sign) && sign.inService;
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: sign.coordinates }, properties: { id: `sign:${sign.id}`, kind: "sign", ref: sign.id, label: sign.location, tone: showing ? "lake" : "muted", radius: showing ? 5 : 3, opacity: showing ? 1 : 0.6, z: 4 } });
  }
  for (const cam of s.cameras?.cameras ?? []) {
    const loc = (cam as any).location;
    if (!loc) continue;
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [loc.lng, loc.lat] }, properties: { id: `camera:${cam.id ?? cam.name}`, kind: "camera", ref: cam.id ?? cam.name, label: cam.name, tone: "muted", radius: 4, opacity: 0.8, z: 1 } });
  }
  return { type: "FeatureCollection" as const, features };
}

function mapCard(s: State, p: Record<string, any>, recordUrl: (id: string) => string) {
  const facts = (items: [string, unknown][]) => html`<dl class="roads-card__facts">${items.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
  const status = (tone: StateTone | "lake" | "glacier", text: string) => html`<p class="roads-card__status"><span class="roads-dot" style=${`--key: ${toneVar(tone)}`}></span>${text}</p>`;
  if (p.kind === "segment") {
    const seg = s.segments.find((x) => x.id === p.ref);
    if (!seg) return nothing;
    const tone = segmentTone(seg);
    return html`<div class="roads-card"><p class="roads-card__title">${seg.headline}</p>
      ${status(tone, seg.status === "CLOSED" ? "Closure notice" : seg.status === "OPEN" ? (tone === "elevated" ? "Open · slow" : "Open") : seg.status.toLowerCase())}
      ${facts([[seg.status === "OPEN" ? "Open since" : "Since", sinceText(seg, true)], ["Travel time", minutes(seg.durationMinutes)], ["Delay", minutes(seg.delayMinutes)], ["Distance", seg.distanceKm ? `${seg.distanceKm} km` : undefined], ["Traffic", seg.congestion ? seg.congestion.toLowerCase() : undefined]])}
      ${seg.description ? html`<p class="roads-card__text">${seg.description}</p>` : nothing}
      ${(seg.statusCauses ?? []).filter((c) => c.description && c.description !== seg.description).map((c) => html`<p class="roads-card__text">${c.description}${c.extent && c.extent !== "UNKNOWN" ? ` (${c.extent.toLowerCase().replaceAll("_", " ")})` : ""}</p>`)}
      ${(seg.beyond ?? []).filter((b) => b.status === "CLOSED").map((b) => html`<p class="roads-card__text"><strong>${b.name || "Closed"} past this section.</strong> ${b.description ?? ""}</p>`)}</div>`;
  }
  if (p.kind === "closure") {
    const c = s.closures.find((x) => x.id === p.ref);
    if (!c) return nothing;
    return html`<div class="roads-card"><p class="roads-card__title">${c.headline[0].toUpperCase() + c.headline.slice(1)}</p>${status("alarm", ["Closure point", c.direction].filter(Boolean).join(" · "))}
      ${c.description ? html`<p class="roads-card__text">${c.description}</p>` : html`<p class="meta">Caltrans marks a closure here; the closed stretch runs from this point.</p>`}</div>`;
  }
  if (p.kind === "chain") {
    const c = chainPlaces(s.chains).find((x) => x.id === p.ref);
    if (!c) return nothing;
    return html`<div class="roads-card"><p class="roads-card__title">${c.level} chain control · ${c.place}</p>${status("glacier", [c.highway, c.directions].filter(Boolean).join(" · "))}
      ${c.description ? html`<p class="roads-card__text">${c.description}</p>` : nothing}${Number.isFinite(c.since) ? html`<p class="meta">Since ${fmt(c.since)}</p>` : nothing}</div>`;
  }
  if (p.kind === "event") {
    const e = s.events.find((x) => x.id === p.ref);
    if (!e) return nothing;
    const c = e.roadIncident?.closure as any;
    const live = e.status === "ACTIVE";
    return html`<div class="roads-card"><p class="roads-card__title">${e.headline}</p>
      ${status(live ? (isChp(e) ? "alarm" : "elevated") : "muted", live ? (isChp(e) ? "Incident" : "Work zone in place") : "Planned work")}
      <p class="roads-card__text">${e.areaLabel}</p>
      ${c ? facts([["Window", `${fmt(c.plannedStart)} – ${fmt(c.plannedEnd)}`], ["Lanes", c.lanesClosed && c.totalLanes ? `${c.lanesClosed} of ${c.totalLanes}` : c.lanesClosed], ["Type", c.closureType], ["Delay", c.estimatedDelayMinutes ? `${c.estimatedDelayMinutes} min` : undefined]]) : facts([["Since", fmt(e.effective || e.observedAt)], ["Source", e.provenance.sourceName]])}
      <p class="roads-card__more"><a href=${recordUrl(e.id)}>Report →</a></p></div>`;
  }
  if (p.kind === "sign") {
    const sign = s.signs.find((x) => x.id === p.ref);
    if (!sign) return nothing;
    const text = signBoard([sign]).text(sign);
    return html`<div class="roads-card"><p class="roads-card__title">${sign.location}</p>${status(text ? "lake" : "muted", [sign.route, sign.direction].filter(Boolean).join(" ") || "Highway sign")}
      <p class="roads-card__sign">${text || (sign.inService ? "Blank" : "Not in service")}</p>${Number.isFinite(sign.since) && text ? html`<p class="meta">Showing since ${fmt(sign.since)}</p>` : nothing}</div>`;
  }
  if (p.kind === "camera") {
    const cam = s.cameras?.cameras.find((x) => (x.id ?? x.name) === p.ref);
    if (!cam) return nothing;
    return html`<div class="roads-card"><p class="roads-card__title">${cam.name}</p>${status("muted", [cam.route, cam.direction].filter(Boolean).join(" · ") || "Camera")}
      ${httpUrl(cam.imageUrl) ? html`<a href=${httpUrl(cam.imageUrl)} target="_blank" rel="noopener"><img class="roads-card__image" src=${httpUrl(cam.imageUrl)} alt=${`Camera view: ${cam.name}`} loading="lazy" /></a>` : nothing}</div>`;
  }
  return nothing;
}

/** Cameras: proof we have them, low on the page and quiet. */
function cameraPanel(s: State) {
  const cams = s.cameras?.cameras ?? [];
  return card({ variant: "panel", title: "Cameras nearby", kicker: `${cams.length} views · none on Hwy 4`.replace(cams.some((c) => c.route === "SR-4") ? " · none on Hwy 4" : "", ""), as: "section", class: "roads-cameras" },
    cams.length
      ? html`<ul class="roads-camera-strip">${cams.map((c) => html`<li>
          ${httpUrl(c.imageUrl) ? html`<a href=${httpUrl(c.imageUrl)} target="_blank" rel="noopener"><img src=${httpUrl(c.imageUrl)} alt=${`Camera view: ${c.name}`} loading="lazy" /></a>` : html`<span class="roads-camera-empty">No image</span>`}
          <span class="roads-camera-name">${c.route ? html`${badge(c.route, { dot: false })} ` : nothing}${c.name}</span>
          <span class="meta">${c.distanceMeters ? `${(c.distanceMeters / 1000).toFixed(0)} km from the corridor` : "on the corridor"}</span>
        </li>`)}</ul><p class="meta"><a href="/cameras/">All camera views →</a></p>`
      : html`<p class="meta">${s.loaded ? "No cameras returned nearby." : "Loading cameras…"}</p>`);
}
