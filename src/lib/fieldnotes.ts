import { createExplorerContext } from "./client";
import type {
  ApiResult,
  EventQuery,
  MapLayer,
  V1Event,
  V1Conditions,
} from "@sierragridteam/sdk";
import { renderTimeSeries } from "@sierragridteam/design-system/lib/time-series-render";
type PublicLayer = NonNullable<EventQuery["layer"]>[number];
const { client } = createExplorerContext();
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const safeUrl = (v: unknown) => {
  try {
    const u = new URL(String(v));
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
};
const time = (v: unknown) =>
  v
    ? new Date(String(v)).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not reported";
const human = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
const units: Record<string, string> = {
  temperatureCelsius: "°C",
  feelsLikeCelsius: "°C",
  temperatureC: "°C",
  humidityPercent: "%",
  humidity: "%",
  windSpeedKmh: "km/h",
  windGustKmh: "km/h",
  peakWindGustKmh: "km/h",
  windDirectionDegrees: "° from north",
  visibilityKm: "km",
  depthKm: "km",
  acres: "acres",
  containmentPercent: "%",
  containment: "%",
  batteryVolts: "V",
  batteryPercent: "%",
  pressure: "hPa",
  rssi: "dBm",
  snr: "dB",
  bestSnr: "dB",
  noiseFloorDbm: "dBm",
  lastRssiDbm: "dBm",
  lastSnrDb: "dB",
  uptimeSeconds: "seconds since boot",
  airtimeMs: "ms since boot",
  rxAirtimeMs: "ms since boot",
  elevationFeet: "ft",
  distanceMeters: "m",
  confidence: "%",
  durationMinutes: "min",
  delayMinutes: "min",
  distanceKm: "km",
};
function value(v: unknown, key = ""): string {
  if (v === null || v === undefined) return "Not reported";
  if (v === "") return "Not supplied";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (
    typeof v === "string" &&
    ["a", "b", "publicKey"].includes(key) &&
    /^[a-fA-F0-9]{16,64}$/.test(v)
  )
    return link(v, { item: "meshcore:" + v, kind: "event" });
  if (typeof v === "string" && /^https?:\/\//.test(v))
    return `<a href="${esc(v)}" target="_blank" rel="noreferrer">Open source ↗</a>`;
  if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v))
    return `${esc(time(v))}<br/><small>${esc(v)}</small>`;
  return esc(v) + (units[key] ? ` ${units[key]}` : "");
}
function fields(data: unknown): string {
  if (data === null || typeof data !== "object") return `<p>${value(data)}</p>`;
  const entries = Object.entries(data);
  const scalars = entries.filter(
    ([, v]) => v === null || typeof v !== "object",
  );
  const nested = entries.filter(([, v]) => v !== null && typeof v === "object");
  return (
    `<dl>${scalars.map(([k, v]) => `<dt>${esc(human(k))}</dt><dd>${value(v, k)}</dd>`).join("")}</dl>` +
    nested
      .map(
        ([k, v]) =>
          `<details><summary>${esc(human(k))}${Array.isArray(v) ? ` · ${v.length} entries` : ""}</summary><div class="data-group">${Array.isArray(v) ? v.map((x, i) => `<details><summary>${esc((x as any)?.headline || (x as any)?.name || (x as any)?.time || `Entry ${i + 1}`)}</summary>${fields(x)}</details>`).join("") : fields(v)}</div></details>`,
      )
      .join("")
  );
}
const chapters = [
  {
    id: "sky",
    name: "Sky",
    question: "What changes above us?",
    intro:
      "Read today’s air alongside the hours ahead. Forecast values describe possibilities; only issued NWS products establish a watch or warning.",
    collections: [
      ["weather", "Weather & forecast"],
      ["WEATHER_ALERT", "Issued alerts"],
      ["map:fire_weather", "Fire weather"],
    ],
  },
  {
    id: "ground",
    name: "Ground",
    question: "What moves beneath & across?",
    intro:
      "Seismic reports, wildfire footprints and evacuation zones describe different processes. Their overlap does not establish a causal relationship.",
    collections: [
      ["WILDFIRE", "Wildfires"],
      ["EARTHQUAKE", "Earthquakes"],
      ["EVACUATION", "Evacuations"],
    ],
  },
  {
    id: "passage",
    name: "Passage",
    question: "What lies along the way?",
    intro:
      "A planned closure is not a live road reading. Read the schedule, restrictions, roadside messages and camera views together.",
    collections: [
      ["ROAD_INCIDENT", "Incidents & work"],
      ["map:road_segment", "Road readings"],
      ["map:chain_control", "Chain controls"],
      ["map:message_sign", "Message signs"],
      ["cameras", "Cameras"],
    ],
  },
  {
    id: "power",
    name: "Power",
    question: "What keeps daily life running?",
    intro:
      "Outages and public safety shutoffs have different stages. Restoration times are estimates, not confirmation that service has returned.",
    collections: [["POWER", "Outages & PSPS"]],
  },
  {
    id: "burn",
    name: "Fire decisions",
    question: "What do both authorities say?",
    intro:
      "The air district’s daily answer and CAL FIRE’s seasonal permit rules must both permit burning. Unknown or stale evidence never means permission.",
    collections: [["BURN_STATUS", "County burn decisions"]],
  },
  {
    id: "signals",
    name: "Signals",
    question: "What can be heard from here?",
    intro:
      "Radio observations reveal who was heard, not guaranteed RF coverage. Scanner links are listening references, not incident confirmation.",
    collections: [
      ["MESH", "Radio observations"],
      ["links", "Observed links"],
      ["scanners", "Scanner references"],
    ],
  },
  {
    id: "sources",
    name: "Sources & scope",
    question: "How much can this reading know?",
    intro:
      "Local retrieval, upstream health and observation time are separate clocks. Inspect the public source registry and place definitions behind every reading.",
    collections: [
      ["sources", "Source health"],
      ["summary", "Place rollup"],
      ["places", "Place directory"],
      ["layers", "Geographic evidence"],
      ["limits", "Access limits"],
    ],
  },
];
const stops = [
  ["murphys", "Murphys"],
  ["arnold", "Arnold"],
  ["dorrington", "Dorrington"],
  ["bearvalley", "Bear Valley"],
  ["ebbetts-pass", "Ebbetts Pass"],
];
const cache = new Map<string, Promise<any>>();
async function get<T>(
  key: string,
  fn: () => Promise<ApiResult<T>>,
): Promise<T> {
  if (!cache.has(key))
    cache.set(
      key,
      fn()
        .then((r) => {
          if (r.notModified)
            throw Error("No response body; retry this reading.");
          return r.data;
        })
        .catch((e) => {
          cache.delete(key);
          throw e;
        }),
    );
  return cache.get(key)!;
}
let state = new URLSearchParams(location.search),
  generation = 0,
  conditions: V1Conditions | undefined;
