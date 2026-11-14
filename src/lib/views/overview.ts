import type { V1Conditions, V1PlaceSummary } from "@sierragridteam/sdk";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { html, nothing, repeat } from "@sierragridteam/design-system/lib/template";
import { summaryBanner, card, moreLink, badge, segmented, choiceTiles, reading, messageSign, stat } from "@sierragridteam/design-system/lib/ui";
import { defineChartElements } from "@sierragridteam/design-system/lib/charts";
import { urlState } from "@sierragridteam/design-system/lib/app";
import { param } from "@sierragridteam/design-system/lib/url-state";
import type { Context } from "../context";
import { data } from "../context";
import { attentionFor } from "../attention";
import { fmt } from "../render";
import { stateUrl, defaults } from "../state";
import { mountRoadOverview } from "./road-map";
import { weatherPreferences, rememberWeather, temperature, temperatureText, resolved, weatherIconName, type TemperatureUnit } from "../weather-display";
import { regionTimeZone } from "../time";
import { headlineCounts, type Report } from "../event-model";
/** Mesh node records are network observations, not events; the mesh has its own stat. */
const eventsOnly = (reports: Report[]) => reports.filter(report => report.layer !== "MESH");

import type { RoadLayer, RoadFeature } from "./road-map-model";
const signText = (f: RoadFeature) => (f.properties.messageSign?.pages ?? []).some(page => page.some(line => line.trim()));
/** Corridor route first, then the rest by route. */
const signOrder = (a: RoadFeature, b: RoadFeature) => Number(b.properties.messageSign?.route === "SR-4") - Number(a.properties.messageSign?.route === "SR-4") || String(a.properties.messageSign?.route).localeCompare(String(b.properties.messageSign?.route));
type Overview = {
  events: Report[] | null; partial: boolean; eventError: boolean; summary?: V1PlaceSummary; summaryError: boolean;
  conditions?: V1Conditions; weatherError: boolean; location: string; unit: TemperatureUnit;
  signs?: RoadLayer; signError: boolean;
  mesh?: { nodes: number; links: number; window: string }; meshError: boolean;
  totals?: { events: number; revisions: number; sources: number; since?: string | null }; totalsError?: boolean;
};
export async function mount(ctx: Context) {
  defineChartElements();
  const prefs = weatherPreferences(), { signal } = ctx;
  const location = urlState({ weatherLocation: param.string("") }, { signal });
  const store = createStore<Overview>({ events: null, partial: false, eventError: false, summaryError: false, weatherError: false, location: ctx.state.weatherLocation || prefs.location, unit: prefs.unit, signError: false, meshError: false });
  // A link to another page carries no filter from this one: Events opens on every type.
  const currentUrl = (topic: typeof ctx.state.topic) => stateUrl({ ...ctx.state, ...defaults(topic), topic, layer: "ALL", eventStatus: "current", severity: "", record: "", revision: "", timeExplicit: false });
  const current = (s: Overview) => s.conditions?.weather.find(w => w.locationId === s.location);
  const forecast = (s: Overview) => s.conditions?.forecast.find(f => f.locationId === s.location);
  const start = Date.now(), end = start + 86400000;
  const periods = (s: Overview) => (forecast(s)?.periods || []).filter(p => Date.parse(p.time || "") >= start && Date.parse(p.time || "") < end);
  const choose = (unit: TemperatureUnit, selected: string) => {
    ctx.state.weatherLocation = selected;
    location.set({ weatherLocation: selected });
    rememberWeather(unit, selected);
    store.set({ unit, location: selected });
  };
  location.subscribe(s => { if (s.weatherLocation) { ctx.state.weatherLocation = s.weatherLocation; store.set({ location: s.weatherLocation }); } }, { signal });
  region(ctx.$("overview-summary"), store, s => {
    const count = s.events ? headlineCounts(eventsOnly(s.events), s.partial) : null;
    const attention = s.summary ? attentionFor(s.summary) : undefined;
    return summaryBanner({ kicker: "Ebbetts Pass Corridor", level: 1,
      headline: count ? `${count.first} ${count.second}` : s.eventError ? "Current event counts are unavailable." : "Checking the latest reports across the corridor.",
      meta: count ? `${count.active} active · ${count.scheduled} scheduled${s.partial ? " · partial count" : ""}` : "Live source reports, regional conditions and observations.",
      asideTitle: "Highest severity now",
      aside: html`<div id="attention" aria-label="Needs attention" aria-busy=${String(!attention && !s.summaryError)}>${attention ? html`
        ${attention.items.length ? html`<ul>${repeat(attention.items, item => item.id, item => html`<li>${badge(item.severity, { tone: item.rank >= 3 ? "alarm" : "elevated" })}<a href=${item.record ? stateUrl({ ...ctx.state, ...defaults("events"), topic: "events", layer: "ALL", eventStatus: "current", severity: "", record: item.record, revision: "", timeExplicit: false }) : currentUrl(item.view)}>${item.headline}</a>${item.health !== "OK" ? html`<span>Last known · source ${item.health.toLowerCase()}</span>` : nothing}</li>`)}</ul>` : html`<p>${attention.complete ? "No elevated reports in the current summary." : "Current attention is uncertain because some source coverage is unavailable."}</p>`}
        ${!attention.complete ? html`<p>Some source coverage is incomplete. Check the relevant sources.</p>` : nothing}`
        : s.summaryError ? html`<p>Current reports could not be checked.</p><button class="btn btn--outline" data-retry>Retry current reports</button>` : html`<p>Checking current reports…</p>`}
        ${moreLink(currentUrl("events"), "Browse all events")}</div>`,
    });
  }, { signal });
  region(ctx.$("overview-stats"), store, s => {
    const events = s.events ? eventsOnly(s.events) : null, counts = events ? headlineCounts(events, s.partial) : null;
    return html`<div class="stats">
      ${stat({ label: "Active events", value: counts ? `${s.partial ? "≥ " : ""}${counts.active}` : "—", sub: counts ? `${counts.scheduled} scheduled separately` : "Waiting for source reports", href: currentUrl("events"), actionLabel: "Browse events" })}
      ${stat({ label: "Mesh nodes heard", value: s.mesh ? s.mesh.nodes.toLocaleString() : "—", sub: s.mesh ? `${s.mesh.links.toLocaleString()} links · last ${s.mesh.window}` : s.meshError ? "Network observations unavailable" : "Reading the network…", href: currentUrl("mesh"), actionLabel: "Inspect the network" })}
      ${stat({ label: "Reports on record", value: s.totals ? s.totals.events.toLocaleString() : s.totalsError ? "—" : "…",
        sub: s.totals ? `${s.totals.revisions.toLocaleString()} saved updates from ${s.totals.sources} sources${s.totals.since ? ` since ${fmt(s.totals.since).split(",")[0]}` : ""}` : s.totalsError ? "The record's totals are unavailable" : "Counting the record…",
        href: stateUrl({ ...ctx.state, ...defaults("events"), topic: "events", layer: "ALL", eventStatus: "all", severity: "", record: "", revision: "", timeExplicit: false }), actionLabel: "Browse every report, past and present" })}
    </div>`;
  }, { signal });
  region(ctx.$("overview-weather-panel"), store, s => {
    const weather = current(s), outlook = forecast(s), name = weather?.locationName || s.location;
    return card({ variant: "panel", title: "Weather", kicker: "Looking ahead", actions: moreLink(currentUrl("weather"), "Forecast"), source: outlook ? `${outlook.source} · issued ${fmt(outlook.issuedAt)}. Forecast for ${name}; temperatures vary across the region.` : undefined },
      s.conditions ? html`
        <div class="cluster cluster--between">${reading(weather ? temperatureText(weather.temperatureCelsius, s.unit) : "—", { condition: weather?.weatherDescription || "No current reading", icon: weather ? weatherIconName(weather.weatherDescription) : undefined })}${segmented({ name: "overview-unit", label: "Temperature unit", options: [{ value: "F", label: "°F" }, { value: "C", label: "°C" }], value: s.unit, onChange: value => choose(value as TemperatureUnit, s.location) })}</div>
        ${outlook ? html`<sierra-line-chart id="overview-chart" .props=${{ label: `Next 24 hours · ${name.split(",")[0]}`, unit: `°${s.unit}`, decimals: 0, timeZone: regionTimeZone, series: [{ id: s.location, label: name, area: true, points: periods(s).map(p => ({ time: Date.parse(p.time || ""), value: resolved(p.temperatureCelsius) ? temperature(p.temperatureCelsius, s.unit) : null })) }] }}></sierra-line-chart>` : html`<p>No forecast returned for this location.</p>`}
        ${choiceTiles({ name: "overview-location", label: "Reporting location", size: "compact", value: s.location, options: s.conditions.weather.map(w => ({ value: w.locationId, label: w.locationName.split(",")[0], icon: weatherIconName(w.weatherDescription), detail: temperatureText(w.temperatureCelsius, s.unit) })), onChange: value => choose(s.unit, value) })}`
        : html`<p>${s.weatherError ? "Forecast unavailable. Open weather to inspect source coverage." : "Loading the regional forecast…"}</p>`);
  }, { signal });
  region(ctx.$("overview-signs"), store, s => {
    if (!s.signs) return html`<p>${s.signError ? "Message signs are unavailable. Road reports remain available." : "Reading highway signs…"}</p>`;
    const signs = [...s.signs.features].sort(signOrder), showing = signs.filter(signText), blank = signs.filter(f => !signText(f));
    const since = (f: RoadFeature) => f.properties.effective ? `Showing since ${fmt(f.properties.effective)}` : undefined;
    return html`<div class="stack">
      ${showing.length ? html`<div class="columns" style="--column-min: 240px">${repeat(showing, f => f.properties.id, f => messageSign({ location: f.properties.areaLabel || f.properties.headline, route: f.properties.messageSign?.route, direction: f.properties.messageSign?.direction, pages: f.properties.messageSign?.pages, inService: f.properties.messageSign?.inService, detail: since(f) }))}</div>` : html`<p>No corridor sign is showing a message.</p>`}
      <p class="meta">${blank.length ? `Blank: ${blank.map(f => f.properties.areaLabel).join(" · ")}. ` : ""}${s.signs.metadata.attribution} · checked ${fmt(s.signs.metadata.generatedAt)}.</p>
    </div>`;
  }, { signal });
  await Promise.allSettled([
    mountRoadOverview(ctx, ctx.$("overview-map"), ctx.$("overview-road-key")),
    data(ctx.client.listEvents({ place: ctx.state.place, pageSize: 200, geometryFormat: "NONE" } as any)).then(result => { if (!signal.aborted) store.set({ events: result.events, partial: !!result.nextPageToken }); }, () => { if (!signal.aborted) store.set({ eventError: true }); }),
    data(ctx.client.getPlaceSummary(ctx.state.place)).then(summary => { if (!signal.aborted) store.set({ summary }); }, () => { if (!signal.aborted) store.set({ summaryError: true }); }),
    data(ctx.client.getConditions({ place: ctx.state.place })).then(conditions => {
      if (signal.aborted) return;
      // Choose from every location with a reading or a forecast, so a missing forecast still shows current weather.
      const ids = [...new Set([...conditions.forecast.map(f => f.locationId), ...conditions.weather.map(w => w.locationId)])];
      const selected = ids.includes(store.get().location) ? store.get().location : ids.includes("arnold") ? "arnold" : ids[0] || "";
      store.set({ conditions }); choose(store.get().unit, selected);
    }, () => { if (!signal.aborted) store.set({ weatherError: true }); }),
    data(ctx.client.listMeshLinks()).then(result => {
      if (signal.aborted) return;
      const nodes = new Set(result.links.flatMap(link => [link.a, link.b]));
      store.set({ mesh: { nodes: nodes.size, links: result.links.length, window: result.window || "72h" } });
    }, () => { if (!signal.aborted) store.set({ meshError: true }); }),
    data(ctx.client.getStats({ place: ctx.state.place })).then(t => { if (!signal.aborted) store.set({ totals: { events: Number(t.events), revisions: Number(t.revisions), sources: Number(t.sources), since: t.since } }); }, () => { if (!signal.aborted) store.set({ totalsError: true }); }),
    data(ctx.client.getMapLayer(ctx.state.place, "message_sign")).then(signs => { if (!signal.aborted) store.set({ signs }); }, () => { if (!signal.aborted) store.set({ signError: true }); }),
  ]);
}
