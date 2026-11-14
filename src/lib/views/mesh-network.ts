/**
 * The mesh overview: a live map of the region's nodes and links (and, quietly,
 * where they reach beyond it) above a dense fleet dashboard: what needs
 * attention, patterns across nodes, traffic and link quality.
 */
import { nodeReportUrl } from "./mesh";
import type { Context } from "../context";
import { pageHero } from "../hero";
import { data } from "../context";
import { fmt } from "../render";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { html, nothing, repeat } from "@sierragridteam/design-system/lib/template";
import { badge, card, heatmap, segmented, sparkline, stat } from "@sierragridteam/design-system/lib/ui";
import { createGeoMap, type SierraGeoMap } from "@sierragridteam/design-system/lib/geo-map";
import { defineChartElements } from "@sierragridteam/design-system/lib/charts";
import { defineSparkline } from "@sierragridteam/design-system/lib/sparkline";
import type { V1MeshTelemetryArchive } from "@sierragridteam/sdk";
import { loadFleetArchives } from "../fleet";
import { telemetrySeries, type TelemetryMetric } from "../mesh-telemetry";
import {
  ageText, attention, errorRateRows, fleetTraffic, heatmapRows, hourBuckets, lastActive, linkStrength, linkWeight,
  nodeTone, strengthCounts, strengthTone, type Attention, type MeshLink, type MeshNode,
} from "../mesh-fleet";
import { regionTimeZone } from "../time";
import { since } from "../conditions-model";
import { monitorGroups, radios, type Radio, type Reporter } from "../mesh-monitors";

const HOUR = 3_600_000, DAYS = 7, REFRESH_MS = 60_000;
const ms = (v?: string | null) => (v ? Date.parse(v) : NaN);
const fin = (v: number) => (Number.isFinite(v) ? v : undefined);
type Hue = "lake" | "ochre" | "manzanita" | "glacier" | "pine";
type HeatMetric = TelemetryMetric | "errorRate";
const heatMetrics: { id: HeatMetric; label: string; unit: string; decimals: number; color: Hue; legend: [string, string] }[] = [
  // Battery has its own chart below, so it is not repeated here.
  { id: "packetsReceivedPerMinute", label: "Traffic", unit: "pkt/min", decimals: 1, color: "glacier", legend: ["quiet", "busy"] },
  // Errors as a share of traffic: raw error counts just follow traffic.
  { id: "errorRate", label: "Error rate", unit: "%", decimals: 0, color: "manzanita", legend: ["clean", "noisy"] },
  { id: "temperatureC", label: "Temperature", unit: "°C", decimals: 1, color: "ochre", legend: ["cool", "warm"] },
];

type State = {
  nodes: MeshNode[]; links: MeshLink[]; generatedAt: number; error: string;
  archives: Map<string, V1MeshTelemetryArchive>; archivesLoading: boolean; archivesFailed: number;
  heat: HeatMetric;
  /** Monitored radios and their reporters; read after the page is up (it takes every mesh record to find them). */
  radios: Radio[]; reporters: Reporter[]; monitors: "loading" | "ready" | "failed";
  now: number;
};

const clockTime = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const uptime = (seconds?: number | null) => (seconds === null || seconds === undefined ? "—" : seconds >= 172_800 ? `${Math.round(seconds / 86_400)} days` : `${Math.round(seconds / 3600)} h`);

/**
 * Relay and gateways: is each reporter reporting, is each gateway radio up,
 * and which radios each one reads. A host looks here for their own gateway.
 */