let detailRows = new Map<string, unknown>();
const place = () => state.get("place") || "murphys";
const chapter = () =>
  chapters.find((c) => c.id === state.get("chapter")) || chapters[0];
const collection = () => state.get("collection") || chapter().collections[0][0];
function url(patch: Record<string, string | null>) {
  const q = new URLSearchParams(state);
  for (const [k, v] of Object.entries(patch))
    v === null ? q.delete(k) : q.set(k, v);
  return "?" + q;
}
function go(patch: Record<string, string | null>) {
  history.pushState({}, "", url(patch));
  state = new URLSearchParams(location.search);
  void render();
}
function link(text: string, patch: Record<string, string | null>, cls = "") {
  return `<a class="${cls}" data-nav href="${esc(url(patch))}">${esc(text)}</a>`;
}
function button(label: string, action: string) {
  return `<button class="btn btn--outline btn--sm" data-action="${esc(action)}">${esc(label)}</button>`;
}
function row(item: any, index: number, kind = "item") {
  const id = String(item.id || item.locationId || item.feedId || index);
  detailRows.set(id, item);
  return `<article class="entry"><span class="entry-index">${String(index + 1).padStart(2, "0")}</span><div><p class="meta">${esc(item.layer || item.kind || kind)} · ${esc(item.status || "REFERENCE")} ${item.severity ? " / " + esc(item.severity) : ""}</p><h3>${link(item.headline || item.name || item.channelLabel || item.properties?.headline || id, { item: id, kind })}</h3>${item.summary ? `<p>${esc(item.summary)}</p>` : ""}${item.enhancement ? `<p class="meta">AI enhanced: ${esc(item.enhancement.fields.join(", "))}</p>` : ""}<p class="meta">${esc(item.areaLabel || item.agency || "")} ${item.observedAt ? " · Content observed " + esc(time(item.observedAt)) : ""}</p></div></article>`;
}
function stamp() {
  return `<div class="live-stamp"><span>VIEW OPENED · ${esc(time(new Date().toISOString()))}</span><span>${place() === "all" ? "REGIONAL / UNSCOPED" : esc($("#place option:checked")?.textContent || place())}</span></div>`;
}
function errorBox(e: unknown) {
  return `<div class="error" role="alert"><h3>This reading is unavailable.</h3><p>The request failed. No conclusion about conditions follows.</p><p>${esc(e instanceof Error ? e.message : "Unknown retrieval failure")}</p>${button("Retry reading", "retry")}</div>`;
}
async function render() {
  const gen = ++generation,
    c = chapter(),
    col = collection();
  detailRows = new Map();
  $("#chapters").innerHTML = chapters
    .map(
      (x, i) =>
        `<a data-nav href="${esc(url({ chapter: x.id, collection: null, item: null, kind: null, history: null }))}" ${x.id === c.id ? 'aria-current="page"' : ""}><span>${String(i + 1).padStart(2, "0")}</span>${esc(x.name)}</a>`,
    )
    .join("");
  $("#stops").innerHTML = stops
    .map(
      ([id, name]) =>
        `<a data-nav href="${esc(url({ place: id, item: null, kind: null }))}" ${id === place() ? 'aria-current="location"' : ""}>${esc(name)}</a>`,
    )
    .join("");
  const pos = stops.findIndex((s) => s[0] === place());
  $("#crossing-position").setAttribute(
    "aria-valuetext",
    pos >= 0 ? stops[pos][1] : "A place outside the crossing",
  );
  $<HTMLInputElement>("#crossing-position").value = String(Math.max(0, pos));
  $<HTMLSelectElement>("#place").value = place();
  $("#chapter-number").textContent = String(chapters.indexOf(c) + 1).padStart(
    2,
    "0",
  );
  $("#chapter-kicker").textContent = c.name;
  $("#question").textContent = c.question;
  $("#chapter-intro").textContent = c.intro;
  $("#collections").innerHTML = c.collections
    .map(
      ([id, label]) =>
        `<a data-nav href="${esc(url({ collection: id, item: null, kind: null, history: null }))}" ${col === id ? 'aria-current="page"' : ""}>${esc(label)}</a>`,
    )
    .join("");
  $("#evidence").innerHTML = '<p class="empty">Opening this reading…</p>';
  $("#evidence").setAttribute("aria-busy", "true");
  $("#controls").innerHTML = "";
  const isEvent = /^[A-Z_]+$/.test(col);
  if (isEvent) {
    $("#controls").innerHTML =
      `<form id="filter"><label>Read<select name="mode"><option value="current">Active & scheduled</option><option value="all">All lifecycles</option><option value="history">Revision archive</option></select></label><label>Archive from<input name="from" type="date" value="${esc(state.get("from") || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))}"/></label><label>Archive to (exclusive)<input name="to" type="date" value="${esc(state.get("to") || new Date().toISOString().slice(0, 10))}"/></label><button class="btn btn--outline btn--sm">Apply reading</button></form>`;
    $<HTMLSelectElement>("[name=mode]").value =
      state.get("history") || "current";
  }
  try {
    let html = "";
    const scope = place() === "all" ? {} : { place: place() };
    if (col === "weather") {
      conditions = await get("conditions:" + place(), () =>
        client.getConditions(scope),
      );
      html =
        stamp() +
        `<div class="reading-callout">Issued regional fire weather: <strong>${esc(conditions.fireWeather?.state || "unknown")}</strong>. ${esc(conditions.fireWeather?.headline || "Read issued alerts separately from forecast conditions.")}<br/><small>Weather refreshed ${esc(time(conditions.lastUpdated))}; this is an aggregate clock, not an individual station timestamp. Zero can mean missing upstream data.</small></div>` +
        conditions.weather
          .map((w, i) => {
            detailRows.set(w.locationId, w);
            const f = conditions!.forecast.find(
              (x) => x.locationId === w.locationId,
            );
            return `<article class="weather-row"><div><p class="meta">${String(i + 1).padStart(2, "0")} / ${esc(w.weatherDescription)}</p><h3>${esc(w.locationName)}</h3><small>Wind ${w.windSpeedKmh} km/h · Humidity ${w.humidityPercent}%</small></div><div class="temperature">${w.temperatureCelsius}<small>°C</small></div><div class="weather-action">${link(f ? `Follow the next ${f.horizonHours} hours →` : "Inspect this observation →", { item: w.locationId, kind: "weather" })}</div></article>`;
          })
          .join("");
      html += `<details><summary>Complete weather response · issued state, all forecast locations & periods</summary>${fields(conditions)}</details>`;
      if (!conditions.weather.length)
        html +=
          '<p class="empty">No current weather locations returned for this place. This is missing coverage, not calm weather.</p>';
    } else if (isEvent) {
      html = stamp();
      $("#evidence").innerHTML = html;
      await loadEvents(col as PublicLayer, gen);
      for (let i = 1; i < Math.min(10, Number(state.get("pages") || 1)); i++) {
        if (!pageToken || gen !== generation) break;
        await loadEvents(col as PublicLayer, gen, true);
      }
      if (gen !== generation) return;
      html = "";
    } else if (col.startsWith("map:")) {
      if (place() === "all")
        throw Error("Choose a named place for geographic condition layers.");
      const data = await get(col + place(), () =>
        client.getMapLayer(place(), col.slice(4) as MapLayer),
      );
      html =
        stamp() +
        `<div class="reading-callout">Current geographic projection. These condition features are not event revisions; rolling mesh links are not historical topology.</div>` +
        `<details><summary>Layer source health, timing & scope</summary>${fields(data.metadata)}</details>` +
        (data.features.length
          ? data.features
              .map((f, i) =>
                row(
                  {
                    ...f.properties,
                    geometry: f.geometry,
                    id: f.properties.id || String(i),
                  },
                  i,
                  "feature",
                ),
              )
              .join("")
          : '<p class="empty">No features returned. Read source health above before interpreting an empty layer.</p>');
    } else if (col === "sources") {
      const data = await get("sources", () => client.listSources());
      html = stamp() + data.sources.map((s, i) => row(s, i, "source")).join("");
    } else if (col === "places") {
      const data = await get("places", () => client.listPlaces());
      html =
        stamp() +
        `<form id="resolve"><label for="address">Find a US address or place</label><input id="address" name="address" required placeholder="Town, state or street address"/><button class="btn btn--outline">Resolve place</button></form><div id="resolved"></div>` +
        data.places.map((p, i) => row(p, i, "place")).join("");
    } else if (col === "summary") {
      if (place() === "all") throw Error("A rollup needs a named place.");
      const d = await get("summary:" + place(), () =>
        client.getPlaceSummary(place()),
      );
      html =
        stamp() +
        `<p class="reading-callout">Rollup posture ${esc(d.mode)} is not an all-clear. Road conditions can raise the roads domain without raising this posture. Burn and mesh do not count toward hazard totals.</p>` +
        fields(d);
    } else if (col === "cameras") {
      const d = await get(col + place(), () => client.listCameras(scope));
      html =
        stamp() +
        `<p>Public upstream imagery; directory health is not a guarantee that an image is current. No footage archive.</p>` +
        fields(
          Object.fromEntries(
            Object.entries(d).filter(([k]) => k !== "cameras"),
          ),
        ) +
        d.cameras.map((x, i) => row(x, i, "camera")).join("");
    } else if (col === "scanners") {
      const d = await get(col + place(), () => client.listScanners(scope));
      html =
        stamp() +
        "<p>Configured listening references. Audio never autoplays; availability is not monitored here.</p>" +
        d.scanners.map((x, i) => row(x, i, "scanner")).join("");
    } else if (col === "links") {
      const window = state.get("window") || "72h";
      const d = await get("links" + window, () =>
        client.listMeshLinks({ window }),
      );
      html =
        stamp() +
        `<p class="reading-callout">Regional observations over ${esc(window)}. An observed edge does not establish coverage; a missing edge does not rule out a physical path.</p><nav>${link("72 hours", { window: "72h" })} · ${link("30 days", { window: "720h" })} · ${link("400 days", { window: "9600h" })}</nav>` +
        fields(d);
    } else if (col === "layers") {
      const layers = [
        "road_incident",
        "chain_control",
        "road_segment",
        "message_sign",
        "weather_alert",
        "fire_weather",
        "earthquake",
        "wildfire",
        "evacuation",
        "power",
        "mesh_node",
        "mesh_link",
        "camera",
      ];
      html =
        "<p>Every public geographic projection. Select a named place first. Coordinates use longitude, latitude; absent geometry remains absent.</p>" +
        layers
          .map(
            (x, i) =>
              `<article class="entry"><span class="entry-index">${i + 1}</span><h3>${link(human(x), { collection: "map:" + x })}</h3></article>`,
          )
          .join("");
    } else
      html = `<div class="reading-callout">This observatory has edges.</div><p>Current weather, forecasts, roads, signs, cameras and scanner references have no public historical archive. Revisions are content changes, not every upstream poll.</p><p>Raw mesh receptions, individual packet paths, daily link buckets, operational relay controls, private traffic and burn staging diagnostics are not public datasets. No gauge, air-quality or announcement dataset is presently exposed.</p><p>Place attachments use different rules by source. Town points do not define a local hazard boundary; wildfire proximity can extend beyond place boundaries. County listings do not promise uniform feed coverage.</p><p>Evacuation references are informational. Follow official instructions and source links. Source errors, missing observations and truncated archives never mean all-clear.</p>`;
    if (gen !== generation) return;
    if (html) $("#evidence").innerHTML = html;
    $("#evidence").setAttribute("aria-busy", "false");
    if (state.get("item")) await openDetail();
    else $<HTMLDialogElement>("#detail").close();
  } catch (e) {
    if (gen === generation) {
      $("#evidence").innerHTML = errorBox(e);
      $("#evidence").setAttribute("aria-busy", "false");
    }
  }
  void connection(gen);
}
let pageToken = "",
  eventPages = 0;
