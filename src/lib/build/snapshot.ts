/**
 * The reads a build makes of the public API, once, for everything that is
 * prerendered: the record on each page and the pages of single reports.
 * Server only (Astro frontmatter and endpoints); the browser never loads it.
 *
 * A production build that cannot read a list fails, and the site already
 * deployed stays up with its own dated record: publishing pages without the
 * record would delete every report's page. One report's revisions failing is
 * not that: its page says they could not be read. A development server
 * renders without the record instead, so it starts offline.
 */
import { createSierraClient, type EventQuery } from "@sierragridteam/sdk";
import { GRID_API_ORIGIN } from "../client";
import { corridor } from "../state";
import type { Report, Revision } from "../event-model";
import { NOTABLE, POWER_WEEKS, ROAD_DAYS, SOURCE_DAYS, periodFrom, type History, type Snapshot } from "../prerender-model";

const origin = GRID_API_ORIGIN.startsWith("//") ? `https:${GRID_API_ORIGIN}` : GRID_API_ORIGIN;
const client = createSierraClient({ baseUrl: origin, timeoutMs: 30_000 });
const EVERY_STATUS = ["ACTIVE", "SCHEDULED", "RESOLVED", "EXPIRED"] as EventQuery["status"];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One read, tried three times: a build an hour should not fail on one dropped connection. */
async function read<T>(what: string, call: () => Promise<{ notModified: false; data: T } | { notModified: true; data: undefined }>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await wait(1500 * attempt);
    try {
      const result = await call();
      if (result.notModified) throw new Error("no body");
      return result.data;
    } catch (error) { last = error; }
  }
  throw new Error(`Grid API: ${what} could not be read (${last instanceof Error ? last.message : "unknown error"})`);
}

/** A paged list followed to its end, or to `cap` pages; `incomplete` when the service still had more. */
async function pages<T>(cap: number, page: (pageToken: string) => Promise<{ items: T[]; next: string }>): Promise<{ items: T[]; incomplete: boolean }> {
  const items: T[] = [];
  let token = "";
  for (let n = 0; n < cap; n++) {
    const result = await page(token);
    items.push(...result.items);
    token = result.next || "";
    if (!token) break;
  }
  return { items, incomplete: !!token };
}
const events = (what: string, query: EventQuery, cap = 10) =>
  pages<Report>(cap, async (pageToken) => {
    const data = await read(what, () => client.listEvents({ pageSize: 200, geometryFormat: "NONE", ...query, ...(pageToken ? { pageToken } : {}) } as EventQuery));
    return { items: data.events as Report[], next: data.nextPageToken };
  });
const revisions = (what: string, query: { place?: string; layer: string[]; from: string; to: string }, cap = 5) =>
  pages<Revision>(cap, async (pageToken) => {
    const data = await read(what, () => client.listHistory({ pageSize: 200, geometryFormat: "NONE", ...query, ...(pageToken ? { pageToken } : {}) } as Parameters<typeof client.listHistory>[0]));
    return { items: data.revisions as Revision[], next: data.nextPageToken };
  });

/** A report's own revisions: one page of the newest. A failure is that report's alone. */
async function history(id: string, kind: ("CHANGE" | "READING")[]): Promise<History | undefined> {
  try {
    const data = await read(`revisions of ${id}`, () => client.getEventHistory(id, { pageSize: 100, geometryFormat: "NONE", kind }));
    return { revisions: data.revisions as Revision[], complete: !data.nextPageToken };
  } catch (error) {
    console.warn(`[snapshot] ${error instanceof Error ? error.message : error}; its page will say so`);
    return undefined;
  }
}
/** `work` over `items`, a few at a time: a few hundred reports' revisions without a burst at the API. */
async function each<T, U>(items: T[], limit: number, work: (item: T) => Promise<U>): Promise<U[]> {
  const out = new Array<U>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await work(items[i]); }
  }));
  return out;
}

async function load(): Promise<Snapshot> {
  const builtAt = Date.now(), to = new Date(Math.ceil(builtAt / 3_600_000) * 3_600_000).toISOString();
  const roadFrom = periodFrom(builtAt, ROAD_DAYS), sourceFrom = periodFrom(builtAt, SOURCE_DAYS);
  const [notableLists, segments, roadRevisions, burn, sources, health, healthRevisions, mesh, power, scanners, cameras] = await Promise.all([
    Promise.all(NOTABLE.map((rule) => events(`${rule.layer} reports`, { place: corridor, layer: [rule.layer], status: EVERY_STATUS, ...(rule.severityMin ? { severityMin: rule.severityMin } : {}) } as EventQuery))),
    events("monitored roads", { place: corridor, layer: ["ROAD_SEGMENT"] } as EventQuery, 2),
    revisions("the road record", { place: corridor, layer: ["CHAIN_CONTROL", "ROAD_SEGMENT"], from: new Date(roadFrom).toISOString(), to }),
    events("burn status", { place: corridor, layer: ["BURN_STATUS"] } as EventQuery, 2),
    read("sources", () => client.listSources()),
    events("source health", { layer: ["SOURCE_HEALTH"] } as EventQuery, 3),
    revisions("the source record", { layer: ["SOURCE_HEALTH"], from: new Date(sourceFrom).toISOString(), to }),
    events("mesh nodes", { place: corridor, layer: ["MESH"] } as EventQuery, 5),
    events("past power interruptions", { place: corridor, layer: ["POWER"], status: ["RESOLVED", "EXPIRED"], since: new Date(builtAt - POWER_WEEKS * 7 * 86_400_000).toISOString() } as EventQuery, 12),
    read("scanner feeds", () => client.listScanners({ place: corridor })),
    read("road cameras", () => client.listCameras({ place: corridor })),
  ]);
  const notable = { items: notableLists.flatMap((list) => list.items), incomplete: notableLists.some((list) => list.incomplete) };
  const histories = await each(notable.items, 6, (report) => history(report.id, ["CHANGE"]));
  const burnHistories = await each(burn.items, 2, (report) => history(report.id, ["CHANGE", "READING"]));
  return {
    builtAt, notable,
    histories: Object.fromEntries(notable.items.map((report, i) => [report.id, histories[i]])),
    roads: { segments: segments.items, revisions: roadRevisions.items, incomplete: roadRevisions.incomplete, days: ROAD_DAYS, from: roadFrom },
    burn: { events: burn.items, histories: Object.fromEntries(burn.items.map((report, i) => [report.id, burnHistories[i]])) },
    sources: { rows: sources.sources, health: health.items, revisions: healthRevisions.items, incomplete: healthRevisions.incomplete, days: SOURCE_DAYS, from: sourceFrom },
    mesh, power: { ...power, weeks: POWER_WEEKS },
    scanners: scanners.scanners, cameras: cameras.cameras,
  };
}

let pending: Promise<Snapshot | undefined> | undefined, loadedAt = 0;
/**
 * The build's snapshot: read once and shared by every page. Undefined only
 * on a development server that could not reach the API (pages then render
 * without the record); a production build throws instead. A development
 * server reads it again after five minutes.
 */
export function snapshot(): Promise<Snapshot | undefined> {
  if (pending && (!import.meta.env.DEV || Date.now() - loadedAt < 300_000)) return pending;
  loadedAt = Date.now();
  return (pending = load().catch((error) => {
    if (!import.meta.env.DEV) throw error;
    console.warn(`[snapshot] ${error instanceof Error ? error.message : error}; rendering without the record`);
    return undefined;
  }));
}
