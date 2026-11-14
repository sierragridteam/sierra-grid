/**
 * Weather: the answer first (alerts, otherwise the weather in a sentence),
 * then the climb up Hwy 4 against the snow level, a map of alert areas and
 * town conditions, and a dashboard: 48 hours by town, alerts, the week ahead,
 * fire weather and burn day.
 */
import type { Context } from "../context";
import { pageHero } from "../hero";
import { data } from "../context";
import { empty, btn } from "../render";
import { stateUrl } from "../state";
import { regionTimeZone } from "../time";
import { rememberWeather, weatherPreferences } from "../weather-display";
import {
  alertTone, alertWindow, climb, currentAlerts, days, headline, list, outlook, snowLevel, units, weatherIcon, within,
  type Units,
} from "../weather-model";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { html, nothing } from "@sierragridteam/design-system/lib/template";
import { badge, card, dayStrip, moreLink, elevationProfile, feedItem, heatmap, propertyList, reading, segmented, stat } from "@sierragridteam/design-system/lib/ui";
import { createGeoMap, type SierraGeoMap } from "@sierragridteam/design-system/lib/geo-map";

const HOUR = 3_600_000, REFRESH_MS = 300_000;

type Conditions = Extract<Awaited<ReturnType<Context["client"]["getConditions"]>>, { notModified: false }>["data"];
type EventList = Extract<Awaited<ReturnType<Context["client"]["listEvents"]>>, { notModified: false }>["data"];
type GridEvent = EventList["events"][number];
type Metric = "temperature" | "chance" | "rain" | "snow" | "gust";

type State = {
  conditions?: Conditions; alerts: GridEvent[]; burn: GridEvent[];
  loaded: boolean; errors: string[]; updatedAt: number; now: number;
  unit: Units; town: string; metric: Metric;
};