function relayPanel(s: State, href: (key: string) => string) {
  const groups = monitorGroups(s.radios, s.reporters, s.now);
  const gateways = groups.flatMap((g) => g.gateways), up = gateways.filter((r) => r.verdict.tone === "ok").length;
  const kicker = s.monitors === "ready" ? (gateways.length ? `${up} of ${gateways.length} gateways up · ${s.radios.length - gateways.length} repeaters read` : `${s.radios.length} radios read`) : "Who is watching the mesh";
  return card({ variant: "panel", title: "Relay and gateways", kicker, as: "section", class: "mesh-relay" },
    s.monitors === "loading" ? html`<p class="meta">Finding the relay's gateways…</p>`
    : s.monitors === "failed" ? html`<p class="meta">The relay's gateways could not be loaded. The rest of the page is current.</p>`
    : !groups.length ? html`<p class="meta">No radio is being read by a monitor right now.</p>`
    : html`<div id="relay" class="mesh-relay__groups">${groups.map((g) => html`<section class="mesh-relay__group">
        <h3 class="mesh-relay__name">${g.name}
          ${g.reporting === undefined ? nothing : badge(g.reporting ? "Reporting" : g.status === "STALE" ? "Stale" : "Not reporting", { tone: g.reporting ? "ok" : "elevated" })}
          <span class="meta">${Number.isFinite(g.lastReport) ? `last report ${since(g.lastReport, s.now)} ago` : "no report yet"}${g.every ? ` · reports about every ${g.every >= 120 ? `${Math.round(g.every / 60)} min` : "minute"}` : ""}</span></h3>
        <div class="table-scroll"><table class="table table--cards mesh-relay__table">
          <thead><tr><th scope="col">Radio</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last answer</th><th scope="col">Next read</th><th scope="col" class="mesh-relay__num">Battery</th><th scope="col" class="mesh-relay__num">Up for</th></tr></thead>
          <tbody>${[...g.gateways, ...g.repeaters].map((r) => html`<tr>
            <th scope="row"><a href=${href(r.key)}>${r.name}</a></th>
            <td data-label="Role">${r.role === "gateway" ? "Gateway" : "Repeater"}</td>
            <td data-label="Status">${badge(r.verdict.label, { tone: r.verdict.tone })}</td>
            <td data-label="Last answer">${r.verdict.detail}</td>
            <td data-label="Next read" class="mesh-relay__next">${r.verdict.due ? (r.verdict.due > s.now ? `about ${clockTime.format(r.verdict.due)} PT` : "due now") : r.verdict.tone === "alarm" ? "retrying" : g.id === "relay" ? "—" : "no fixed schedule"}</td>
            <td data-label="Battery" class="mesh-relay__num">${r.batteryVolts === null || r.batteryVolts === undefined ? "—" : `${r.batteryVolts.toFixed(2)} V`}</td>
            <td data-label="Up for" class="mesh-relay__num">${uptime(r.uptimeSeconds)}</td>
          </tr>`)}</tbody></table></div>
      </section>`)}</div>
      <p class="meta mesh-relay__note">A gateway is a radio paired with the relay; the relay reads each gateway about every 5 minutes and shared repeaters about every 30, through whichever gateway hears them. An operator's own monitor reads on its own schedule. "Not read" is not "down": no try is recorded while someone is using a gateway or its host has paused it. Which gateway reached which repeater is not published.</p>`);
}

/** The two map layers as plain nodes and links. */
function readLayers(nodeLayer: any, linkLayer: any): { nodes: MeshNode[]; links: MeshLink[] } {
  const nodes: MeshNode[] = nodeLayer.features.filter((f: any) => f.properties.mesh).map((f: any) => {
    const m = f.properties.mesh, admin = m.admin?.lastSuccessAt ? m.admin : undefined;
    return {
      key: m.publicKey, name: m.name || f.properties.headline, type: m.nodeType || "", inRegion: m.inRegion !== false,
      coordinates: f.geometry?.type === "Point" ? f.geometry.coordinates : undefined,
      lastHeardAt: fin(ms(m.lastHeardAt)), lastRelayedAt: fin(ms(m.lastRelayedAt)), reachability: m.reachability,
      admin: admin ? { lastSuccessAt: fin(ms(admin.lastSuccessAt)), batteryVolts: admin.batteryVolts, reporterId: admin.reporterId } : undefined,
    };
  });
  // The link layer carries the remote nodes it reaches (inRegion: false) as well as links.
  for (const f of linkLayer?.features ?? []) {
    const m = f.properties.mesh;
    if (m && !nodes.some((n) => n.key === m.publicKey))
      nodes.push({ key: m.publicKey, name: m.name || f.properties.headline, type: m.nodeType || "", inRegion: m.inRegion !== false, coordinates: f.geometry?.type === "Point" ? f.geometry.coordinates : undefined, lastHeardAt: fin(ms(m.lastHeardAt)), lastRelayedAt: fin(ms(m.lastRelayedAt)) });
  }
  const links: MeshLink[] = (linkLayer?.features ?? []).filter((f: any) => f.properties.meshLink && f.geometry?.type === "LineString").map((f: any) => {
    const l = f.properties.meshLink;
    return { a: l.a, b: l.b, observations: l.observations, bestSnr: l.bestSnr, lastSeen: ms(l.lastSeen), coordinates: f.geometry.coordinates };
  });
  return { nodes, links };
}

