/**
 * Wildfires and Power: live when something is active (the answer, a map, the
 * reports), and the season's record when nothing is. Evacuations belong to
 * the wildfire page: they lead it when in effect.
 */
import type { Context } from "../context";
import { pageHero } from "../hero";
import { data } from "../context";
import { stateUrl } from "../state";
import { regionTimeZone } from "../time";
import {
  acresText, causeText, customers, dotMaxZoom, withShapes, evacuationEpisodes, fireSeason, fires, isActive, isShutoff, latestEvacuation, latestFire, latestShutoff, powerNow, previewLive, since, startedAt, weeklyCustomers,
  type Fire, type Report,
} from "../conditions-model";
import { mount as browse } from "../event-browser";
import { navigate } from "@sierragridteam/design-system/lib/app";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { html, nothing } from "@sierragridteam/design-system/lib/template";
import { badge, card, feedItem, moreLink, stat } from "@sierragridteam/design-system/lib/ui";
import { createGeoMap, type SierraGeoMap } from "@sierragridteam/design-system/lib/geo-map";
import { createBarChart } from "@sierragridteam/design-system/lib/charts";

const REFRESH_MS = 120_000, DAY = 86_400_000;
/** `?preview=live` is a testing aid: development builds, or a build that asks for it. Never the public site by default. */
const previewAllowed = import.meta.env.DEV || import.meta.env.PUBLIC_GRID_PREVIEW === "1";
const PAST = ["RESOLVED", "EXPIRED"] as const;
type Source = { id: string; name: string; status: string; lastSuccessAt?: string | null };
type Feature = { type: "Feature"; geometry: any; properties: Record<string, any> };

const date = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, month: "short", day: "numeric" });
const clock = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const day = (t: number) => (Number.isFinite(t) ? date.format(t) : "—");
const time = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "Fri 16:00" within a week either way; "Oct 14, 20:00" beyond, where a weekday alone would mislead. */
const when = (t: number) => (!Number.isFinite(t) ? "—" : Math.abs(Date.now() - t) < 6 * DAY ? clock.format(t) : `${date.format(t)}, ${time.format(t)}`);
const county = (text?: string) => (text && text === text.toUpperCase() ? text[0] + text.slice(1).toLowerCase() : text ?? "");
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export async function mount(ctx: Context) {
  // Evacuations have no page of their own: they lead the wildfire page when in effect.
  if (ctx.state.topic === "EVACUATION") return void navigate(stateUrl({ ...ctx.state, topic: "WILDFIRE", timeExplicit: false } as any), { replace: true });
  // A fixed past interval is a question for the report browser, not for "now".
  if (ctx.state.mode === "history") return browse(ctx);
  return ctx.state.topic === "POWER" ? power(ctx) : wildfires(ctx);
}

/** Shared plumbing: links, the source line, a map kept across refreshes. */
function page(ctx: Context) {
  const { state, signal } = ctx;
  const recordUrl = (id: string, layer: string) => stateUrl({ ...state, topic: "events", layer, record: id, revision: "", compare: "", autoSelect: true, timeExplicit: false } as any);
  const browseUrl = (layer: string, eventStatus = "all") => stateUrl({ ...state, topic: "events", layer, eventStatus, record: "", timeExplicit: false } as any);
  /** "CAL FIRE checked 4 min ago", or what is wrong: an empty list only means "none" while the source is healthy. */
  const checked = (sources: Source[], ids: string[], now: number) => {
    const mine = sources.filter((s) => ids.includes(s.id));
    const bad = mine.filter((s) => s.status !== "OK");
    const reads = mine.map((s) => Date.parse(s.lastSuccessAt ?? "")).filter(Number.isFinite);
    const last = reads.length === mine.length ? Math.min(...reads) : NaN;
    return { ok: mine.length > 0 && !bad.length && Number.isFinite(last), text: !mine.length ? "source status unknown" : bad.length ? `${bad.map((s) => s.name).join(", ")}: ${bad[0].status.toLowerCase()}` : Number.isFinite(last) ? `checked ${since(last, now)} ago` : "not yet read" };
  };
  function keepMap(hostId: string, label: string, features: () => Feature[], cardFor: (p: Record<string, any>) => unknown) {
    let map: SierraGeoMap | undefined, lastKey = "", selectedId: string | undefined;
    return () => {
      const host = document.getElementById(hostId);
      if (!host) { map = undefined; lastKey = ""; return; }
      const list = features();
      const fc = { type: "FeatureCollection" as const, features: list };
      const key = JSON.stringify(list.map((f) => f.properties));
      if (!map || !host.contains(map)) {
        map = createGeoMap({ label, data: fc as any, basemap: true, large: true, fitFocus: true, labels: "selected", featureList: false, card: (f) => cardFor(f.properties ?? {}) as any });
        host.replaceChildren(map);
        map.addEventListener("feature-select", (e) => { selectedId = (e as CustomEvent).detail.feature.properties?.id; }, { signal });
        map.addEventListener("feature-clear", () => { selectedId = undefined; }, { signal });
      } else if (key !== lastKey) {
        map.data = fc as any;
        const index = selectedId ? list.findIndex((f) => f.properties.id === selectedId) : -1;
        map.selected = index >= 0 ? index : undefined;
      }
      lastKey = key;
    };
  }
  return { recordUrl, browseUrl, checked, keepMap };
}

