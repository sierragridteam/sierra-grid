/**
 * What a page tells a reader that is not a browser: its address, the JSON it
 * is drawn from, its structured data, and the site's robots.txt, llms.txt and
 * sitemap. Pure, so every word of it is tested without a build.
 *
 * Nothing here states a live condition. A crawler's copy of a page is read
 * hours or weeks later, so it carries what a page is and where its data is,
 * never what the data said.
 */
import { views, viewFor, type View, type ViewId } from "../config/views.ts";
import { CORRIDOR_PLACE, DATA_ORIGIN, ORGANIZATION, SITE_NAME, SITE_ORIGIN, pageMeta, type DataLink } from "../config/site.ts";

export const absolute = (path: string) => new URL(path, SITE_ORIGIN).href;
export const dataUrl = (path: string) => new URL(path, DATA_ORIGIN).href;

/** A view that only sends its reader on is not a page of its own: its canonical address is where it lands. */
const LANDS_ON: Partial<Record<ViewId, ViewId>> = { EVACUATION: "WILDFIRE", changes: "events" };
export const canonicalPath = (view: View) => viewFor(LANDS_ON[view.id] ?? view.id).path;

export type Alternate = { href: string; type: string; title: string };
/** The page's data as `<link rel="alternate">`: the same resources the visible pointer names. */
export const alternates = (data: DataLink[]): Alternate[] =>
  data.map((d) => ({ href: dataUrl(d.path), type: d.type ?? "application/json", title: d.label }));

export type Head = { title: string; description: string; canonical: string; robots?: string; alternates: Alternate[] };
export function viewHead(view: View): Head {
  const meta = pageMeta[view.id];
  return {
    title: `${meta.title} · ${SITE_NAME}`,
    description: meta.description,
    canonical: absolute(canonicalPath(view)),
    robots: meta.index ? undefined : "noindex",
    alternates: alternates(meta.data),
  };
}

// ---- Addresses of reports ------------------------------------------------

/**
 * The path segment of a report's own page. Ids carry colons and dots
 * ("cc:hwy4:r2", "wx:urn:oid:2.49.0.1.840.0.b6bc…001.1"); a slug is the id in
 * lower case with every run of other characters as one hyphen. Two ids can in
 * principle share a slug; `slugIndex` refuses to build when they do.
 */
export const eventSlug = (id: string) => id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** The report's own page, for one that has one. */
export const recordPath = (id: string) => `/events/${eventSlug(id)}/`;
/**
 * The report in the live explorer: any report, at any saved revision. This is
 * the link the explorer itself writes (`stateUrl`), spelled out so that a
 * reader holding only an id can build it.
 */
export function deepLink(id: string, revision?: number | string) {
  const q = new URLSearchParams({ status: "all", record: id });
  if (revision !== undefined && revision !== "") q.set("revision", String(revision));
  return `/events/?${q}`;
}
/** Slugs by id. Throws when two ids would be served at one address. */
export function slugIndex(ids: string[]): Map<string, string> {
  const bySlug = new Map<string, string>(), out = new Map<string, string>();
  for (const id of ids) {
    const slug = eventSlug(id), taken = bySlug.get(slug);
    if (!slug) throw new Error(`Report id "${id}" has no usable slug`);
    if (taken !== undefined && taken !== id) throw new Error(`Reports "${taken}" and "${id}" share the slug "${slug}"`);
    bySlug.set(slug, id);
    out.set(id, slug);
  }
  return out;
}

// ---- Structured data -----------------------------------------------------

const ORG_ID = `${ORGANIZATION.url}#organization`, SITE_ID = `${SITE_ORIGIN}/#website`;
type Ld = Record<string, unknown>;

export const organizationLd = (): Ld => ({
  "@type": "NGO", "@id": ORG_ID, name: ORGANIZATION.name, alternateName: ORGANIZATION.fullName,
  url: ORGANIZATION.url, description: ORGANIZATION.description, sameAs: [...ORGANIZATION.sameAs],
  logo: absolute("/brand/sierra-logo-full.png"),
  areaServed: "Calaveras County and Tuolumne County, California",
});

