/**
 * What each page says about itself to a reader that is not a browser: a
 * search engine, a link preview, an agent that fetches the HTML and runs no
 * script. Titles and descriptions are per page (they were one sentence for
 * every route), and each page names the public JSON it is drawn from.
 */
import type { ViewId } from "./views.ts";

/** Where the site is served. `astro.config.mjs` carries the same origin as `site`. */
export const SITE_ORIGIN = "https://grid.sierragridteam.org";
/** The public API every page reads. Always the public one in what a crawler is told. */
export const DATA_ORIGIN = "https://data.sierragridteam.org";
export const SITE_NAME = "S.I.E.R.R.A Grid";
/** The corridor, in the words people search with. */
export const CORRIDOR = "Ebbetts Pass corridor";
export const CORRIDOR_PLACE = "Ebbetts Pass corridor (Highway 4), Calaveras, Alpine and Tuolumne counties, California";

export const ORGANIZATION = {
  name: "S.I.E.R.R.A",
  fullName: "Signal Integrity & Emergency Radio Response Alliance",
  url: "https://sierragridteam.org/",
  description: "An all-volunteer non-profit building off-grid emergency communications for the Calaveras and Tuolumne foothills.",
  sameAs: ["https://github.com/sierragridteam"],
} as const;

/** One JSON (or GeoJSON) resource a page is drawn from, as a path on the data service. */
export type DataLink = { label: string; path: string; type?: "application/json" | "application/geo+json" };
export type PageMeta = {
  /** The document title and link-preview title, before the site name. */
  title: string;
  description: string;
  /** The page's data, first the one that best answers what the page answers. */
  data: DataLink[];
  /**
   * False keeps the page out of the sitemap and asks not to be indexed: a
   * route that only sends the reader on, or a tool with no content of its own.
   */
  index: boolean;
  /** The page describes a body of data of its own (a `Dataset` in its structured data). */
  dataset?: string;
};

const place = "ebbetts-pass";
const events = (layer: string, label: string): DataLink => ({ label, path: `/api/v1/events?place=${place}&layer=${layer}` });
const layer = (name: string, label: string): DataLink => ({ label, path: `/api/v1/places/${place}/map/${name}.geojson`, type: "application/geo+json" });

