import { viewAt, viewFor, type ViewId } from "../config/views.ts";
export const corridor = "ebbetts-pass";
export type Mode = "now" | "future" | "history";
export type State = {
  place: string;
  topic: ViewId;
  mode: Mode;
  from: string;
  to: string;
  node: string;
  compare: string;
  metric: string;
  record: string;
  layer: string;
  timeExplicit: boolean;
  eventStatus?: string;
  severity?: string;
  revision?: string;
  browserPages?: number;
  autoSelect?: boolean;
  weatherLocation?: string;
  weatherCompare?: string;
  archiveSource?: string;
  archiveSearch?: string;
  /** Testing only: "live" shows the most recent wildfire, evacuation or shutoff as if active. */
  preview?: string;
};
const metrics = [
  "packetsReceivedPerMinute",
  "packetsSentPerMinute",
  "receiveErrorsPerMinute",
  "batteryVolts",
  "temperatureC",
  "humidity",
  "txQueueLen",
  "lastSnrDb",
];
const layers = [
  "ALL",
  "MESH",
  "WILDFIRE",
  "POWER",
  "ROAD_INCIDENT",
  "EVACUATION",
  "WEATHER_ALERT",
  "BURN_STATUS",
];
export function defaults(
  topic: ViewId,
  now = Date.now(),
): Pick<State, "mode" | "from" | "to"> {
  const view = viewFor(topic),
    future = view.defaultMode === "future";
  return {
    mode: view.defaultMode,
    from: new Date(future ? now : now - view.days * 86400000).toISOString(),
    to: new Date(future ? now + view.days * 86400000 : now).toISOString(),
  };
}
export function parseState(url: URL, now = Date.now()): State {
  const q = url.searchParams;
  let legacy: Record<string, unknown> = {};
  try {
    const value = JSON.parse(q.get("q") ?? "{}");
    if (value && typeof value === "object" && !Array.isArray(value))
      legacy = value;
  } catch {}
  const get = (key: string) =>
    q.get(key) ??
    (typeof legacy[key] === "string" ? (legacy[key] as string) : "");
  const topic =
    url.pathname === "/" && legacy.topic
      ? viewFor(String(legacy.topic)).id
      : viewAt(url.pathname).id;
  const base = defaults(topic, now),
    mode = get("mode");
  const from = Date.parse(get("from")),
    to = Date.parse(get("to"));
  const interval =
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    from < to &&
    to - from <= 366 * 86400000;
  const key = (s: string) => (/^[a-f0-9]{64}$/i.test(s) ? s.toLowerCase() : "");
  return {
    topic,
    autoSelect: get("selection") !== "none",
    browserPages: Math.max(1, Math.min(20, Number(get("pages")) || 1)),
    eventStatus: ["current", "all", "ACTIVE", "SCHEDULED", "RESOLVED", "EXPIRED"].includes(get("status")) ? get("status") : "current",
    severity: ["INFO", "MINOR", "MODERATE", "SEVERE", "EXTREME"].includes(get("severity")) ? get("severity") : "",
    revision: /^\d{1,12}$/.test(get("revision")) ? get("revision") : "",
    archiveSource: /^[a-zA-Z0-9:_-]{1,80}$/.test(get("archiveSource"))
      ? get("archiveSource")
      : "",
    archiveSearch: get("archiveSearch")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 120),
    preview: get("preview") === "live" ? "live" : "",
    weatherLocation: /^[a-zA-Z0-9:_-]{1,120}$/.test(get("weatherLocation"))
      ? get("weatherLocation")
      : "",
    weatherCompare: /^[a-zA-Z0-9:_-]{1,120}$/.test(get("weatherCompare"))
      ? get("weatherCompare")
      : "",
    place: corridor,
    ...base,
    ...(interval
      ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
      : {}),
    mode:
      interval && ["now", "future", "history"].includes(mode)
        ? (mode as Mode)
        : base.mode,
    timeExplicit: interval && (get("time") === "fixed" || !!legacy.mode),
    node: key(get("node")),
    compare: key(get("compare")),
    metric: metrics.includes(get("metric")) ? get("metric") : "batteryVolts",
    record: get("record").slice(0, 200),
    layer: layers.includes(get("layer"))
      ? get("layer")
      : ["changes", "events"].includes(topic)
        ? "ALL"
        : "WILDFIRE",
  };
}
export function changeView(
  state: State,
  topic: ViewId,
  now = Date.now(),
): State {
  return {
    ...state,
    topic,
    record: "",
    revision: "",
    browserPages: 1,
    autoSelect: true,
    ...(topic !== state.topic ? { preview: "", archiveSource: "", archiveSearch: "", eventStatus: "current", severity: "", layer: "ALL" } : {}),
    ...(!state.timeExplicit ? defaults(topic, now) : {}),
  };
}
export function stateUrl(state: State): string {
  // Only state that differs from what the destination would choose by itself
  // goes into the URL; a shared link should read as the view it opens.
  const q = new URLSearchParams();
  if (state.timeExplicit) {
    q.set("mode", state.mode);
    q.set("from", state.from);
    q.set("to", state.to);
  }
  if (state.metric && state.metric !== "batteryVolts") q.set("metric", state.metric);
  if (["events", "changes"].includes(state.topic) && state.layer && state.layer !== "ALL") q.set("layer", state.layer);
  if (state.autoSelect === false) q.set("selection", "none");
  if (state.browserPages && state.browserPages > 1) q.set("pages", String(state.browserPages));
  if (state.eventStatus && state.eventStatus !== "current") q.set("status", state.eventStatus);
  if (state.timeExplicit) q.set("time", "fixed");
  for (const k of [
    "node",
    "compare",
    "record",
    "severity",
    "revision",
    "weatherLocation",
    "weatherCompare",
    "archiveSource",
    "archiveSearch",
  ] as const)
    if (state[k] && !(k.startsWith("weather") && !["discover", "weather"].includes(state.topic))) q.set(k, state[k]);
  if (state.preview === "live" && ["WILDFIRE", "POWER"].includes(state.topic)) q.set("preview", "live");
  const query = q.toString();
  return viewFor(state.topic).path + (query ? "?" + query : "");
}