export const websiteLd = (): Ld => ({
  "@type": "WebSite", "@id": SITE_ID, name: SITE_NAME, url: `${SITE_ORIGIN}/`, publisher: { "@id": ORG_ID }, inLanguage: "en-US",
  // The Search page takes its text from `q`, so a search box elsewhere can land on it.
  potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: `${SITE_ORIGIN}/search/?q={search_term_string}` }, "query-input": "required name=search_term_string" },
});

/**
 * The body of data a page shows, as a `Dataset`: what it is, who keeps it,
 * where it covers, and the public JSON it can be read from. No licence is
 * stated because none has been chosen for the data; that field is the
 * organisation's to fill.
 */
export function datasetLd(view: View): Ld | undefined {
  const meta = pageMeta[view.id];
  if (!meta.dataset) return undefined;
  return {
    "@type": "Dataset", "@id": `${absolute(view.path)}#dataset`, name: meta.dataset, description: meta.description, url: absolute(view.path),
    creator: { "@id": ORG_ID }, publisher: { "@id": ORG_ID }, isAccessibleForFree: true, inLanguage: "en-US",
    spatialCoverage: { "@type": "Place", name: CORRIDOR_PLACE },
    includedInDataCatalog: { "@type": "DataCatalog", name: "The Grid", url: `${DATA_ORIGIN}/` },
    distribution: meta.data.map((d) => ({ "@type": "DataDownload", name: d.label, encodingFormat: d.type ?? "application/json", contentUrl: dataUrl(d.path) })),
  };
}

export const breadcrumbLd = (trail: { name: string; path: string }[]): Ld => ({
  "@type": "BreadcrumbList",
  itemListElement: trail.map((step, i) => ({ "@type": "ListItem", position: i + 1, name: step.name, item: absolute(step.path) })),
});

/** One document for a page's structured data: the organisation and site travel with every graph so each node resolves. */
export const graph = (...nodes: (Ld | undefined)[]): Ld => ({ "@context": "https://schema.org", "@graph": nodes.filter(Boolean) });
export const viewLd = (view: View): Ld => graph(organizationLd(), websiteLd(), datasetLd(view));
/**
 * JSON for a `<script type="application/ld+json">`. "<" is written as its
 * escape so text from a source (a headline, an alert) cannot close the
 * element it sits in.
 */
export const ldJson = (value: Ld) => JSON.stringify(value).replace(/</g, "\\u003c");

// ---- robots.txt, llms.txt, sitemap --------------------------------------

/**
 * Crawlers this site is written for, named so that the invitation is on the
 * page rather than implied: search engines' and assistants' indexers, and the
 * fetchers that read a page on a person's behalf.
 */
export const NAMED_CRAWLERS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User",
  "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot",
] as const;
export function robotsTxt(): string {
  return [
    "# S.I.E.R.R.A Grid: public data from public sources. Every page may be read, indexed and quoted.",
    "# Pages load their live data in the browser; the same data is public JSON, described in /llms.txt.",
    "User-agent: *",
    ...NAMED_CRAWLERS.map((name) => `User-agent: ${name}`),
    "Allow: /",
    "",
    `Sitemap: ${absolute("/sitemap.xml")}`,
    "",
  ].join("\n");
}