export async function mountNetwork(ctx: Context) {
  const { client, state, $, signal } = ctx;
  defineChartElements(); defineSparkline();
  const href = (key: string) => nodeReportUrl(state, key);
  const store = createStore<State>({ nodes: [], links: [], generatedAt: 0, error: "", archives: new Map(), archivesLoading: true, archivesFailed: 0, heat: "packetsReceivedPerMinute", radios: [], reporters: [], monitors: "loading", now: Date.now() });

  /** The relay's gateways are not on the map (they have no published location), so they come from the mesh records. */
  async function loadMonitors() {
    try {
      const found: Radio[] = [];
      let token = "";
      for (let page = 0; page < 12; page++) {
        const r = await data(client.listEvents({ layer: ["MESH"], pageSize: 200, geometryFormat: "NONE", ...(token ? { pageToken: token } : {}) } as any));
        if (signal.aborted) return;
        found.push(...radios(r.events as any));
        token = r.nextPageToken;
        if (!token) break;
      }
      const sources = await data(client.listSources());
      if (!signal.aborted) store.set({ radios: found, reporters: sources.sources as Reporter[], monitors: "ready", now: Date.now() });
    } catch { if (!signal.aborted && store.get().monitors === "loading") store.set({ monitors: "failed" }); }
  }

  async function loadLayers() {
    const [nodeLayer, linkLayer] = await Promise.allSettled([data(client.getMapLayer(state.place, "mesh_node")), data(client.getMapLayer(state.place, "mesh_link"))]);
    if (signal.aborted) return;
    if (nodeLayer.status === "rejected") { if (!store.get().nodes.length) store.set({ error: "Mesh nodes could not load." }); return; }
    const { nodes, links } = readLayers(nodeLayer.value, linkLayer.status === "fulfilled" ? linkLayer.value : null);
    store.set({ nodes, links, generatedAt: ms(nodeLayer.value.metadata.generatedAt), error: linkLayer.status === "rejected" ? "Connections could not load; nodes are shown." : "", now: Date.now() });
  }

  // A chart keeps the same props object until its data changes (new archives or a new hour),
  // so the 10-second clock tick does not rebuild charts, drop legend focus or close an open data table.
  const chartMemo = new Map<string, { key: unknown[]; props: unknown }>();
  const chartProps = <T,>(name: string, s: State, build: () => T): T => {
    const key = [s.archives, Math.floor(s.now / HOUR), s.nodes];
    const hit = chartMemo.get(name);
    if (hit && hit.key.every((k, i) => k === key[i])) return hit.props as T;
    const props = build();
    chartMemo.set(name, { key, props });
    return props;
  };
  $("content").innerHTML = `<div id="mesh-page"></div>`;
  let map: SierraGeoMap | undefined;
  region($("mesh-page"), store, (s) => {
    const regional = s.nodes.filter((n) => n.inRegion);
    const keys = new Set(regional.map((n) => n.key));
    const internal = s.links.filter((l) => keys.has(l.a) && keys.has(l.b));
    const beyond = s.links.filter((l) => keys.has(l.a) !== keys.has(l.b));
    const remote = new Set(beyond.map((l) => (keys.has(l.a) ? l.b : l.a)));
    const live = regional.filter((n) => { const t = lastActive(n, s.now); return t !== undefined && s.now - t <= HOUR; });
    const lastRelay = Math.max(...regional.map((n) => n.lastRelayedAt ?? -Infinity).filter((t) => t <= s.now));
    const issues = attention(s.nodes, s.archives, s.now);
    const issueOf = new Map(issues.map((a) => [a.node.key, a]));
    const buckets = hourBuckets(s.now, DAYS);
    // Nodes whose packet counter never moves (firmware that does not count) would drag the median to 0.
    const trafficRows = heatmapRows(regional, s.archives, "packetsReceivedPerMinute", buckets).filter((r) => r.values.some((v) => v !== null && v > 0));
    // Complete hours only: the current hour has a few early reports at most.
    const complete = buckets.filter((t) => t + HOUR <= s.now);
    const traffic = fleetTraffic(trafficRows, complete);
    const latestTraffic = [...traffic].reverse().find((t) => t.value !== null);
    const strengths = strengthCounts([...internal, ...beyond]);
    const monitored = regional.filter((n) => n.admin);
    return html`
      ${pageHero({ kicker: "SIERRA mesh · Ebbetts Pass", title: "Mesh network",
        lead: html`<span class="mesh-live">${Number.isFinite(lastRelay) ? html`<span class="live-dot" aria-hidden="true"></span><strong>Live</strong> · last relay ${ageText(s.now - lastRelay)} ago · ${live.length} of ${regional.length} nodes active in the last hour` : html`Waiting for mesh activity…`}</span>` })}
      ${s.error ? html`<p class="callout">${s.error}</p>` : nothing}
      <div class="stats stats--compact mesh-kpis">
        ${stat({ label: "Nodes in the region", value: String(regional.length || "—"), sub: `${live.length} active · ${monitored.length} monitored` })}
        ${stat({ label: "Links · 72 h", value: String(internal.length + beyond.length || "—"), sub: `${internal.length} regional · ${beyond.length} to ${remote.size} nodes beyond` })}
        ${stat({ label: "Packets per node", value: latestTraffic ? `${latestTraffic.value!.toFixed(0)}/min` : s.archivesLoading ? "…" : "—", sub: latestTraffic ? `heard by the median node, last full hour · ${latestTraffic.reporting} nodes counting` : "from monitored nodes" })}
        ${stat({ label: "Link quality", value: s.links.length ? `${Math.round((strengths.strong / Math.max(1, s.links.length)) * 100)}% strong` : "—", sub: `${strengths.strong} strong · ${strengths.fair} fair · ${strengths.weak} weak` })}
        ${stat({ label: "Needs attention", value: String(issues.length), sub: issues[0] ? `${issues[0].node.name.replace(/^SIERRA /, "")}: ${issues[0].issues[0].text.toLowerCase()}` : s.archivesLoading ? "checking monitor readings…" : "all nodes look healthy" })}
      </div>
      <section class="mesh-map-section" aria-label="Mesh map">
        <div class="mesh-map-bar">
          <ul class="mesh-legend" aria-label="Map key">
            <li><span class="mesh-key mesh-key--line" style="--key: var(--chart-pine)"></span>Strong link</li>
            <li><span class="mesh-key mesh-key--line" style="--key: var(--chart-ochre)"></span>Fair</li>
            <li><span class="mesh-key mesh-key--line" style="--key: var(--chart-manzanita)"></span>Weak</li>
            <li><span class="mesh-key mesh-key--weight"></span>Thicker: more traffic</li>
            <li><span class="mesh-key mesh-key--pulse"></span>Active in the last hour</li>
          </ul>
        </div>
        <div id="mesh-network-map"></div>
      </section>
      <div class="dashboard mesh-dashboard">
        ${card({ variant: "panel", title: "Needs attention", kicker: `${issues.length} of ${regional.length} nodes`, class: "mesh-attention", as: "section" },
          issues.length ? html`<ol class="mesh-issues">${repeat(issues, (a) => a.node.key, (a) => html`<li>
            <div class="mesh-issues__head">${badge(a.worst === "alarm" ? "Investigate" : "Watch", { tone: a.worst === "alarm" ? "alarm" : "elevated" })}<a href=${href(a.node.key)}>${a.node.name}</a></div>
            <ul class="mesh-issues__why">${a.issues.map((i) => html`<li class=${i.severity}>${i.text}</li>`)}</ul></li>`)}</ol>`
            : html`<p class="meta">${s.archivesLoading ? "Checking monitor readings…" : "No node needs attention. Activity and monitor readings are within normal ranges."}</p>`)}
        ${heatPanel(s, regional, buckets, issueOf, (heat) => store.set({ heat }))}
        ${card({ variant: "panel", title: "Mesh traffic", kicker: "Packets heard/min by the median monitored node", as: "section", class: "mesh-traffic" },
          traffic.some((t) => t.value !== null)
            ? html`<sierra-line-chart class="ds-chart--quiet" .props=${chartProps("traffic", s, () => ({ label: "Mesh traffic, last 7 days", unit: "pkt/min", decimals: 0, timeZone: regionTimeZone, zero: true, height: 200, timeDomain: [buckets[0], buckets.at(-1)! + HOUR], series: [{ id: "traffic", label: "Median node", color: "glacier", area: true, points: traffic.map((t) => ({ time: t.time, value: t.value })) }] }))}></sierra-line-chart>`
            : html`<p class="meta">${s.archivesLoading ? "Loading monitor readings…" : "No monitor readings in the last 7 days."}</p>`)}
        ${card({ variant: "panel", title: "Battery", kicker: "Monitored nodes, last 7 days", as: "section", class: "mesh-battery" },
          s.archives.size
            ? html`<sierra-line-chart class="ds-chart--quiet" .props=${chartProps("battery", s, () => ({ label: "Battery voltage by node, last 7 days", unit: "V", decimals: 2, timeZone: regionTimeZone, height: 200, timeDomain: [buckets[0], buckets.at(-1)! + HOUR], series: heatmapRows(monitored, s.archives, "batteryVolts", buckets).map((r) => ({ id: r.node.key, label: r.node.name.replace(/^SIERRA /, ""), points: buckets.map((time, i) => ({ time, value: r.values[i] })) })) }))}></sierra-line-chart>`
            : html`<p class="meta">${s.archivesLoading ? "Loading monitor readings…" : "No monitor readings."}</p>`)}
        ${relayPanel(s, href)}
        ${card({ variant: "panel", title: "Strongest links", kicker: "Most traffic in 72 h", as: "section", class: "mesh-links" }, linkTable(s, keys))}
        ${card({ variant: "panel", title: "Nodes", kicker: `${regional.length} in the region`, as: "section", class: "mesh-nodes" }, nodeTable(s, regional, issueOf, href))}
      </div>
      <p class="meta mesh-footnote" data-page-updated>Links are relays the mesh observed, not guaranteed coverage; a missing observation does not mean a node is down. Updated ${fmt(s.generatedAt)}, refreshing every minute.</p>`;
  }, { signal });

  /** The map keeps its instance; new data updates its sources (no rebuild, no refit). */
  function features(s: State) {
    const keys = new Set(s.nodes.filter((n) => n.inRegion).map((n) => n.key));
    const issueOf = new Map(attention(s.nodes, s.archives, s.now).map((a) => [a.node.key, a]));
    const busiest = Math.max(1, ...s.links.map((l) => l.observations));
    const named = new Map(s.nodes.map((n) => [n.key, n.name]));
    const linkFeatures = s.links.flatMap((l) => {
      const inside = keys.has(l.a) && keys.has(l.b), touches = keys.has(l.a) || keys.has(l.b);
      if (!touches) return [];
      const strength = linkStrength(l.bestSnr);
      return [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: l.coordinates }, properties: {
        id: `link:${l.a}:${l.b}`, kind: "link", a: l.a, b: l.b, label: `${named.get(l.a) ?? "Node"} ↔ ${named.get(l.b) ?? "node"}`,
        // Beyond-region links are context: thin, grey and faint, under everything regional.
        tone: inside ? strengthTone[strength] : "muted", weight: inside ? linkWeight(l.observations, busiest) : 0.6, opacity: inside ? 0.8 : 0.16, z: inside ? 3 : 1,
        flow: inside && s.now - l.lastSeen <= HOUR,
      } }];
    });
    const remoteShown = new Set(linkFeatures.flatMap((f) => [f.properties.a, f.properties.b]).filter((k) => !keys.has(k)));
    const nodeFeatures = s.nodes.filter((n) => n.coordinates && (keys.has(n.key) || remoteShown.has(n.key))).map((n) => {
      const inside = keys.has(n.key), active = lastActive(n, s.now);
      return { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: n.coordinates! }, properties: {
        id: `node:${n.key}`, kind: "node", key: n.key,
        ...(inside ? { label: n.name.replace(/^SIERRA /, ""), focus: true } : {}),
        tone: inside ? nodeTone(n, issueOf.get(n.key), s.now) : "muted",
        radius: inside ? 7 : 3, opacity: inside ? 1 : 0.55, z: inside ? 5 : 2,
        pulse: inside && active !== undefined && s.now - active <= HOUR,
      } };
    });
    return { type: "FeatureCollection" as const, features: [...linkFeatures, ...nodeFeatures] };
  }
  // The selection is kept by feature id, since indices shift when data or the scope changes.
  let lastMapKey = "", selectedId: string | undefined;
  store.subscribe((s) => {
    const host = document.getElementById("mesh-network-map");
    if (!host || !s.nodes.length) return;
    const fc = features(s);
    const key = JSON.stringify(fc.features.map((f) => f.properties));
    if (!map) {
      map = createGeoMap({ label: "Mesh nodes in the region, their links, and links beyond the region", data: fc, basemap: true, large: true, fitFocus: true, labels: true, featureList: false,
        card: (f) => mapCard(store.get(), f.properties ?? {}, href) });
      host.replaceChildren(map);
      map.addEventListener("feature-select", (event) => { selectedId = (event as CustomEvent).detail.feature.properties?.id; }, { signal });
      map.addEventListener("feature-clear", () => { selectedId = undefined; }, { signal });
    } else if (key !== lastMapKey) {
      map.data = fc;
      const index = selectedId ? fc.features.findIndex((f) => f.properties.id === selectedId) : -1;
      map.selected = index >= 0 ? index : undefined;
      if (index < 0) selectedId = undefined;
    } else if (selectedId) map.update({}); // refresh the open card's ages
    lastMapKey = key;
  }, { signal });

  await loadLayers();
  // Left during the first load: start nothing that would outlive the page.
  if (signal.aborted) return;
  void loadMonitors();
  // Fleet telemetry loads after the map (one archive per monitored node, 7 days).
  const monitored = store.get().nodes.filter((n) => n.inRegion && n.admin);
  const to = new Date(), from = new Date(to.getTime() - DAYS * 24 * HOUR);
  void loadFleetArchives(monitored.map((n) => ({ key: n.key, name: n.name })), (node) => data(client.getMeshTelemetry({ node: node.key, from: from.toISOString(), to: to.toISOString() })))
    .then((results) => {
      if (signal.aborted) return;
      const archives = new Map<string, V1MeshTelemetryArchive>();
      for (const r of results) if (r.status === "fulfilled") archives.set(r.node.key, r.archive);
      store.set({ archives, archivesLoading: false, archivesFailed: results.filter((r) => r.status === "rejected").length, now: Date.now() });
    });
  // Alive: the clock ticks every 10 s; nodes and links refresh every minute.
  const tick = setInterval(() => store.set({ now: Date.now() }), 10_000);
  const refresh = setInterval(() => void loadLayers(), REFRESH_MS);
  // Gateways and reporters refresh less often: it takes every mesh record to find them.
  const monitors = setInterval(() => void loadMonitors(), 15 * REFRESH_MS);
  signal.addEventListener("abort", () => { clearInterval(tick); clearInterval(refresh); clearInterval(monitors); });
}

