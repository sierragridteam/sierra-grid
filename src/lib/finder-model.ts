/**
 * The Search page: one box across reports, mesh nodes, roads, cameras and
 * scanner feeds. The Grid service finds and ranks; this module decides how
 * the page groups the answer and what it says about it, so that a kind that
 * could not be searched reads as unknown and an empty answer never reads as
 * "nothing happened".
 */
import type { V1SearchHit, V1SearchKind, V1SearchResults } from "@sierragridteam/sdk";

/**
 * The kinds this explorer has a page for, in the order the page shows them.
 * Places are left out: Grid is one corridor and has no page per place.
 */
export const finderKinds = ["EVENT", "MESH_NODE", "ROAD", "CAMERA", "SCANNER"] as const satisfies readonly V1SearchKind[];
export type FinderKind = (typeof finderKinds)[number];

const names: Record<FinderKind, { one: string; many: string; title: string }> = {
  EVENT: { one: "report", many: "reports", title: "Reports" },
  MESH_NODE: { one: "mesh node", many: "mesh nodes", title: "Mesh nodes" },
  ROAD: { one: "road", many: "roads", title: "Roads" },
  CAMERA: { one: "camera", many: "cameras", title: "Road cameras" },
  SCANNER: { one: "scanner feed", many: "scanner feeds", title: "Scanner feeds" },
};
/** The singular and plural of a kind, for a count. */
export const kindNoun = (kind: FinderKind) => ({ one: names[kind].one, many: names[kind].many });
/**
 * The kinds that are reports, which the page can list in full, newest first.
 * The best few of a kind answer "where is it"; the full list answers "what
 * has been said about it".
 */
export const listedKinds = ["EVENT", "MESH_NODE"] as const;
export type ListedKind = (typeof listedKinds)[number];
// Every layer but the mesh, as the service's EVENT kind counts them: the link's total and
// the list it opens must be the same set.
const reportLayers = ["WILDFIRE", "EVACUATION", "WEATHER_ALERT", "EARTHQUAKE", "ROAD_INCIDENT", "POWER", "BURN_STATUS"] as const;
/** The layers a listed kind covers: a mesh node is a report on the mesh layer. */
export const kindLayers = (kind: ListedKind) => kind === "MESH_NODE" ? ["MESH"] as const : reportLayers;
/** The link from the best few to the full list. */
export const allOfKind = (kind: ListedKind, total: number) => `All ${count(kind, total)}, newest first`;

const count = (kind: FinderKind, n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? names[kind].one : names[kind].many}`;

export type FinderGroup = {
  kind: FinderKind;
  title: string;
  hits: V1SearchHit[];
  /** Every match of this kind, of which `hits` are the best few. */
  total: number;
  /** "Showing the best 5 of 22", when there are more than shown. */
  more: string;
};

export type FinderAnswer = {
  /** Kinds with at least one hit, in page order. */
  groups: FinderGroup[];
  /** One line above the results. */
  summary: string;
  /** Kinds the service could not search: their absence is unknown, not none. */
  unsearched: string;
  /** True when nothing matched in any kind that was searched. */
  empty: boolean;
};

/** Shapes the service's answer for the page. */
export function finderAnswer(result: Pick<V1SearchResults, "hits" | "totals" | "unavailable">): FinderAnswer {
  const totals = new Map(result.totals.map(t => [t.kind, t.matches]));
  const groups: FinderGroup[] = [];
  for (const kind of finderKinds) {
    const hits = result.hits.filter(hit => hit.kind === kind);
    if (!hits.length) continue;
    // A total below what is shown would be the service contradicting itself; show what is there.
    const total = Math.max(totals.get(kind) ?? hits.length, hits.length);
    groups.push({ kind, title: names[kind].title, hits, total, more: total > hits.length ? `Showing the best ${hits.length} of ${total.toLocaleString("en-US")}` : "" });
  }
  const down = finderKinds.filter(kind => result.unavailable.includes(kind));
  const unsearched = down.length
    ? `${list(down.map(kind => names[kind].title))} could not be searched just now. Finding none of them here does not mean nothing matches.`
    : "";
  const all = groups.reduce((n, g) => n + g.total, 0);
  return {
    groups, unsearched, empty: !groups.length,
    summary: groups.length ? `${all.toLocaleString("en-US")} ${all === 1 ? "match" : "matches"}: ${list(groups.map(g => count(g.kind, g.total)))}` : "",
  };
}

const list = (items: string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const keptSince = (since: string | null | undefined) => since && Number.isFinite(Date.parse(since))
  ? new Date(since).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric" })
  : "";

/** What an empty full list of one kind may and may not be taken to mean. */
export function listEmpty(kind: ListedKind, query: string, since: string | null | undefined) {
  const from = keptSince(since);
  return {
    title: `No ${names[kind].one} matches “${query}”`,
    body: `No ${kind === "MESH_NODE" ? "mesh node" : "report, current or past,"}${from ? ` kept since ${from}` : ""} has those words. ` +
      "Try fewer or other words; a road can be typed any way (“hwy 4”, “SR 4”). Finding nothing does not establish clear conditions.",
  };
}

/** What "nothing found" may and may not be taken to mean. */
export function finderEmpty(query: string, since: string | null | undefined) {
  const from = keptSince(since);
  return {
    title: `Nothing matches “${query}”`,
    body: `No report${from ? ` kept since ${from}` : ""}, mesh node, road, camera or scanner feed has those words. ` +
      "Try fewer or other words; a road can be typed any way (“hwy 4”, “SR 4”). Finding nothing does not establish clear conditions.",
  };
}