export type SitemapEntry = { path: string; lastmod?: string };
const xml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
/** The pages worth a crawler's visit: every indexable view, then each report page given. */
export function sitemapEntries(records: SitemapEntry[] = []): SitemapEntry[] {
  return [...views.filter((view) => pageMeta[view.id].index && canonicalPath(view) === view.path).map((view) => ({ path: view.path })), ...records];
}
export function sitemapXml(entries: SitemapEntry[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map((e) => `  <url><loc>${xml(absolute(e.path))}</loc>${e.lastmod ? `<lastmod>${xml(e.lastmod)}</lastmod>` : ""}</url>`)
    .join("\n")}\n</urlset>\n`;
}

/**
 * /llms.txt: what the site is, what each page answers and the JSON behind it,
 * how to link to one report, and how to say where a fact came from. `records`
 * is how many reports have a page of their own in this build, when known.
 */
export function llmsTxt({ records }: { records?: number } = {}): string {
  const pages = views.filter((view) => pageMeta[view.id].index && canonicalPath(view) === view.path);
  // The sidebar's name for the first page; its route label ("Explore") names the section.
  const name = (view: View) => (view.id === "discover" ? "Overview" : view.label);
  const line = (view: View) => `- [${name(view)}](${absolute(view.path)}): ${pageMeta[view.id].description}`;
  const data = (view: View) => pageMeta[view.id].data.map((d) => `  - ${d.label}: ${dataUrl(d.path)}`).join("\n");
  return `# ${SITE_NAME}

> The public data explorer for the Ebbetts Pass corridor (Highway 4 between Angels Camp and Bear Valley, in Calaveras, Alpine and Tuolumne counties, California): roads and chain controls, weather, wildfires and evacuations, power outages, burn days and the SIERRA mesh radio network, from public sources, with every saved revision of every report. Built and run by ${ORGANIZATION.name}, the ${ORGANIZATION.fullName}, an all-volunteer non-profit.

Read this before quoting the site:

- The pages are a static shell. Live data is fetched by the browser from the public API at ${DATA_ORIGIN}. A fetch that runs no JavaScript gets each page's description, the record Grid held when the page was built (every statement in it carries its date), and the address of the JSON the page is drawn from. For what is true now, read that JSON, or use the MCP server below.
- Each page names its JSON in the HTML, as \`<link rel="alternate" type="application/json">\` and in the text.
- Nothing here is an all-clear. A source that failed or is stale means its hazard is unknown, not absent; the API says which (\`sourceStatus\`). Grid is reference only: official sources are linked from every report.
- Times on the pages are 24-hour Pacific time. Times in the API are RFC 3339 UTC.

## Pages

${pages.map(line).join("\n")}

## Data behind each page

${pages.map((view) => `- ${name(view)}\n${data(view)}`).join("\n")}

## Linking to one report

Every report (an incident, an alert, a fire, an outage, a road's status, a mesh node) has an id in the API (\`id\`, for example \`cc:hwy4:r2\`).

- Any report, live, in the explorer: \`${absolute("/events/")}?status=all&record=<id>\`. Add \`&revision=<n>\` for the report as it stood at saved revision n. URL-encode the id.
- Reports with a page of their own${records === undefined ? "" : ` (${records.toLocaleString("en-US")} in this build)`}: \`${absolute("/events/")}<slug>/\`, where the slug is the id in lower case with every run of characters other than a-z and 0-9 replaced by one hyphen (\`cc:hwy4:r2\` is \`${absolute(recordPath("cc:hwy4:r2"))}\`). These pages are plain HTML with the report's details, its timeline and what changed at each saved revision. They exist for wildfires, evacuations, weather alerts and chain controls, for power outages rated moderate or above, and for road incidents rated severe or above; a report keeps its page once it has one. Those whose report has ended are listed in the [sitemap](${absolute("/sitemap.xml")}) and are indexable; the ids of all of them are at ${absolute("/events/pages.json")}.
- The same report as JSON: \`${DATA_ORIGIN}/api/v1/events/<id>\`, and its revisions at \`${DATA_ORIGIN}/api/v1/events/<id>/history\`.

## Citing

Name the upstream source the report gives (\`provenance.attribution\`: Caltrans, CHP, CAL FIRE, the National Weather Service, PG&E, a county burn line) and say that it was read through ${SITE_NAME} (${SITE_ORIGIN}), with the time of the revision you are quoting. Link the report's own address above.

## API and tools

- [API description for language models](${DATA_ORIGIN}/llms.txt): every endpoint, parameters, caching and failure semantics
- [OpenAPI spec](${DATA_ORIGIN}/api/openapi.json): the complete contract
- [MCP server](${DATA_ORIGIN}/mcp): the same read-only data as Model Context Protocol tools, with no sign-in

## Optional

- [${ORGANIZATION.name}](${ORGANIZATION.url}): the organisation, its news and how to support it
- [Source health](${absolute("/sources/")}): whether each upstream feed is current
`;
}