const short = (name: string) => name.split(",")[0];
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, weekday: "short" });
const clock = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayNumber = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, day: "numeric" });
const hourOf = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, hour: "numeric", hourCycle: "h23" });
/** "Sat 10:00": every time on the page is within a week, so the weekday is enough. */
const when = (t: number | string | null | undefined) => {
  const v = typeof t === "string" ? Date.parse(t) : t;
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${weekday.format(v)} ${clock.format(v)}`;
};
const sentence = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

export async function mount(ctx: Context) {
  const { client, state, $, signal, root } = ctx;
  if (state.mode === "history") {
    $("content").innerHTML = `<h1>Weather</h1>${empty("Past weather observations and earlier forecasts are not kept. Weather alerts are: their revisions can be browsed as events.")}<div class="actions">${btn("Weather alert history", "WEATHER_ALERT")}<button class="btn btn--outline" data-current="weather">Current weather →</button></div>`;
    return;
  }
  const recordUrl = (id: string, layer = "WEATHER_ALERT") => stateUrl({ ...state, topic: "events", layer, record: id, revision: "", compare: "", autoSelect: true, timeExplicit: false } as any);
  const alertsUrl = stateUrl({ ...state, topic: "events", layer: "WEATHER_ALERT", record: "", timeExplicit: false } as any);
  const roadsUrl = stateUrl({ ...state, topic: "roads", record: "", timeExplicit: false } as any);
  const prefs = weatherPreferences();
  const store = createStore<State>({ alerts: [], burn: [], loaded: false, errors: [], updatedAt: 0, now: Date.now(), unit: prefs.unit, town: state.weatherLocation || prefs.location, metric: "temperature" });

  async function load() {
    const [conditions, alerts, burn] = await Promise.allSettled([
      data(client.getConditions({ place: state.place })),
      data(client.listEvents({ place: state.place, layer: ["WEATHER_ALERT"], pageSize: 50 })),
      data(client.listEvents({ place: state.place, layer: ["BURN_STATUS"], pageSize: 20 })),
    ]);
    if (signal.aborted) return;
    const value = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : undefined);
    const prev = store.get(), c = value(conditions) ?? prev.conditions;
    // The selected town: the URL's, the remembered one, else the middle of the hill.
    const ids = c?.forecast.map((f) => f.locationId) ?? [];
    const town = ids.includes(prev.town) ? prev.town : ids.find((id) => state.place.includes(id)) ?? (ids.includes("arnold") ? "arnold" : ids[0] ?? "");
    store.set({
      conditions: c, alerts: value(alerts)?.events ?? prev.alerts, burn: value(burn)?.events ?? prev.burn, town,
      errors: [conditions.status === "rejected" && "observations and forecast", alerts.status === "rejected" && "weather alerts", burn.status === "rejected" && "burn day"].filter(Boolean) as string[],
      // A failed refresh keeps the last data on the page but not a fresh time.
      loaded: true, updatedAt: conditions.status === "fulfilled" && alerts.status === "fulfilled" ? Date.now() : prev.updatedAt, now: Date.now(),
    });
  }

  // The choice of town and units is kept in the URL and remembered for the overview.
  store.subscribe((s) => {
    if (!s.town) return;
    rememberWeather(s.unit, s.town);
    if (state.weatherLocation === s.town) return;
    state.weatherLocation = s.town;
    history.replaceState(history.state, "", stateUrl(state));
    root.dispatchEvent(new CustomEvent("grid:state-sync"));
  }, { signal });

  $("content").innerHTML = `<div id="weather-page"></div>`;

  region($("weather-page"), store, (s) => {
    const u = units(s.unit), c = s.conditions;
    const alerts = currentAlerts(s.alerts, s.now);
    const towns = [...(c?.locations ?? [])].sort((a, b) => (b.elevationMeters ?? 0) - (a.elevationMeters ?? 0));
    const name = (id: string) => short(towns.find((x) => x.id === id)?.name ?? id);
    const forecasts = c?.forecast ?? [];
    const snow = snowLevel(forecasts, s.now);
    const outlooks = forecasts.map((f) => outlook(f, s.now));
    const stops = climb(c?.locations ?? []);
    const answer = headline({ alerts, now: s.now, fmt: when, u, snow, stops, current: c?.weather ?? [], totals: outlooks });
    const temps = (c?.weather ?? []).filter((w) => Number.isFinite(w.temperatureCelsius));
    const coldest = temps.reduce<(typeof temps)[number] | undefined>((a, w) => (!a || w.temperatureCelsius < a.temperatureCelsius ? w : a), undefined);
    const warmest = temps.reduce<(typeof temps)[number] | undefined>((a, w) => (!a || w.temperatureCelsius > a.temperatureCelsius ? w : a), undefined);
    const gust = outlooks.reduce<(typeof outlooks)[number] | undefined>((a, o) => (!a || o.gustKmh > a.gustKmh ? o : a), undefined);
    const wettest = outlooks.reduce<(typeof outlooks)[number] | undefined>((a, o) => (!a || o.precipitationMm > a.precipitationMm ? o : a), undefined);
    const snowiest = outlooks.reduce<(typeof outlooks)[number] | undefined>((a, o) => (!a || o.snowfallMm > a.snowfallMm ? o : a), undefined);
    const selected = forecasts.find((f) => f.locationId === s.town);
    const week = selected ? days(selected.daily, regionTimeZone, s.now) : [];
    return html`
      ${pageHero({ kicker: "Weather · National Weather Service", titleClass: "weather-answer", alarm: answer.tone === "alarm", lines: answer.lines,
        title: s.loaded ? (c || alerts.length ? `${answer.title}${/\d\d:\d\d$/.test(answer.title) ? " PT" : ""}` : "Weather is unavailable right now") : "Checking the weather…",
        actions: segmented({ name: "weather-unit", label: "Units", value: s.unit, options: [{ value: "F", label: "°F · ft" }, { value: "C", label: "°C · m" }], onChange: (value) => store.set({ unit: value as Units }) }) })}
      ${s.errors.length ? html`<p class="callout">Not available right now: ${s.errors.join(", ")}. ${s.errors.includes("weather alerts") ? "Without alerts this page cannot give an all-clear. " : ""}${s.updatedAt ? `What is shown for them is as of ${when(s.updatedAt)} PT.` : ""}</p>` : nothing}
      ${c && c.weatherStatus && c.weatherStatus !== "OK" ? html`<p class="callout">The weather source is ${String(c.weatherStatus).toLowerCase()}: observations and forecasts may be out of date.</p>` : nothing}
      <div class="stats stats--compact weather-kpis">
        ${stat({ label: "Alerts in effect", value: s.errors.includes("weather alerts") ? "—" : String(alerts.length), href: alertsUrl, actionLabel: "Browse weather alerts", sub: s.errors.includes("weather alerts") && !alerts.length ? "alerts could not be checked" : alerts.length ? list(alerts.map((a) => a.headline)) : "no watches, warnings or advisories" })}
        ${stat({ label: "Temperature now", value: coldest && warmest ? `${u.temp(coldest.temperatureCelsius)} to ${u.temp(warmest.temperatureCelsius)}` : "—", sub: coldest && warmest ? `${name(coldest.locationId)} to ${name(warmest.locationId)}` : "no observations" })}
        ${stat({ label: "Snow level", value: snow ? u.elevation(snow.now) : "—", sub: snow ? (snow.now - snow.lowest.meters > 150 ? `falling to ${u.elevation(snow.lowest.meters)} by ${when(snow.lowest.time)}` : snow.highest.meters - snow.now > 150 ? `rising to ${u.elevation(snow.highest.meters)} by ${when(snow.highest.time)}` : "steady for the next 24 hours") : "not in the forecast" })}
        ${stat({ label: "Peak gust · 24 h", value: gust?.hours ? u.speed(gust.gustKmh) : "—", sub: gust?.hours ? `${name(gust.locationId)} · ${when(gust.gustAt)}` : "no forecast" })}
        ${stat({ label: "Rain and snow · 24 h", value: wettest?.hours ? u.rain(wettest.precipitationMm) : "—", sub: wettest?.hours ? (wettest.precipitationMm > 0 ? `most at ${name(wettest.locationId)}${snowiest && snowiest.snowfallMm > 0 ? ` · ${u.snow(snowiest.snowfallMm)} of snow at ${name(snowiest.locationId)}` : " · no snow"}` : "dry") : "no forecast" })}
      </div>
      ${card({ variant: "panel", title: "Up the hill", kicker: "Hwy 4 by elevation, against the snow level", as: "section", class: "weather-climb", actions: moreLink(roadsUrl, "Road conditions") },
        stops.length ? html`${elevationProfile({
          label: "Hwy 4 towns by elevation with the snow level",
          summary: snow ? `Snow level ${u.elevation(snow.now)} now, as low as ${u.elevation(snow.lowest.meters)} by ${when(snow.lowest.time)}.` : "No snow level in the forecast.",
          format: u.height,
          stops: stops.map((t) => {
            const w = c?.weather.find((x) => x.locationId === t.id), o = outlooks.find((x) => x.locationId === t.id);
            return {
              label: short(t.name), elevation: t.elevationMeters, at: t.at,
              value: w ? u.temp(w.temperatureCelsius) : undefined, icon: w ? weatherIcon(w.weatherDescription) : undefined,
              detail: o && o.snowfallMm > 0 ? `${u.snow(o.snowfallMm)} snow in 24 h` : o && o.precipitationMm > 0 ? `${u.rain(o.precipitationMm)} rain in 24 h` : w ? sentence(w.weatherDescription) : undefined,
              tone: snow && t.elevationMeters >= snow.lowest.meters ? ("info" as const) : undefined,
            };
          }),
          levels: snow ? [{
            label: `Snow level now · ${u.elevation(snow.now)}`, elevation: snow.now, color: "glacier", cover: true,
            range: [snow.lowest.meters, snow.highest.meters],
            rangeLabel: snow.now - snow.lowest.meters > 150 ? `Lowest · ${u.elevation(snow.lowest.meters)} · ${when(snow.lowest.time)}` : undefined,
          }] : [],
        })}
        <p class="meta weather-climb__note">${snow ? "Snow level is the forecast for each town's grid cell, averaged; the band is its range over the next 24 hours. Filled dots are towns it reaches." : "The forecast carries no snow level right now."} Temperatures are the latest observations.</p>`
          : html`<p class="meta">${s.loaded ? "No town elevations returned." : "Loading…"}</p>`)}
      <section class="weather-map-section" aria-label="Weather map">
        <ul class="weather-legend" aria-label="Map key">
          ${alerts.map((a) => html`<li><span class="weather-key weather-key--area" style=${`--key: ${alertColor(a.severity)}`}></span>${a.headline}</li>`)}
          <li><span class="weather-key weather-key--dot" style="--key: var(--chart-lake)"></span>Town, with the temperature now</li>
        </ul>
        <div id="weather-map"></div>
      </section>
      <div class="dashboard weather-dashboard">
        ${card({ variant: "panel", title: "Hour by hour, by town", kicker: "Hourly forecast, highest town first", as: "section", class: "weather-hours" },
          forecasts.length ? html`${segmented({ name: "weather-metric", label: "Measurement", value: s.metric, onChange: (value) => store.set({ metric: value as Metric }),
              options: [{ value: "temperature", label: "Temperature" }, { value: "chance", label: "Chance of precip" }, { value: "rain", label: "Precip amount" }, { value: "snow", label: "Snowfall" }, { value: "gust", label: "Gusts" }] })}
            ${hours(s, towns, u)}` : html`<p class="meta">${s.loaded ? "No hourly forecast returned." : "Loading forecast…"}</p>`)}
        ${card({ variant: "panel", title: "Alerts", kicker: `${alerts.length} in effect or coming`, as: "section", class: "weather-alerts" },
          alerts.length ? html`<div class="feed weather-feed">${alerts.map((a) => feedItem({
              title: a.headline, href: recordUrl(a.id), level: 3,
              severity: { tone: alertTone(a.severity), label: a.status === "ACTIVE" ? sentence(a.severity.toLowerCase()) : "Coming" },
              when: sentence(alertWindow(a, s.now, when)), source: a.provenance.sourceName,
            }))}</div>`
            : html`<p class="meta">${!s.loaded ? "Loading alerts…" : s.errors.includes("weather alerts") ? "Alerts are unavailable; this is not an all-clear." : "No watches, warnings or advisories for this area."}</p>`)}
        ${card({ variant: "panel", title: `The week in ${name(s.town) || "town"}`, kicker: "Daily forecast", as: "section", class: "weather-week",
            source: selected ? `${selected.source} · issued ${when(selected.issuedAt)} PT. A forecast for the town's grid cell, not the whole corridor.` : undefined },
          html`${c ? segmented({ name: "weather-location", label: "Town", value: s.town, onChange: (value) => store.set({ town: value }),
              options: [...towns].reverse().map((t) => ({ value: t.id, label: short(t.name) })) }) : nothing}
          ${week.length ? dayStrip({ label: `Daily forecast for ${name(s.town)}`, items: week.map((d) => ({
              label: d.label, icon: weatherIcon(d.note), high: d.high === undefined ? "—" : u.temp(d.high), low: d.low === undefined ? undefined : u.temp(d.low),
              note: d.note, chance: d.chance, title: d.title })) })
            : html`<p class="meta">${s.loaded ? "No daily forecast returned for this town." : "Loading forecast…"}</p>`}`)}
        ${card({ variant: "panel", title: "Fire and burning", kicker: "Fire weather and burn day", as: "section", class: "weather-fire" },
          html`${propertyList({ label: "Fire weather and burn day", items: [
              { label: "Fire weather", value: c ? html`${badge(c.fireWeather?.state && c.fireWeather.state !== "normal" ? sentence(c.fireWeather.state.replaceAll("_", " ")) : "Normal", { tone: c.fireWeather?.state && c.fireWeather.state !== "normal" ? "alarm" : "ok" })}${c.fireWeather?.headline ? html` ${c.fireWeather.headline}` : nothing}` : undefined, missing: "Not reported" },
              ...s.burn.map((b) => { const permission = String((b.burnStatus as any)?.permission ?? ""), yes = permission === "BURN_PERMISSION_ALLOWED", no = /PROHIBITED|NOT_ALLOWED|DENIED/.test(permission); return {
                label: b.areaLabel || "Burn day", value: html`<a href=${recordUrl(b.id, "BURN_STATUS")}>${badge(yes ? "Burn day" : no ? "No burning" : "Not known", { tone: yes ? "ok" : no ? "elevated" : "muted" })}</a>${(b.burnStatus as any)?.calfireStatus === "CALFIRE_PERMIT_REQUIRED" ? " · permit required" : ""}` }; }),
            ] })}
`)}
      </div>
      <p class="meta weather-footnote" data-page-updated>Forecasts and alerts from the National Weather Service; burn day from the county burn lines and CAL FIRE. Updated ${s.updatedAt ? when(s.updatedAt) : "—"} PT, refreshes every 5 minutes.</p>`;
  }, { signal });

  // The map is built once and updated in place.
  let map: SierraGeoMap | undefined, lastKey = "", selectedId: string | undefined;
  store.subscribe((s) => {
    const host = document.getElementById("weather-map");
    if (!host || !s.loaded) return;
    const fc = mapFeatures(s);
    const key = JSON.stringify(fc.features.map((f) => f.properties));
    if (!map) {
      map = createGeoMap({ label: "Weather alert areas and the temperature in each town", data: fc as any, basemap: true, large: true, fitFocus: true, labels: true, featureList: false,
        card: (f) => mapCard(store.get(), f.properties ?? {}, recordUrl) });
      host.replaceChildren(map);
      map.addEventListener("feature-select", (e) => {
        const p = (e as CustomEvent).detail.feature.properties ?? {};
        selectedId = p.id;
        if (p.kind === "town") store.set({ town: p.ref });
      }, { signal });
      map.addEventListener("feature-clear", () => { selectedId = undefined; }, { signal });
    } else if (key !== lastKey) {
      map.data = fc as any;
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
  const tick = setInterval(() => store.set({ now: Date.now() }), 60_000);
  signal.addEventListener("abort", () => { clearInterval(refresh); clearInterval(tick); });
}

const alertColor = (severity: string) => ({ alarm: "var(--state-alarm)", elevated: "var(--chart-ochre)", muted: "var(--chart-lupine)" })[alertTone(severity)];

/** Towns × the next 48 hours for the chosen measurement. */
function hours(s: State, towns: { id: string; name: string }[], u: ReturnType<typeof units>) {
  const forecasts = s.conditions?.forecast ?? [];
  const start = Math.floor(s.now / HOUR) * HOUR;
  const times = Array.from({ length: 48 }, (_, i) => start + i * HOUR);
  const spec = {
    temperature: { title: "Temperature", pick: (p: any) => u.tempValue(p.temperatureCelsius), unit: u.tempUnit, decimals: 0, color: "ochre", lowColor: "lake", legend: ["cold", "warm"] },
    chance: { title: "Chance of precipitation", pick: (p: any) => p.precipitationProbabilityPercent, unit: "%", decimals: 0, color: "lake", min: 0, max: 100, legend: ["unlikely", "certain"] },
    rain: { title: "Rain and melted snow per hour", pick: (p: any) => (p.precipitationMm === null ? null : u.rainValue(p.precipitationMm)), unit: u.rainUnit, decimals: s.unit === "F" ? 2 : 1, color: "lake", min: 0, legend: ["dry", "wet"] },
    snow: { title: "Snowfall per hour", pick: (p: any) => (p.snowfallMm === null ? null : u.snowValue(p.snowfallMm)), unit: u.snowUnit, decimals: 1, color: "glacier", min: 0, legend: ["none", "most"] },
    gust: { title: "Wind gusts", pick: (p: any) => u.speedValue(p.windGustKmh), unit: u.speedUnit, decimals: 0, color: "lupine", min: 0, legend: ["calm", "gusty"] },
  }[s.metric] as { title: string; pick: (p: any) => number | null; unit: string; decimals: number; color: any; lowColor?: any; min?: number; max?: number; legend: [string, string] };
  // The forecast's last hour is often short of 48: drop hours no town has.
  const last = Math.max(...forecasts.flatMap((f) => f.periods.map((p) => Date.parse(p.time ?? "")).filter(Number.isFinite)), start);
  while (times.length > 1 && times.at(-1)! > last) times.pop();
  const rows = towns.flatMap((t) => {
    const f = forecasts.find((x) => x.locationId === t.id);
    if (!f) return [];
    const at = new Map(within(f.periods, start, start + 48 * HOUR).map((p) => [Date.parse(p.time ?? ""), p]));
    return [{ label: t.name.split(",")[0], values: times.map((time) => { const p = at.get(time); const v = p ? spec.pick(p) : null; return v === null || v === undefined || !Number.isFinite(v) ? null : v; }) }];
  });
  const all = rows.flatMap((r) => r.values.filter((v): v is number => v !== null));
  // A flat-zero grid (no snow anywhere) still needs a range, or every cell reads as "most".
  const max = spec.max ?? (all.length && Math.max(...all) > 0 ? undefined : 1);
  const top = rows.reduce<{ label: string; v: number } | undefined>((a, r) => { const v = Math.max(...r.values.filter((x): x is number => x !== null), -Infinity); return Number.isFinite(v) && (!a || v > a.v) ? { label: r.label, v } : a; }, undefined);
  return html`${heatmap({
    label: `${spec.title}, next 48 hours by town`,
    summary: top ? `${rows.length} towns, hourly; highest ${top.v.toFixed(spec.decimals)} ${spec.unit} at ${top.label}.` : "No values.",
    columns: times.map((time) => ({ label: `${weekday.format(time)} ${clock.format(time)}`, tick: Number(hourOf.format(time)) % 24 === 0 ? `${weekday.format(time)} ${dayNumber.format(time)}` : Number(hourOf.format(time)) === 12 ? "12:00" : undefined })),
    rows, unit: spec.unit, decimals: spec.decimals, color: spec.color, lowColor: spec.lowColor, min: spec.min, max, legend: spec.legend,
  })}`;
}

function mapFeatures(s: State) {
  const u = units(s.unit), c = s.conditions;
  const features: { type: "Feature"; geometry: any; properties: Record<string, any> }[] = [];
  // Wider, milder areas first so a warning draws over an advisory.
  for (const a of currentAlerts(s.alerts, s.now).reverse()) {
    const g = (a.geometry as any)?.object;
    if (!g || !/Polygon$/.test(g.type)) continue;
    const tone = alertTone(a.severity);
    features.push({ type: "Feature", geometry: g, properties: { id: `alert:${a.id}`, kind: "alert", ref: a.id, label: a.headline, tone: tone === "alarm" ? "alarm" : tone === "elevated" ? "ochre" : "lupine", weight: 1, opacity: tone === "alarm" ? 0.9 : 0.6, fill: tone === "alarm" ? 0.2 : 0.12, z: tone === "alarm" ? 2 : 1 } });
  }
  for (const t of c?.locations ?? []) {
    const w = c?.weather.find((x) => x.locationId === t.id);
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [t.longitude, t.latitude] }, properties: {
      id: `town:${t.id}`, kind: "town", ref: t.id, focus: true, label: short(t.name), shortLabel: `${short(t.name)} ${w ? u.temp(w.temperatureCelsius) : ""}`.trim(), tone: "lake", radius: 6, z: 5 } });
  }
  return { type: "FeatureCollection" as const, features };
}

function mapCard(s: State, p: Record<string, any>, recordUrl: (id: string) => string) {
  const u = units(s.unit), c = s.conditions;
  if (p.kind === "alert") {
    const a = s.alerts.find((x) => x.id === p.ref);
    if (!a) return nothing;
    return html`<div class="weather-card"><p class="weather-card__title">${a.headline}</p>
      <p class="weather-card__status">${badge(sentence(a.severity.toLowerCase()), { tone: alertTone(a.severity) })} ${sentence(alertWindow(a, s.now, when))} PT</p>
      ${a.summary ? html`<p class="weather-card__text">${a.summary}</p>` : nothing}
      <p class="weather-card__more"><a href=${recordUrl(a.id)}>Read the alert →</a></p></div>`;
  }
  if (p.kind === "town") {
    const t = c?.locations.find((x) => x.id === p.ref), w = c?.weather.find((x) => x.locationId === p.ref), f = c?.forecast.find((x) => x.locationId === p.ref);
    if (!t) return nothing;
    const o = f ? outlook(f, s.now) : undefined;
    return html`<div class="weather-card"><p class="weather-card__title">${short(t.name)}${t.elevationMeters !== null ? html` <span class="meta">${u.height(t.elevationMeters)}</span>` : nothing}</p>
      ${w ? reading(u.temp(w.temperatureCelsius), { condition: sentence(w.weatherDescription), icon: weatherIcon(w.weatherDescription) }) : html`<p class="meta">No observation.</p>`}
      <dl class="weather-card__facts">
        ${w ? html`<div><dt>Wind</dt><dd>${u.speed(w.windSpeedKmh)}</dd></div><div><dt>Humidity</dt><dd>${Math.round(w.humidityPercent)}%</dd></div>` : nothing}
        ${o?.hours ? html`<div><dt>Next 24 h</dt><dd>${u.temp(o.low)} to ${u.temp(o.high)}</dd></div><div><dt>Peak gust</dt><dd>${u.speed(o.gustKmh)}</dd></div>
          <div><dt>Rain</dt><dd>${u.rain(o.precipitationMm)}</dd></div><div><dt>Snow</dt><dd>${o.snowfallMm > 0 ? u.snow(o.snowfallMm) : "None"}</dd></div>` : nothing}
      </dl></div>`;
  }
  return nothing;
}