async function loadEvents(layer: PublicLayer, gen: number, more = false) {
  const mode = state.get("history") || "current";
  const scope = place() === "all" ? {} : { place: place() };
  const q = {
    ...scope,
    layer: [layer],
    pageSize: 30,
    ...(more ? { pageToken } : {}),
  };
  if (!more) {
    pageToken = "";
    eventPages = 0;
  }
  try {
    const data =
      mode === "history"
        ? await get(
            JSON.stringify({
              ...q,
              mode,
              from: state.get("from"),
              to: state.get("to"),
            }),
            () =>
              client.listHistory({
                ...q,
                from:
                  (state.get("from") ||
                    new Date(Date.now() - 30 * 86400000)
                      .toISOString()
                      .slice(0, 10)) + "T00:00:00Z",
                to:
                  (state.get("to") || new Date().toISOString().slice(0, 10)) +
                  "T00:00:00Z",
              }),
          )
        : await get(JSON.stringify({ ...q, mode }), () =>
            client.listEvents({
              ...q,
              ...(mode === "all"
                ? {
                    status: [
                      "ACTIVE",
                      "SCHEDULED",
                      "RESOLVED",
                      "EXPIRED",
                    ] as const as any,
                  }
                : {}),
            }),
          );
    if (gen !== generation) return;
    $("#pagination")?.remove();
    const items = "events" in data ? data.events : data.revisions;
    const html = items
      .map((x: any, i: number) => {
        const event = x.event || x;
        const itemKey = x.event ? `${event.id}@${x.revision}` : event.id;
        const result = row(
          { ...event, id: itemKey },
          eventPages * 30 + i,
          x.event ? "revision" : "event",
        );
        if (x.event) detailRows.set(itemKey, x);
        return (
          result +
          (x.event
            ? `<p class="meta">Archived snapshot · revision ${esc(x.revision)} · observed ${esc(time(x.observedAt))}. Title opens this snapshot.</p><details><summary>Inspect this archived snapshot</summary>${fields(x)}</details>`
            : "")
        );
      })
      .join("");
    eventPages++;
    pageToken = data.nextPageToken;
    $("#evidence").insertAdjacentHTML(
      "beforeend",
      html ||
        '<p class="empty">No records returned for these filters. Try the revision archive, all lifecycles, or the regional shelf. This does not establish safe conditions.</p>',
    );
    $("#evidence").insertAdjacentHTML(
      "beforeend",
      `<div id="pagination"><p class="note">${pageToken ? "Partial reading — more records remain." : "End of this result set; no continuation token."} ${mode === "history" ? "Archive bounds are UTC, start inclusive/end exclusive. Current place attachments filter historical records." : ""}</p>${pageToken && eventPages < 10 ? button("Read the next page", "more") : pageToken ? "<p>Ten-page visit bound reached. Narrow your scope to continue.</p>" : ""}${link("Open the regional shelf →", { place: "all", item: null })}</div>`,
    );
  } catch (e) {
    if (gen !== generation) return;
    $("#evidence").insertAdjacentHTML("beforeend", errorBox(e));
  }
}
async function connection(gen: number) {
  if (place() === "all") {
    if (gen === generation) {
      $("#connections").innerHTML =
        '<p class="connection">The regional shelf includes observations outside named local attachments.<small>Unscoped does not mean complete geographic coverage.</small></p>';
      $("#reading-note").textContent =
        "Choose a named place to return to the crossing.";
    }
    return;
  }
  try {
    const d = await get("summary:" + place(), () =>
      client.getPlaceSummary(place()),
    );
    if (gen !== generation) return;
    const roads = d.domains.find((x) => x.domain === "roads");
    $("#connections").innerHTML =
      `<p class="connection">At ${esc(d.placeName)}, the hazard posture reads ${esc(d.mode.toLowerCase())}.${roads ? ` The roads reading is ${link(roads.highestSeverity.toLowerCase(), { chapter: "passage", collection: "map:road_segment", item: null })}.` : ""}<small>These are different measures. Roads source: ${esc(roads?.status || "unknown")}. Generated ${esc(time(d.generatedAt))}. Neither is a route safety assessment.</small></p>`;
    $("#reading-note").textContent =
      "A local lens, not a complete local hazard census. Responses are reused within this visit; reload for a new retrieval. No automatic polling.";
  } catch {
    if (gen === generation) {
      $("#connections").innerHTML =
        '<p class="connection">The place summary could not be retrieved.<small>Individual evidence collections may still be available.</small></p>';
      $("#reading-note").textContent =
        "Source state unknown; this is not an all-clear.";
    }
  }
}
let revisionToken = "",
  revisionPages = 0,
  revisionsIo = false;