const evacLevel = (level?: string) => (level === "ORDER" ? "Order" : level === "WARNING" ? "Warning" : level ? level[0] + level.slice(1).toLowerCase().replaceAll("_", " ") : "Notice");
const evacTone = (level?: string) => (level === "ORDER" ? "alarm" : "elevated") as "alarm" | "elevated";
/** Shown whenever `?preview=live` is on: the page must never pass for the real thing. */
const previewNotice = (what: string, realUrl: string) => html`<p class="callout conditions-preview" role="note"><strong>Test view, not live.</strong> ${what} shown as if active, to check this layout. <a href=${realUrl}>Back to the real page →</a></p>`;

const hero = (kicker: string, title: string, tone: "alarm" | "plain", lines: string[]) =>
  pageHero({ kicker, title, titleClass: "conditions-answer", alarm: tone === "alarm", lines: lines.map((l, i) => (i ? l : l[0].toUpperCase() + l.slice(1))) });

/* ---------------------------------------------------------------- wildfires */

type Shape = { type: string; coordinates: unknown };
type FireState = { shapes: Map<string, Shape>; active: Report[]; past: Report[]; evacNow: Report[]; evacPast: Report[]; sources: Source[]; fireWeather?: { state?: string; headline?: string } | null; fireWeatherKnown?: boolean; loaded: boolean; errors: string[]; updatedAt: number; now: number };