/** The card over the map for a clicked node or link. */
function mapCard(s: State, p: Record<string, any>, href: (key: string) => string) {
  const named = (key: string) => s.nodes.find((n) => n.key === key);
  const short = (key: string) => (named(key)?.name ?? key.slice(0, 6)).replace(/^SIERRA /, "");
  const linksOf = (key: string) => s.links.filter((l) => l.a === key || l.b === key);
  if (p.kind === "link") {
    const l = s.links.find((x) => x.a === p.a && x.b === p.b);
    if (!l) return nothing;
    const strength = linkStrength(l.bestSnr), inside = !!(named(l.a)?.inRegion && named(l.b)?.inRegion);
    return html`<div class="mesh-card">
      <p class="mesh-card__title">${short(l.a)} ↔ ${short(l.b)}</p>
      <p class="mesh-card__status"><span class="mesh-dot" style=${`--key: ${inside ? `var(--chart-${strengthTone[strength]})` : "var(--ink-muted)"}`}></span>${strength[0].toUpperCase() + strength.slice(1)} link${inside ? "" : " · leaves the region"}</p>
      <dl class="mesh-card__facts">
        <div><dt>Best SNR</dt><dd>${l.bestSnr.toFixed(1)} dB</dd></div>
        <div><dt>Relays · 72 h</dt><dd>${l.observations.toLocaleString()}</dd></div>
        <div><dt>Last seen</dt><dd>${ageText(s.now - l.lastSeen)} ago</dd></div>
      </dl>
    </div>`;
  }
  const n = named(p.key);
  if (!n) return nothing;
  const active = lastActive(n, s.now);
  const activeText = active !== undefined ? `${ageText(s.now - active)} ago` : "—";
  if (!n.inRegion)
    return html`<div class="mesh-card">
      <p class="mesh-card__title">${n.name}</p>
      <p class="mesh-card__status"><span class="mesh-dot" style="--key: var(--ink-muted)"></span>Beyond the region</p>
      <dl class="mesh-card__facts">
        <div><dt>Last active</dt><dd>${activeText}</dd></div>
        <div><dt>Links here</dt><dd>${linksOf(n.key).length}</dd></div>
      </dl>
    </div>`;
  const issue = attention(s.nodes, s.archives, s.now).find((a) => a.node.key === n.key);
  const tone = nodeTone(n, issue, s.now);
  const archive = s.archives.get(n.key);
  const battery = archive ? telemetrySeries(archive, "batteryVolts").latest : undefined;
  const traffic = archive ? telemetrySeries(archive, "packetsReceivedPerMinute").summary?.value : undefined;
  const status = issue ? (issue.worst === "alarm" ? "Needs investigation" : "Worth watching") : tone === "pine" ? "Active in the last hour" : "Quiet";
  return html`<div class="mesh-card">
    <p class="mesh-card__title">${n.name}</p>
    <p class="mesh-card__status"><span class="mesh-dot" style=${`--key: ${tone === "alarm" ? "var(--signal-orange)" : tone === "muted" ? "var(--ink-muted)" : `var(--chart-${tone})`}`}></span>${status}</p>
    <dl class="mesh-card__facts">
      <div><dt>Last active</dt><dd>${activeText}</dd></div>
      <div><dt>Links</dt><dd>${linksOf(n.key).length}</dd></div>
      ${battery !== undefined ? html`<div><dt>Battery</dt><dd>${battery.toFixed(2)} V</dd></div>` : nothing}
      ${traffic !== undefined ? html`<div><dt>Traffic · 7 d</dt><dd>${traffic.toFixed(0)}/min</dd></div>` : nothing}
      <div><dt>Monitor</dt><dd>${n.admin ? (n.reachability === "UNREACHABLE" ? "Can't reach it" : "Reachable") : "None"}</dd></div>
    </dl>
    ${issue ? html`<ul class="mesh-issues__why mesh-card__issues">${issue.issues.map((i) => html`<li class=${i.severity}>${i.text}</li>`)}</ul>` : nothing}
    <p class="mesh-card__more"><a href=${href(n.key)}>Node report →</a></p>
  </div>`;
}