async function openDetail() {
  const id = state.get("item")!,
    kind = state.get("kind") || "item",
    dialog = $<HTMLDialogElement>("#detail");
  $("#detail-content").innerHTML =
    '<h2 id="detail-title">Opening the evidence…</h2>';
  if (!dialog.open) dialog.showModal();
  try {
    let d: any = detailRows.get(id);
    if (kind === "event")
      d = await get("event:" + id, () => client.getEvent(id));
    else if (kind === "place")
      d = await get("place:" + id, () => client.getPlace(id));
    if (!d)
      throw Error(
        "This item is not in the loaded reading. Close and locate it in the current collection.",
      );
    if (state.get("item") !== id) return;
    const snapshot = kind === "revision" ? d : null;
    if (snapshot) d = snapshot.event;
    let html = `<p class="eyebrow">${esc(kind)} · ${esc(id)}</p><h2 id="detail-title">${esc(d.headline || d.name || d.locationName || d.channelLabel || "Evidence")}</h2>`;
    if (kind === "event" || kind === "revision") {
      const e = d as V1Event;
      if (snapshot)
        html += `<p class="warning">Archived revision ${esc(snapshot.revision)} · observed ${esc(time(snapshot.observedAt))}. This is a stored snapshot, not the current observation.</p>${link("Open the current record →", { item: e.id, kind: "event" })}`;
      html += `<p class="meta">${esc(e.status)} / ${esc(e.severity)} · revision ${e.revision}</p>${e.enhancement ? `<p class="warning">AI enhancement present: ${esc(e.enhancement.fields.join(", "))}. Model ${esc(e.enhancement.model)}. Original source text is retained below.</p>` : ""}${e.summary ? `<p>${esc(e.summary)}</p>` : ""}${e.description ? `<h3>Source description</h3><p>${esc(e.description)}</p>` : ""}${e.weatherAlert?.instruction ? `<h3>Official instructions · verbatim</h3><p class="warning">${esc(e.weatherAlert.instruction)}</p>` : ""}${e.layer === "EVACUATION" ? '<p class="warning">Reference only. Follow official evacuation instructions; this reading may lag the issuing authority.</p>' : ""}`;
      const detail =
        e.wildfire ||
        e.evacuation ||
        e.weatherAlert ||
        e.earthquake ||
        e.roadIncident ||
        e.power ||
        e.burnStatus ||
        e.mesh;
      html += "<h3>What was observed</h3>" + fields(detail);
      if (e.burnStatus)
        html +=
          '<p class="note">Phone transcripts and confidence are machine-derived. Daily unchanged answers may refresh without a new revision. CAL FIRE observation time is independent of the county line call.</p>';
      if (e.mesh)
        html += `<p class="note">Last heard / relayed are radio activity clocks. Revision observation time is not radio activity. Admin reachability is a monitor verdict, not an RF coverage guarantee.</p><div class="telemetry-window"><label>Monitor window from (UTC)<input id="telemetry-from" type="datetime-local" value="${new Date(Date.now() - 86400000).toISOString().slice(0, 16)}"/></label><label>To (UTC, exclusive)<input id="telemetry-to" type="datetime-local" value="${new Date().toISOString().slice(0, 16)}"/></label></div>${button("Read monitor archive", "telemetry")}<div id="telemetry"></div>`;
      html += `<h3>Time & provenance</h3>${fields({ contentObservedAt: e.observedAt, storedAt: e.ingestedAt, effective: e.effective, expires: e.expires, ...e.provenance })}<p class="note">Observed: upstream content change. Stored: Grid revision ingestion. Fetched: source retrieval, when supplied. Forecast and restoration times remain estimates.</p>`;
      const source = safeUrl(e.canonicalUrl) || safeUrl(e.provenance.sourceUrl);
      if (source)
        html += `<p><a href="${esc(source)}" target="_blank" rel="noreferrer">Continue to the official/source record ↗</a></p>`;
      else
        html += link("Find the source registry →", {
          chapter: "sources",
          collection: "sources",
          item: null,
          kind: null,
        });
      html += `<details><summary>Advanced attribution · stored AI input and output</summary><p>Read the current record’s stored enhancement only. This does not run a model or create new enrichment; it may differ from an archived snapshot.</p>${button("Read stored AI input/output", "enhancement")}<div id="enhancement-io"></div></details>`;
      html += `<h3>Follow the changes</h3><p>Revisions are stored snapshots, not periodic measurements. Fresh telemetry and unchanged burn readings do not necessarily create revisions.</p>${button("Open revision history", "revisions")}${button("Read revisions with stored AI I/O", "revision-io")}<div id="revisions"></div><details><summary>Full record, relationships & geometry</summary>${fields(e)}</details>`;
    } else if (kind === "weather") {
      const f = conditions?.forecast.find((x) => x.locationId === id);
      html += `<h3>The current reading</h3>${fields(d)}<p class="note">OpenWeatherMap · aggregate refresh ${esc(time(conditions?.lastUpdated))}. Upstream missing values may appear as zero.</p>`;
      if (f)
        html += `<h3>The next ${f.horizonHours} hours</h3><p>Forecast issued ${esc(time(f.issuedAt))} · ${esc(f.source)}. A forecast is not an issued alert.</p><div id="forecast-chart"></div><label for="forecast-measure">Read a forecast quantity</label><select id="forecast-measure"><option value="temperatureCelsius">Temperature · °C</option><option value="humidityPercent">Humidity · %</option><option value="windSpeedKmh">Wind · km/h</option><option value="windGustKmh">Gust · km/h</option></select>${fields(f)}`;
      else html += "<p>No forecast returned for this location.</p>";
    } else {
      if (kind === "camera" && safeUrl(d.imageUrl))
        html += `<img class="thumbnail" src="${esc(safeUrl(d.imageUrl))}" alt="Public camera view: ${esc(d.name)}" loading="lazy"/><p class="note">Upstream image; capture time may be unknown. Refresh interval is not proof of image freshness.</p>`;
      html += fields(d);
      if (kind === "source")
        html +=
          '<p class="note">Reporter rows may have zero polling interval because they push observations. Source health is separate from local retrieval success.</p>';
      if (kind === "place")
        html += link("Read through this place →", {
          place: d.slug,
          item: null,
          kind: null,
        });
    }
    $("#detail-content").innerHTML = html;
    if (kind === "weather") drawForecast();
  } catch (e) {
    $("#detail-content").innerHTML =
      '<h2 id="detail-title">Evidence unavailable</h2>' + errorBox(e);
  }
}
function drawForecast() {
  const f = conditions?.forecast.find(
    (x) => x.locationId === state.get("item"),
  );
  if (!f || !$("#forecast-chart")) return;
  const key = ($<HTMLSelectElement>("#forecast-measure")?.value ||
    "temperatureCelsius") as "temperatureCelsius";
  renderTimeSeries($("#forecast-chart"), {
    label: human(key),
    description: `NWS forecast issued ${time(f.issuedAt)}. Forecast clock, not measurement history.`,
    unit: units[key],
    maxGapMs: 90 * 60000,
    series: [
      {
        id: key,
        label: human(key),
        points: f.periods.map((p) => ({
          time: Date.parse(p.time || ""),
          value: p[key],
        })),
      },
    ],
  });
}
async function revisions(more = false, io = false) {
  const id = state.get("item")!.split("@")[0];
  const el = $("#revisions");
  if (!more) {
    revisionToken = "";
    revisionPages = 0;
    revisionsIo = io;
    el.innerHTML = "<p>Retrieving stored changes…</p>";
  }
  try {
    const d = await get(
      "revisions:" + id + revisionToken + String(revisionsIo),
      () =>
        client.getEventHistory(id, {
          enhancementIo: revisionsIo,
          pageSize: 20,
          ...(revisionToken ? { pageToken: revisionToken } : {}),
        }),
    );
    if (state.get("item")!.split("@")[0] !== id) return;
    if (!more) el.innerHTML = "";
    $("#revision-more")?.remove();
    revisionPages++;
    revisionToken = d.nextPageToken;
    el.insertAdjacentHTML(
      "beforeend",
      d.revisions
        .map(
          (r) =>
            `<details><summary>Revision ${esc(r.revision)} · ${esc(time(r.observedAt))} · ${esc(r.event?.status)}</summary><p>This is the complete stored snapshot for this revision.</p>${fields(r)}</details>`,
        )
        .join("") || "<p>No revisions returned.</p>",
    );
    el.insertAdjacentHTML(
      "beforeend",
      `<div id="revision-more"><p class="note">${revisionToken ? "Partial archive; further revisions remain. Each action reads up to 20 more revisions; nothing loads automatically." : "End of this event’s returned archive."}</p>${revisionToken ? button("Read older revisions", "revision-more") : ""}</div>`,
    );
  } catch (e) {
    el.insertAdjacentHTML("beforeend", errorBox(e));
  }
}
async function telemetry() {
  const id = state.get("item")!.split("@")[0],
    el = $("#telemetry");
  el.innerHTML = "<p>Retrieving monitor measurements…</p>";
  try {
    const from = $<HTMLInputElement>("#telemetry-from").value + ":00Z",
      to = $<HTMLInputElement>("#telemetry-to").value + ":00Z";
    if (
      !Number.isFinite(Date.parse(from)) ||
      !Number.isFinite(Date.parse(to)) ||
      Date.parse(from) >= Date.parse(to) ||
      Date.parse(to) - Date.parse(from) > 400 * 86400000
    )
      throw Error(
        "Choose a valid increasing UTC window no longer than 400 days.",
      );
    const d = await get("telemetry:" + id + from + to, () =>
      client.getMeshTelemetry({ node: id, from, to }),
    );
    if (state.get("item")!.split("@")[0] !== id) return;
    el.innerHTML = `<p class="${d.truncated ? "warning" : "note"}">${d.truncated ? "Truncated: the series ends early; not a complete window." : "Returned window is not flagged truncated."} ${d.samples.length} samples. No samples can mean unmonitored or outside retained coverage, not a silent radio.</p><div id="telemetry-chart"></div>${fields({ from: d.from, to: d.to, coverage: d.coverage, cadenceSeconds: d.cadenceSeconds, reboots: d.reboots })}<details><summary>All monitor samples · exact counters and both clocks</summary>${fields(d.samples)}</details>`;
    renderTimeSeries($("#telemetry-chart"), {
      label: "Monitor battery voltage",
      unit: "V",
      description:
        "Measurement clock: reading.reportedAt. Received-at is storage time. Counters remain exact strings; no rates inferred.",
      maxGapMs:
        d.cadenceSeconds &&
        Number.isSafeInteger(Number(d.cadenceSeconds)) &&
        Number(d.cadenceSeconds) > 0
          ? Number(d.cadenceSeconds) * 1500
          : 1,
      series: [
        {
          id: "battery",
          label: "Battery",
          points: d.samples.map((x) => ({
            time: Date.parse(x.reading.reportedAt || ""),
            value: x.reading.batteryVolts,
          })),
        },
      ],
    });
  } catch (e) {
    el.innerHTML = errorBox(e);
  }
}
async function enhancementIo() {
  const selected = state.get("item")!;
  const id = selected.split("@")[0];
  const el = $("#enhancement-io");
  el.innerHTML = "<p>Retrieving stored attribution…</p>";
  try {
    const d = await get("event-enhancement-io:" + id, () =>
      client.getEvent(id, { enhancementIo: true }),
    );
    if (state.get("item") !== selected) return;
    el.innerHTML = d.enhancement
      ? `<p>Current record revision ${d.revision}. Stored model output is attribution evidence, not authoritative instructions.</p>${fields(d.enhancement)}${!d.enhancement.request && !d.enhancement.response ? "<p>No stored prompt or response was supplied for this record.</p>" : ""}`
      : "<p>No stored enhancement is present on the current record.</p>";
  } catch (e) {
    el.innerHTML = errorBox(e);
  }
}
document.addEventListener("click", (e) => {
  const target = e.target as Element;
  const nav = target.closest<HTMLAnchorElement>("a[data-nav]");
  if (nav && !((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey)) {
    e.preventDefault();
    history.pushState({}, "", nav.href);
    state = new URLSearchParams(location.search);
    void render();
    return;
  }
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action === "retry") {
    cache.clear();
    void render();
  }
  if (action === "more") go({ pages: String(Math.min(10, eventPages + 1)) });
  if (action === "revisions") void revisions();
  if (action === "revision-more") void revisions(true);
  if (action === "revision-io") void revisions(false, true);
  if (action === "telemetry") void telemetry();
  if (action === "enhancement") void enhancementIo();
});
$("#place").addEventListener("change", () =>
  go({ place: $<HTMLSelectElement>("#place").value, item: null, kind: null }),
);
$("#crossing-position").addEventListener("change", () =>
  go({
    place: stops[Number($<HTMLInputElement>("#crossing-position").value)][0],
    item: null,
    kind: null,
  }),
);
$("#place-note").addEventListener("click", () =>
  go({
    chapter: "sources",
    collection: "places",
    item: place() === "all" ? null : place(),
    kind: "place",
  }),
);
$("#close-detail").addEventListener("click", () =>
  go({ item: null, kind: null }),
);
$("#detail").addEventListener("cancel", (e) => {
  e.preventDefault();
  go({ item: null, kind: null });
});
document.addEventListener("change", (e) => {
  if ((e.target as HTMLElement).id === "forecast-measure") drawForecast();
});
document.addEventListener("submit", async (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id === "filter") {
    e.preventDefault();
    const f = new FormData(form);
    go({
      history: String(f.get("mode")),
      from: String(f.get("from")),
      to: String(f.get("to")),
      item: null,
      kind: null,
    });
  }
  if (form.id === "resolve") {
    e.preventDefault();
    $("#resolved").innerHTML = "<p>Resolving this address…</p>";
    try {
      const d = await get(
        "resolve:" + String(new FormData(form).get("address")),
        () =>
          client.resolvePlace({
            address: String(new FormData(form).get("address")),
          }),
      );
      $("#resolved").innerHTML = fields(d);
    } catch (err) {
      $("#resolved").innerHTML = errorBox(err);
    }
  }
});
window.addEventListener("popstate", () => {
  state = new URLSearchParams(location.search);
  void render();
});
$("#edition-date").textContent = new Date()
  .toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  .toUpperCase();
async function init() {
  try {
    const d = await get("places", () => client.listPlaces());
    $("#place").innerHTML =
      d.places
        .map(
          (p) =>
            `<option value="${esc(p.slug)}">${esc(p.name)} · ${esc(p.kind)}</option>`,
        )
        .join("") +
      '<option value="all">Regional shelf · all places / unlocated</option>';
  } catch {
    $("#reading-note").textContent =
      "Place directory unavailable; the selected place can still be read.";
  }
  await render();
}
void init();