async function wildfires(ctx: Context) {
  const { client, state, $, signal } = ctx;
  const { recordUrl, browseUrl, checked, keepMap } = page(ctx);
  const preview = previewAllowed && state.preview === "live";
  const store = createStore<FireState>({ shapes: new Map(), active: [], past: [], evacNow: [], evacPast: [], sources: [], loaded: false, errors: [], updatedAt: 0, now: Date.now() });
  // The season's records are read without their shapes (past evacuation zones alone are over half a megabyte); what is active comes whole.
  // Every page is read: the API orders by severity, so a capped read would keep the worst, not the latest.
  const list = async (layer: string, status?: readonly string[], shapes = !status) => {
    const all: Report[] = [];
    let token = "";
    for (let page = 0; page < 10; page++) {
      const r = await data(client.listEvents({ place: state.place, layer: [layer], pageSize: 200, geometryFormat: shapes ? "OBJECT" : "NONE", ...(status ? { status: [...status] } : {}), ...(token ? { pageToken: token } : {}) } as any));
      all.push(...(r.events as unknown as Report[]));
      token = r.nextPageToken;
      if (!token || signal.aborted) break;
    }
    return all;
  };
  /** Past fires' perimeters, fetched once after the page is up; the map gains them when they arrive. */
  async function loadShapes() {
    try {
      const reports = await list("WILDFIRE", PAST, true);
      if (signal.aborted) return;
      store.set({ shapes: new Map(reports.flatMap((r) => (r.geometry?.object && /Polygon$/.test(r.geometry.object.type) ? [[r.id, r.geometry.object as Shape] as const] : []))) });
    } catch { /* The dots stand in for perimeters that could not load. */ }
  }

  let raw: { active: Report[]; past: Report[]; evacNow: Report[]; evacPast: Report[] } = { active: [], past: [], evacNow: [], evacPast: [] };
  async function load() {
    // Fire weather rides on the (large) conditions read: it fills in its line when it arrives.
    void data(client.getConditions({ place: state.place })).then((c) => { if (!signal.aborted) store.set({ fireWeather: c.fireWeather, fireWeatherKnown: true }); }, () => {});
    const [active, past, evacNow, evacPast, sources] = await Promise.allSettled([
      list("WILDFIRE"), list("WILDFIRE", PAST), list("EVACUATION"), list("EVACUATION", PAST),
      data(client.listSources()),
    ]);
    if (signal.aborted) return;
    const value = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : undefined);
    const prev = store.get();
    // What the API last returned, kept apart from the preview's altered copies so a failed refresh cannot compound them.
    raw = { active: value(active) ?? raw.active, past: value(past) ?? raw.past, evacNow: value(evacNow) ?? raw.evacNow, evacPast: value(evacPast) ?? raw.evacPast };
    let fireNow = raw.active.filter(isActive), firePast = raw.past;
    let zonesNow = raw.evacNow.filter(isActive), zonesPast = raw.evacPast;
    if (preview) {
      ({ now: fireNow, past: firePast } = previewLive(fireNow, firePast.filter((r) => !isActive(r)), latestFire));
      ({ now: zonesNow, past: zonesPast } = previewLive(zonesNow, zonesPast.filter((r) => !isActive(r)), latestEvacuation));
    }
    store.set({
      active: fireNow, past: firePast,
      evacNow: zonesNow, evacPast: zonesPast,
      sources: (value(sources)?.sources as Source[] | undefined) ?? prev.sources, 
      errors: [active.status === "rejected" && "active fire reports", evacNow.status === "rejected" && "evacuations", (past.status === "rejected" || evacPast.status === "rejected") && "the season's record"].filter(Boolean) as string[],
      loaded: true, updatedAt: active.status === "fulfilled" && evacNow.status === "fulfilled" ? Date.now() : prev.updatedAt, now: Date.now(),
    });
  }

  $("content").innerHTML = `<div id="conditions-page"></div>`;
  const model = (s: FireState) => {
    const burning = fires(s.active), season = fires(withShapes([...s.active, ...s.past], s.shapes));
    return { burning, season, stats: fireSeason(season), episodes: evacuationEpisodes(s.evacPast, regionTimeZone) };
  };

  region($("conditions-page"), store, (s) => {
    const { burning, season, stats, episodes } = model(s);
    const fireCheck = checked(s.sources, ["calfire", "firis"], s.now), evacCheck = checked(s.sources, ["caloes"], s.now);
    // Orders, warnings, and anything else (an advisory, shelter in place) under its own name.
    const orders = s.evacNow.filter((e) => e.evacuation?.level === "ORDER"), warnings = s.evacNow.filter((e) => e.evacuation?.level === "WARNING");
    const notices = s.evacNow.filter((e) => e.evacuation?.level !== "ORDER" && e.evacuation?.level !== "WARNING");
    const evacUnknown = s.errors.includes("evacuations") || !evacCheck.ok;
    const live = burning.length > 0 || s.evacNow.length > 0;
    const unknown = s.errors.includes("active fire reports") || !fireCheck.ok;
    const acres = burning.reduce((n, f) => n + (f.acres ?? 0), 0);
    const biggest = burning.reduce<Fire | undefined>((a, f) => (!a || (f.acres ?? 0) > (a.acres ?? 0) ? f : a), undefined);
    const fireWeather = s.fireWeather?.state && s.fireWeather.state !== "normal" ? s.fireWeather.state.replaceAll("_", " ") : "";
    const title = !s.loaded ? "Checking for fires…"
      : orders.length ? `${plural(orders.length, "evacuation order")} in effect${burning.length ? ` · ${plural(burning.length, "wildfire")} active` : ""}`
      : burning.length ? `${plural(burning.length, "wildfire")} active${biggest ? ` — ${biggest.name}, ${acresText(biggest.acres)}${biggest.containment !== null ? `, ${biggest.containment}% contained` : ""}` : ""}`
      : warnings.length ? `${plural(warnings.length, "evacuation warning")} in effect`
      : notices.length ? `${plural(notices.length, "evacuation notice")} in effect`
      : unknown ? "Fire reports are unavailable right now" : "No active wildfires";
    const lines = !s.loaded ? [] : [
      ...(warnings.length && (orders.length || burning.length) ? [`${plural(warnings.length, "evacuation warning")}`] : []),
      `CAL FIRE and FIRIS ${fireCheck.text}`,
      ...(notices.length && (orders.length || warnings.length || burning.length) ? [plural(notices.length, "other evacuation notice")] : []),
      ...(!s.evacNow.length ? [evacUnknown ? `evacuations unknown: ${s.errors.includes("evacuations") ? "the request failed" : evacCheck.text}` : `no evacuation orders or warnings (Cal OES ${evacCheck.text})`] : []),
      ...(fireWeather ? [`fire weather: ${fireWeather}`] : s.fireWeatherKnown ? ["fire weather normal"] : []),
    ];
    const recent = stats.latest;
    return html`
      ${preview ? previewNotice("The most recent fire and the most recent day's evacuation zones are", stateUrl({ ...state, preview: "" })) : nothing}
      ${hero(`${preview ? "Test view, not live · " : ""}Wildfires and evacuations · CAL FIRE, FIRIS and Cal OES`, title, live ? "alarm" : "plain", lines)}
      ${s.errors.length ? html`<p class="callout">Not available right now: ${s.errors.join(", ")}.${unknown || evacUnknown ? " Without them this page cannot give an all-clear." : ""}</p>` : nothing}
      <div class="stats stats--compact conditions-kpis">
        ${live ? html`
          ${stat({ label: "Active fires", value: String(burning.length), sub: burning.length ? burning.map((f) => f.name.replace(/ Fire$/, "")).join(", ") : "none reported" })}
          ${stat({ label: "Area burning", value: burning.length ? acresText(acres) : "—", sub: biggest ? `largest ${biggest.name}` : "no active fire" })}
          ${stat({ label: "Evacuation orders", value: String(orders.length), sub: orders.length ? [...new Set(orders.map((e) => e.evacuation?.zoneId || e.areaLabel))].slice(0, 4).join(", ") : "none in effect" })}
          ${stat({ label: "Evacuation warnings", value: String(warnings.length), sub: warnings.length ? [...new Set(warnings.map((e) => e.evacuation?.zoneId || e.areaLabel))].slice(0, 4).join(", ") : notices.length ? `${plural(notices.length, "other notice")} in effect` : "none in effect" })}` : html`
          ${stat({ label: "Last fire", value: recent ? `${since(recent.started, s.now)} ago` : "—", sub: recent ? `${recent.name}, ${acresText(recent.acres)} · ${day(recent.started)}` : "none on record" })}
          ${stat({ label: "Evacuations now", value: evacUnknown ? "—" : "None", sub: episodes.length ? `last issued ${day(episodes[0].at)}, ${episodes[0].county}` : "none on record" })}`}
        ${stat({ label: "Fires this season", value: String(stats.count), href: browseUrl("WILDFIRE"), actionLabel: "Browse all wildfire reports", sub: Number.isFinite(stats.since) ? `in or near the corridor since ${day(stats.since)}` : "none on record" })}
        ${live ? nothing : html`${stat({ label: "Area burned", value: stats.count ? acresText(stats.acres) : "—", sub: stats.largest ? `largest ${stats.largest.name}, ${acresText(stats.largest.acres)}` : "" })}
        ${stat({ label: "Evacuation zones issued", value: String(s.evacPast.length + s.evacNow.length), href: browseUrl("EVACUATION"), actionLabel: "Browse all evacuation reports", sub: episodes.length ? `on ${plural(new Set(episodes.map((e) => day(e.at))).size, "day")} this season` : "none this season" })}`}
      </div>
      ${live ? html`<div class="dashboard conditions-live">
        ${card({ variant: "panel", title: "Evacuations in effect", kicker: plural(s.evacNow.length, "zone"), as: "section", class: "conditions-half" },
          s.evacNow.length ? html`<div class="feed conditions-feed">${[...orders, ...warnings, ...notices].map((e) => feedItem({
              title: e.headline, href: recordUrl(e.id, "EVACUATION"), level: 3, place: e.areaLabel ? `${county(e.areaLabel)} County` : undefined,
              severity: { tone: evacTone(e.evacuation?.level), label: evacLevel(e.evacuation?.level) },
              when: `Since ${when(startedAt(e))}`, source: e.provenance.sourceName }))}</div>`
            : html`<p class="meta">No evacuation orders or warnings in effect.</p>`)}
        ${card({ variant: "panel", title: "Active fires", kicker: `${burning.length} reported`, as: "section", class: "conditions-half" },
          burning.length ? html`<div class="feed conditions-feed">${burning.map((f) => feedItem({
              title: `${f.name} — ${acresText(f.acres)}${f.containment !== null ? `, ${f.containment}% contained` : ""}`, href: recordUrl(f.id, "WILDFIRE"), level: 3, place: f.place || undefined,
              severity: { tone: "alarm", label: "Active" }, when: `Started ${when(f.started)} · updated ${since(f.updated, s.now)} ago`, source: f.sources.join(" and ") }))}</div>`
            : html`<p class="meta">No active fire is reported with these evacuations.</p>`)}
      </div>` : nothing}
      <section class="conditions-map-section" aria-label="Fire map">
        <ul class="conditions-legend" aria-label="Map key">
          ${live ? html`<li><span class="conditions-key conditions-key--dot" style="--key: var(--state-alarm)"></span>Active fire</li><li><span class="conditions-key conditions-key--area" style="--key: var(--state-alarm)"></span>Evacuation order</li><li><span class="conditions-key conditions-key--area" style="--key: var(--chart-ochre)"></span>Evacuation warning</li>` : nothing}
          <li><span class="conditions-key conditions-key--dot" style="--key: var(--chart-ochre)"></span>Fire this season, sized by area</li>
          <li><span class="conditions-key conditions-key--area" style="--key: var(--chart-ochre)"></span>Mapped perimeter</li>
        </ul>
        <div id="conditions-map"></div>
      </section>
      <div class="dashboard conditions-dashboard">
        ${card({ variant: "panel", title: "This season's fires", kicker: `${stats.count} fires, newest first`, as: "section", class: "conditions-wide", actions: moreLink(browseUrl("WILDFIRE"), "All reports") },
          season.length ? html`<div class="table-scroll"><table class="table table--cards conditions-table">
            <thead><tr><th scope="col">Fire</th><th scope="col">Started</th><th scope="col" class="conditions-num">Area</th><th scope="col">Contained</th><th scope="col">Where</th></tr></thead>
            <tbody>${season.map((f) => html`<tr>
              <th scope="row"><a href=${recordUrl(f.id, "WILDFIRE")}>${f.name}</a>${f.active ? html` ${badge("Active", { tone: "alarm" })}` : nothing}</th>
              <td data-label="Started">${day(f.started)}</td>
              <td data-label="Area" class="conditions-num">${acresText(f.acres)}</td>
              <td data-label="Contained">${f.containment === null ? "—" : `${f.containment}%`}</td>
              <td data-label="Where">${f.place || (f.area ? "Mapped perimeter" : "—")}</td></tr>`)}</tbody></table></div>`
            : html`<p class="meta">${s.loaded ? "No fires on record for this area." : "Loading…"}</p>`)}
        ${card({ variant: "panel", title: "Evacuations this season", kicker: `${episodes.length} episodes`, as: "section", class: "conditions-side", actions: moreLink(browseUrl("EVACUATION"), "All zones") },
          episodes.length ? html`<div class="feed conditions-feed">${episodes.slice(0, 8).map((e) => feedItem({
              title: `${e.county} County · ${[e.orders ? plural(e.orders, "order zone") : "", e.warnings ? plural(e.warnings, "warning zone") : "", e.others ? plural(e.others, "other notice") : ""].filter(Boolean).join(", ")}`,
              href: recordUrl(e.id, "EVACUATION"), level: 3, when: `${day(e.at)} · lifted` }))}</div>`
            : html`<p class="meta">${s.loaded ? "No evacuations on record this season." : "Loading…"}</p>`)}
      </div>
      <p class="meta conditions-footnote" data-page-updated>Fire incidents from CAL FIRE, mapped perimeters from FIRIS, evacuation zones from Cal OES. The season is what Grid has recorded for this area${Number.isFinite(stats.since) ? ` since ${day(stats.since)}` : ""}. Updated ${s.updatedAt ? when(s.updatedAt) : "—"} PT, refreshes every 2 minutes.</p>`;
  }, { signal });

  const features = (): Feature[] => {
    const s = store.get(), { season } = model(s);
    // When something is active the map frames it; the season's fires stay as context.
    const live = s.evacNow.length > 0 || season.some((f) => f.active);
    const out: Feature[] = [];
    for (const e of s.evacNow) {
      const g = e.geometry?.object;
      if (g && /Polygon$/.test(g.type)) out.push({ type: "Feature", geometry: g, properties: { id: `evac:${e.id}`, kind: "evac", ref: e.id, label: e.headline, focus: true, tone: e.evacuation?.level === "ORDER" ? "alarm" : "ochre", fill: 0.25, weight: 1.5, z: 3 } });
    }
    for (const f of season) {
      if (f.area) out.push({ type: "Feature", geometry: f.area, properties: { id: `area:${f.id}`, kind: "fire", ref: f.id, label: f.name, focus: f.active, tone: f.active ? "alarm" : "ochre", fill: f.active ? 0.3 : 0.25, weight: 1.5, z: 2 } });
      if (f.point) {
        const radius = f.active ? 8 : Math.max(4, Math.min(14, 3 + Math.log10((f.acres ?? 1) + 1) * 3));
        // Once its perimeter is on the map, the dot gives way where the perimeter is the bigger mark.
        const maxZoom = f.area && f.extent ? dotMaxZoom(f.extent, f.point[1], radius) : undefined;
        out.push({ type: "Feature", geometry: { type: "Point", coordinates: f.point }, properties: { id: `fire:${f.id}`, kind: "fire", ref: f.id, label: f.name, focus: f.active || !live, tone: f.active ? "alarm" : "ochre", pulse: f.active, radius, opacity: f.active ? 1 : 0.75, z: f.active ? 6 : 4, ...(maxZoom !== undefined ? { maxZoom } : {}) } });
      }
    }
    return out;
  };
  const cardFor = (p: Record<string, any>) => {
    const s = store.get();
    if (p.kind === "evac") {
      const e = s.evacNow.find((x) => x.id === p.ref);
      return e ? html`<div class="conditions-card"><p class="conditions-card__title">${e.headline}</p><p>${badge(evacLevel(e.evacuation?.level), { tone: evacTone(e.evacuation?.level) })} since ${when(startedAt(e))}</p>${e.description ? html`<p class="conditions-card__text">${e.description}</p>` : nothing}<p class="conditions-card__more"><a href=${recordUrl(e.id, "EVACUATION")}>Report →</a></p></div>` : nothing;
    }
    const f = model(s).season.find((x) => x.id === p.ref);
    return f ? html`<div class="conditions-card"><p class="conditions-card__title">${f.name}</p>
      <p>${f.active ? badge("Active", { tone: "alarm" }) : badge("Out", { tone: "muted" })} ${acresText(f.acres)}${f.containment !== null ? ` · ${f.containment}% contained` : ""}</p>
      <p class="conditions-card__text">${[f.place, `started ${day(f.started)}`].filter(Boolean).join(" · ")}</p>
      <p class="conditions-card__more"><a href=${recordUrl(f.id, "WILDFIRE")}>Report →</a></p></div>` : nothing;
  };
  const drawMap = keepMap("conditions-map", "This season's fires and any evacuation zones in effect", features, cardFor);
  store.subscribe((s) => { if (s.loaded) drawMap(); }, { signal });

  await load();
  // Left during the first load: start nothing that would outlive the page.
  if (signal.aborted) return;
  void loadShapes();
  const refresh = setInterval(() => void load(), REFRESH_MS);
  signal.addEventListener("abort", () => clearInterval(refresh));
}