function heatPanel(s: State, regional: MeshNode[], buckets: number[], issueOf: Map<string, Attention>, onHeat: (metric: HeatMetric) => void) {
  const metric = heatMetrics.find((m) => m.id === s.heat) ?? heatMetrics[0];
  const rows = metric.id === "errorRate" ? errorRateRows(regional, s.archives, buckets) : heatmapRows(regional, s.archives, metric.id, buckets);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, weekday: "short" });
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: regionTimeZone, hour: "numeric", hourCycle: "h23" });
  const columns = buckets.map((t) => ({ label: fmt(t), tick: Number(hour.format(t)) % 24 === 0 ? day.format(t) : undefined }));
  return card({ variant: "panel", title: "Fleet patterns", kicker: "Hourly, last 7 days", as: "section", class: "mesh-heat",
    actions: segmented({ name: "mesh-heat", label: "Measurement", options: heatMetrics.map((m) => ({ value: m.id, label: m.label })), value: metric.id, onChange: (v) => onHeat(v as HeatMetric) }) },
    rows.length
      ? heatmap({ label: `${metric.label} by node, hourly`, summary: `${rows.length} nodes over ${DAYS} days.`,
          columns, rows: rows.map((r) => ({ label: r.node.name.replace(/^SIERRA /, ""), values: r.values, note: issueOf.get(r.node.key)?.worst === "alarm" ? "●" : undefined })),
          unit: metric.unit, decimals: metric.decimals, color: metric.color, legend: metric.legend })
      : html`<p class="meta">${s.archivesLoading ? "Loading monitor readings…" : "No monitor readings in the last 7 days."}</p>`);
}