export const pageMeta: Record<ViewId, PageMeta> = {
  discover: {
    title: "Ebbetts Pass corridor: roads, weather, wildfires and power now",
    description: "What is active on the Highway 4 corridor between Angels Camp and Bear Valley: road status and chain controls, weather alerts, wildfires, evacuations and power outages, from public sources.",
    data: [
      { label: "The corridor now: severity, evacuations, top events and source health", path: `/api/v1/places/${place}/summary` },
      { label: "Active and scheduled events", path: `/api/v1/events?place=${place}` },
    ],
    index: true,
  },
  events: {
    title: "Events on the Ebbetts Pass corridor: every report and its revisions",
    description: "Every report Grid holds for the Ebbetts Pass corridor (road incidents, weather alerts, wildfires, evacuations, outages), each with its source text, map and every saved revision.",
    data: [
      { label: "Active and scheduled events", path: `/api/v1/events?place=${place}` },
      { label: "Every event, ended ones included", path: `/api/v1/events?place=${place}&status=ACTIVE,SCHEDULED,RESOLVED,EXPIRED` },
    ],
    index: true,
    dataset: "Event reports for the Ebbetts Pass corridor, with revision history",
  },
  search: {
    title: "Search reports, places, roads and mesh nodes",
    description: "Search every report Grid holds for the Ebbetts Pass corridor, and every saved revision of each, by text.",
    data: [{ label: "Search by name across events, places, roads, cameras and mesh nodes (add q)", path: "/api/v1/search?q=arnold" }],
    index: false,
  },
  roads: {
    title: "Highway 4 road conditions and chain controls: Angels Camp to Bear Valley",
    description: "Whether Highway 4 is open between Angels Camp, Murphys, Arnold and Bear Valley, and Highway 49 to Sonora: chain controls, closures, Caltrans road work and message signs, with a record of when each changed.",
    data: [
      layer("road_segment", "Status of each monitored road"),
      layer("chain_control", "Chain control stretches and checkpoints"),
      events("ROAD_INCIDENT", "Road incidents and Caltrans lane closures"),
      layer("message_sign", "Caltrans message signs"),
    ],
    index: true,
    dataset: "Highway 4 and Highway 49 road status, chain controls and incidents, Ebbetts Pass corridor",
  },
  weather: {
    title: "Weather and snow level for Arnold, Murphys and Bear Valley",
    description: "National Weather Service alerts, the snow level against the Highway 4 towns, the next 48 hours and the week ahead for Arnold, Murphys, Dorrington and Bear Valley.",
    data: [
      { label: "Current conditions and forecast by town", path: `/api/v1/conditions?place=${place}` },
      events("WEATHER_ALERT", "National Weather Service alerts in effect"),
    ],
    index: true,
    dataset: "Weather conditions, forecasts and National Weather Service alerts, Ebbetts Pass corridor",
  },
  mesh: {
    title: "SIERRA MeshCore mesh network: repeaters, links and gateways",
    description: "The MeshCore radio mesh S.I.E.R.R.A runs in the Calaveras and Tuolumne foothills: every repeater and gateway, when each was last heard, the links between them and battery readings.",
    data: [
      { label: "Mesh nodes and when each was last heard", path: "/api/v1/events?layer=MESH" },
      layer("mesh_link", "Links observed between nodes"),
    ],
    index: true,
    dataset: "MeshCore mesh network nodes, links and telemetry, Calaveras and Tuolumne foothills",
  },
  changes: {
    title: "Recent history",
    description: "Past reports are on Events, with every saved revision of each.",
    data: [{ label: "Saved revisions over a period (add from and to)", path: `/api/v1/history?place=${place}` }],
    index: false,
  },
  WILDFIRE: {
    title: "Wildfires and evacuations near Arnold, Murphys and the Highway 4 corridor",
    description: "Active wildfires and evacuation orders in Calaveras and Tuolumne counties from CAL FIRE, FIRIS and Cal OES, and the record of this season's fires when none is burning.",
    data: [
      events("WILDFIRE", "Wildfires"),
      events("EVACUATION", "Evacuation orders and warnings"),
      layer("wildfire", "Fire locations and perimeters"),
    ],
    index: true,
    dataset: "Wildfires and evacuation zones, Ebbetts Pass corridor",
  },
  POWER: {
    title: "Power outages and safety shutoffs: Arnold, Murphys and the Highway 4 corridor",
    description: "PG&E outages and Public Safety Power Shutoffs on the Ebbetts Pass corridor: customers affected, cause and estimated restoration, and the record of past interruptions.",
    data: [events("POWER", "Outages and safety shutoffs")],
    index: true,
    dataset: "PG&E outages and Public Safety Power Shutoffs, Ebbetts Pass corridor",
  },
  EVACUATION: {
    title: "Evacuations",
    description: "Evacuation orders and warnings are on the Wildfires page, where they lead when any is in effect.",
    data: [events("EVACUATION", "Evacuation orders and warnings")],
    index: false,
  },
  WEATHER_ALERT: {
    title: "Weather alerts for the Ebbetts Pass corridor",
    description: "National Weather Service watches, warnings and advisories covering Arnold, Murphys, Dorrington and Bear Valley, each with its full text and revisions.",
    data: [events("WEATHER_ALERT", "National Weather Service alerts in effect")],
    index: true,
  },
  cameras: {
    title: "Road cameras near the Highway 4 corridor",
    description: "Caltrans road cameras near the Ebbetts Pass corridor, on Highways 108, 88 and 120. Coverage is supplemental: the catalogue has no camera on Highway 4 itself.",
    data: [{ label: "Road cameras", path: `/api/v1/cameras?place=${place}` }],
    index: true,
  },
  BURN_STATUS: {
    title: "Burn day status for Calaveras and Tuolumne counties",
    description: "Whether today is a burn day in Calaveras County and Tuolumne County: each air district's burn line as recorded, CAL FIRE's permit status, and the record of each day's call.",
    data: [events("BURN_STATUS", "Burn status by county, with each burn line's message")],
    index: true,
    dataset: "Burn day status by county, Calaveras and Tuolumne",
  },
  scanners: {
    title: "Scanner feeds for Calaveras and Tuolumne counties",
    description: "Public-safety radio feeds to listen to for Calaveras and Tuolumne counties: sheriff and CAL FIRE dispatch, U.S. Forest Service fire and CHP, on Broadcastify.",
    data: [{ label: "Scanner feeds", path: `/api/v1/scanners?place=${place}` }],
    index: true,
  },
  sources: {
    title: "Source health: is each data feed current",
    description: "Whether each feed behind Grid is current (Caltrans, CHP, CAL FIRE, Cal OES, the National Weather Service, PG&E, county burn lines, the mesh), and the record of when each went stale and came back.",
    data: [{ label: "Every upstream feed and its health", path: "/api/v1/sources" }],
    index: true,
    dataset: "Health and outage record of public hazard data feeds for the central Sierra",
  },
};