/* -------------------------------------------------------------------- power */

type PowerState = { active: Report[]; past: Report[]; more: boolean; historyLoaded: boolean; sources: Source[]; loaded: boolean; errors: string[]; updatedAt: number; now: number };
const WEEKS = 13;

async function power(ctx: Context) {
  const { client, state, $, signal } = ctx;
  const { recordUrl, browseUrl, checked, keepMap } = page(ctx);
  const preview = previewAllowed && state.preview === "live";
  const store = createStore<PowerState>({ active: [], past: [], more: false, historyLoaded: false, sources: [], loaded: false, errors: [], updatedAt: 0, now: Date.now() });

  // What is out now comes first and whole; the record behind it follows in the
  // background, page by page and without shapes, so the answer is never waiting on it.
  let nowRaw: Report[] = [], pastRaw: Report[] = [], more = false;
  const publish = (extra: Partial<PowerState> = {}) => {
    let out = nowRaw.filter(isActive), before = pastRaw;
    if (preview) ({ now: out, past: before } = previewLive(out, before.filter((r) => !isActive(r)), latestShutoff));
    store.set({ active: out, past: before, more, ...extra });
  };
  async function loadNow() {
    const [active, sources] = await Promise.allSettled([data(client.listEvents({ place: state.place, layer: ["POWER"], pageSize: 100 } as any)), data(client.listSources())]);
    if (signal.aborted) return;
    if (active.status === "fulfilled") nowRaw = active.value.events as unknown as Report[];
    publish({
      sources: sources.status === "fulfilled" ? (sources.value.sources as Source[]) : store.get().sources,
      errors: [...(active.status === "rejected" ? ["current outages"] : []), ...store.get().errors.filter((e) => e === "past interruptions")],
      loaded: true, updatedAt: Date.now(), now: Date.now(),
    });
  }
  async function loadHistory() {
    // The whole window is read before anything is shown: the API orders by severity, so a
    // partial read would count the worst outages and miss the ordinary ones.
    try {
      const all: Report[] = [];
      const from = new Date(Date.now() - WEEKS * 7 * DAY).toISOString();
      let token = "";
      for (let page = 0; page < 12; page++) {
        // The preview needs the shutoff's area for the map; otherwise the record is read without shapes.
        const r = await data(client.listEvents({ place: state.place, layer: ["POWER"], status: [...PAST], since: from, pageSize: 200, geometryFormat: preview ? "OBJECT" : "NONE", ...(token ? { pageToken: token } : {}) } as any));
        if (signal.aborted) return;
        all.push(...(r.events as unknown as Report[]));
        token = r.nextPageToken;
        if (!token) break;
      }
      pastRaw = all; more = !!token;
      publish({ historyLoaded: true });
    } catch {
      if (!signal.aborted) store.set({ historyLoaded: true, errors: [...store.get().errors.filter((e) => e !== "past interruptions"), "past interruptions"] });
    }
  }

  $("content").innerHTML = `<div id="conditions-page"></div>`;
  const chart = createBarChart({ label: "Customers affected, by week", categories: [], series: [] });
  chart.classList.add("ds-chart--quiet");

  region($("conditions-page"), store, (s) => {
    const now = powerNow(s.active, s.now);
    const check = checked(s.sources, ["pge", "psps"], s.now);
    const unknown = s.errors.includes("current outages") || !check.ok;
    const shutoff = now.shutoffs[0];
    const weeks = weeklyCustomers(s.past.concat(s.active), s.now, WEEKS, regionTimeZone);
    const window = s.past.filter((r) => startedAt(r) >= s.now - WEEKS * 7 * DAY);
    const largest = [...s.past].sort((a, b) => customers(b) - customers(a)).slice(0, 10);
    const pastShutoffs = s.past.filter(isShutoff);
    const live = s.active.length > 0;
    const title = !s.loaded ? "Checking for outages…"
      : shutoff ? `${shutoff.headline.split(" — ")[0]} — ${plural(customers(shutoff), "customer")}`
      : now.outages.length ? `${plural(now.customers, "customer")} without power in ${plural(now.outages.length, "outage")}`
      : unknown ? "Outage reports are unavailable right now" : "No outages reported";
    const lines = !s.loaded ? [] : [
      ...(shutoff && now.outages.length ? [`${plural(now.customers, "customer")} out in ${plural(now.outages.length, "outage")}`] : []),
      ...(now.outages.length && Number.isFinite(now.lastRestoration) ? [`restoration estimated by ${when(now.lastRestoration)} PT`] : []),
      `PG&E ${check.text}`,
      ...(!shutoff && !unknown ? ["no shutoff planned or under way"] : []),
    ];
    chart.options = { label: "Customers affected by interruptions starting each week", categories: weeks.map((w) => w.label), categoryLabel: "Week of", unit: "customers", decimals: 0, stacked: true, height: 220,
      series: [{ id: "outages", label: "Outages", values: weeks.map((w) => w.outages) }, { id: "shutoffs", label: "Safety shutoffs", values: weeks.map((w) => w.shutoffs) }] } as any;
    return html`
      ${preview ? previewNotice("The most recent safety shutoff is", stateUrl({ ...state, preview: "" })) : nothing}
      ${hero(`${preview ? "Test view, not live · " : ""}Power · Pacific Gas and Electric`, title, shutoff ? "alarm" : "plain", lines)}
      ${s.errors.length ? html`<p class="callout">Not available right now: ${s.errors.join(", ")}.${unknown ? " Without outage reports this page cannot say the power is on." : ""}</p>` : nothing}
      <div class="stats stats--compact conditions-kpis">
        ${stat({ label: "Customers out now", value: unknown ? "—" : now.customers.toLocaleString("en-US"), sub: shutoff ? `in outages; the shutoff's ${plural(customers(shutoff), "customer")} are counted apart` : now.outages.length ? `largest ${plural(customers(now.outages[0]), "customer")}${causeText(now.outages[0]) ? ` · ${causeText(now.outages[0])}` : ""}` : "no outages reported" })}
        ${stat({ label: "Outages now", value: unknown ? "—" : String(now.outages.length), sub: now.medical ? `${plural(now.medical, "medical baseline customer")} affected` : now.outages.length ? "no medical baseline customers affected" : "" })}
        ${stat({ label: "Next restoration", value: Number.isFinite(now.nextRestoration) ? when(now.nextRestoration) : "—", sub: Number.isFinite(now.nextRestoration) ? "PG&E's estimate" : now.outages.length ? "no estimate given" : "nothing to restore" })}
        ${stat({ label: "Safety shutoffs", value: shutoff ? shutoff.power?.stage || "Active" : unknown ? "—" : "None", sub: shutoff ? `${plural(customers(shutoff), "customer")}${shutoff.power?.medicalBaselineAffected ? ` · ${shutoff.power.medicalBaselineAffected.toLocaleString("en-US")} medical baseline` : ""}` : !s.historyLoaded && !pastShutoffs.length ? "checking the record…" : pastShutoffs.length ? `last ${day(Math.max(...pastShutoffs.map(startedAt)))}, ${plural(Math.max(...pastShutoffs.map(customers)), "customer")}` : "none on record" })}
        ${stat({ label: `Past ${WEEKS} weeks`, value: s.historyLoaded || window.length ? String(window.length) : "…", href: browseUrl("POWER"), actionLabel: "Browse all power reports", sub: window.length ? `interruptions · ${window.reduce((n, r) => n + customers(r), 0).toLocaleString("en-US")} customers in all` : s.historyLoaded ? "no interruptions on record" : "loading the record…" })}
      </div>
      ${live ? html`<section class="conditions-map-section" aria-label="Outage map">
        <ul class="conditions-legend" aria-label="Map key">
          <li><span class="conditions-key conditions-key--area" style="--key: var(--chart-ochre)"></span>Outage area</li>
          ${now.shutoffs.length ? html`<li><span class="conditions-key conditions-key--area" style="--key: var(--state-alarm)"></span>Safety shutoff area</li>` : nothing}
        </ul>
        <div id="conditions-map"></div>
      </section>` : nothing}
      <div class="dashboard conditions-dashboard">
        ${live ? card({ variant: "panel", title: "Out now", kicker: `${plural(s.active.length, "report")}, largest first`, as: "section", class: "conditions-side" },
          html`<div class="feed conditions-feed">${[...now.shutoffs, ...now.outages].map((r) => feedItem({
            title: r.headline, href: recordUrl(r.id, "POWER"), level: 3,
            severity: { tone: isShutoff(r) ? "alarm" : customers(r) >= 100 ? "elevated" : "muted", label: isShutoff(r) ? "Shutoff" : "Outage" },
            when: Number.isFinite(Date.parse(r.power?.estimatedRestoration ?? "")) ? `Since ${when(startedAt(r))} · restoration est. ${when(Date.parse(r.power!.estimatedRestoration!))}` : `Since ${when(startedAt(r))}`,
            source: [r.power?.crewStatus, r.provenance.sourceName].filter(Boolean).join(" · ") }))}</div>`) : nothing}
        ${card({ variant: "panel", title: "Customers affected, by week", kicker: `Interruptions starting each week, past ${WEEKS} weeks${s.more ? " (incomplete)" : ""}`, as: "section", class: live ? "conditions-wide" : "conditions-full" },
          s.past.length ? html`${chart}` : html`<p class="meta conditions-pending">${s.historyLoaded ? "No past interruptions on record." : "Loading the record…"}</p>`)}
        ${card({ variant: "panel", title: "Largest interruptions", kicker: !s.historyLoaded ? "Loading the record…" : `Of ${s.past.length.toLocaleString("en-US")} in the past ${WEEKS} weeks${s.more ? " (incomplete: more than could be read)" : ""}`, as: "section", class: "conditions-full", actions: moreLink(browseUrl("POWER"), "All reports") },
          largest.length ? html`<div class="table-scroll"><table class="table table--cards conditions-table">
            <thead><tr><th scope="col">Interruption</th><th scope="col">Started</th><th scope="col" class="conditions-num">Customers</th><th scope="col">Kind</th><th scope="col">Cause</th></tr></thead>
            <tbody>${largest.map((r) => html`<tr>
              <th scope="row"><a href=${recordUrl(r.id, "POWER")}>${r.headline.split(" — ")[0]}</a></th>
              <td data-label="Started">${day(startedAt(r))}</td>
              <td data-label="Customers" class="conditions-num">${customers(r).toLocaleString("en-US")}</td>
              <td data-label="Kind">${isShutoff(r) ? "Safety shutoff" : /planned/i.test(r.headline) ? "Planned" : "Unplanned"}</td>
              <td data-label="Cause">${causeText(r) || "—"}</td></tr>`)}</tbody></table></div>`
            : html`<p class="meta">${s.historyLoaded ? "No past interruptions on record." : "Loading the record…"}</p>`)}
      </div>
      <p class="meta conditions-footnote" data-page-updated>Outages and safety shutoffs from PG&E, for the corridor and its towns. A customer is a metered account, not a person. Updated ${s.updatedAt ? when(s.updatedAt) : "—"} PT, refreshes every 2 minutes.</p>`;
  }, { signal });

  const features = (): Feature[] => store.get().active.flatMap((r) => {
    const g = r.geometry?.object, c = r.geometry?.centroid, shut = isShutoff(r);
    const props = { kind: "power", ref: r.id, label: r.headline, focus: true, tone: shut ? "alarm" : "ochre" };
    return [
      ...(g && /Polygon$/.test(g.type) ? [{ type: "Feature" as const, geometry: g, properties: { ...props, id: `area:${r.id}`, fill: 0.3, weight: 1.5, z: 2 } }] : []),
      ...(c ? [{ type: "Feature" as const, geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { ...props, id: `outage:${r.id}`, pulse: true, radius: Math.max(5, Math.min(14, 4 + Math.log10(customers(r) + 1) * 3)), z: 5 } }] : []),
    ];
  });
  const cardFor = (p: Record<string, any>) => {
    const r = store.get().active.find((x) => x.id === p.ref);
    if (!r) return nothing;
    const est = Date.parse(r.power?.estimatedRestoration ?? "");
    return html`<div class="conditions-card"><p class="conditions-card__title">${r.headline}</p>
      <p>${badge(isShutoff(r) ? "Shutoff" : "Outage", { tone: isShutoff(r) ? "alarm" : "elevated" })} since ${when(startedAt(r))}</p>
      <p class="conditions-card__text">${[Number.isFinite(est) ? `Restoration estimated ${when(est)}` : "", r.power?.crewStatus, causeText(r)].filter(Boolean).join(" · ") || "No estimate given."}</p>
      <p class="conditions-card__more"><a href=${recordUrl(r.id, "POWER")}>Report →</a></p></div>`;
  };
  const drawMap = keepMap("conditions-map", "Areas without power now", features, cardFor);
  store.subscribe((s) => { if (s.loaded) drawMap(); }, { signal });

  await loadNow();
  // Left during the first load: start nothing that would outlive the page.
  if (signal.aborted) return;
  void loadHistory();
  const refresh = setInterval(() => void loadNow(), REFRESH_MS);
  // The record changes slowly (an outage ends and joins it): re-read it every 10 minutes.
  const record = setInterval(() => void loadHistory(), 5 * REFRESH_MS);
  signal.addEventListener("abort", () => clearInterval(record));
  signal.addEventListener("abort", () => clearInterval(refresh));
}