function linkTable(s: State, keys: Set<string>) {
  const named = (key: string) => (s.nodes.find((n) => n.key === key)?.name ?? key.slice(0, 6)).replace(/^SIERRA /, "");
  const top = [...s.links].filter((l) => keys.has(l.a) || keys.has(l.b)).sort((a, b) => b.observations - a.observations).slice(0, 8);
  if (!top.length) return html`<p class="meta">No links observed in 72 h.</p>`;
  return html`<div class="table-scroll"><table class="table mesh-table mesh-link-table"><thead><tr><th scope="col">Link</th><th scope="col">Relays</th><th scope="col">Best SNR</th></tr></thead><tbody>
    ${top.map((l) => html`<tr><th scope="row"><span class="mesh-cell"><span class="mesh-dot" style=${`--key: var(--chart-${strengthTone[linkStrength(l.bestSnr)]})`}></span><span>${named(l.a)} ↔ ${named(l.b)}${keys.has(l.a) && keys.has(l.b) ? nothing : html` <span class="mesh-beyond">beyond</span>`}</span></span></th><td>${l.observations.toLocaleString()}</td><td>${l.bestSnr.toFixed(1)} dB</td></tr>`)}
  </tbody></table></div>`;
}

function nodeTable(s: State, regional: MeshNode[], issueOf: Map<string, Attention>, href: (key: string) => string) {
  const rows = [...regional].sort((a, b) => (issueOf.get(a.key) ? (issueOf.get(a.key)!.worst === "alarm" ? 0 : 1) : 2) - (issueOf.get(b.key) ? (issueOf.get(b.key)!.worst === "alarm" ? 0 : 1) : 2) || (lastActive(b, s.now) ?? 0) - (lastActive(a, s.now) ?? 0));
  const linksOf = (key: string) => s.links.filter((l) => l.a === key || l.b === key).length;
  return html`<div class="table-scroll"><table class="table mesh-table"><thead><tr><th scope="col">Node</th><th scope="col">Last active</th><th scope="col">Battery · 7 d</th><th scope="col">Traffic</th><th scope="col">Links</th><th scope="col">Monitor</th></tr></thead>
    <tbody id="mesh-node-rows">${repeat(rows, (n) => n.key, (n) => {
      const archive = s.archives.get(n.key), active = lastActive(n, s.now);
      const battery = archive ? telemetrySeries(archive, "batteryVolts") : undefined;
      const traffic = archive ? telemetrySeries(archive, "packetsReceivedPerMinute") : undefined;
      const tone = nodeTone(n, issueOf.get(n.key), s.now);
      return html`<tr>
        <th scope="row"><span class="mesh-dot" style=${`--key: ${tone === "alarm" ? "var(--signal-orange)" : tone === "muted" ? "var(--ink-muted)" : `var(--chart-${tone})`}`}></span><a href=${href(n.key)}>${n.name}</a></th>
        <td>${active ? `${ageText(s.now - active)} ago` : "—"}</td>
        <td class="mesh-spark-cell">${battery?.latest !== undefined ? html`<span>${battery.latest.toFixed(2)} V</span>${sparkline({ label: `${n.name} battery, 7 days`, values: battery.points.map((p) => p.value), unit: "V", decimals: 2, color: "lake", width: 120, height: 24 })}` : n.admin ? "…" : "—"}</td>
        <td>${traffic?.summary ? `${traffic.summary.value.toFixed(0)}/min` : "—"}</td>
        <td>${linksOf(n.key)}</td>
        <td>${n.admin ? (n.reachability === "UNREACHABLE" ? html`<span class="mesh-warn">Unreachable</span>` : "Reachable") : html`<span class="meta">—</span>`}</td>
      </tr>`;
    })}</tbody></table></div>`;
}
