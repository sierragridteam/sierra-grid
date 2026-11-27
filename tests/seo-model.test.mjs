import { test } from "node:test";
import assert from "node:assert/strict";
import {
  absolute, alternates, canonicalPath, datasetLd, deepLink, eventSlug, ldJson, llmsTxt, recordPath, robotsTxt, sitemapEntries, sitemapXml, slugIndex, viewHead, viewLd,
} from "../src/lib/seo-model.ts";
import { views, viewFor } from "../src/config/views.ts";
import { pageMeta } from "../src/config/site.ts";
import { parseState, stateUrl } from "../src/lib/state.ts";

test("every page has its own title and description, and none is the old shared sentence", () => {
  const titles = new Set(), descriptions = new Set();
  for (const view of views) {
    const head = viewHead(view);
    assert.match(head.title, / · S\.I\.E\.R\.R\.A Grid$/, view.id);
    assert.ok(head.description.length >= 50 && head.description.length <= 260, `${view.id}: ${head.description.length} characters`);
    titles.add(head.title); descriptions.add(head.description);
  }
  assert.equal(titles.size, views.length);
  assert.equal(descriptions.size, views.length);
});

test("a page's alternates are its data on the public API, typed, and never another origin", () => {
  for (const view of views) {
    const head = viewHead(view);
    assert.ok(head.alternates.length, `${view.id} names its data`);
    for (const a of head.alternates) {
      assert.ok(a.href.startsWith("https://data.sierragridteam.org/api/v1/"), a.href);
      assert.equal(a.type, a.href.includes(".geojson") ? "application/geo+json" : "application/json");
      assert.ok(a.title);
    }
  }
  assert.deepEqual(alternates([{ label: "x", path: "/api/v1/sources" }]), [{ href: "https://data.sierragridteam.org/api/v1/sources", type: "application/json", title: "x" }]);
});

test("a route that only sends its reader on is not indexed, and its canonical address is where it lands", () => {
  assert.equal(canonicalPath(viewFor("EVACUATION")), "/wildfires/");
  assert.equal(canonicalPath(viewFor("changes")), "/events/");
  assert.equal(viewHead(viewFor("EVACUATION")).robots, "noindex");
  assert.equal(viewHead(viewFor("changes")).canonical, "https://grid.sierragridteam.org/events/");
  assert.equal(viewHead(viewFor("search")).robots, "noindex", "a tool, with no content of its own");
  assert.equal(viewHead(viewFor("roads")).robots, undefined);
  assert.equal(viewHead(viewFor("roads")).canonical, "https://grid.sierragridteam.org/roads/");
});

test("the sitemap lists indexable pages once each, then report pages with when they were last saved", () => {
  const paths = sitemapEntries().map((e) => e.path);
  assert.equal(new Set(paths).size, paths.length);
  for (const gone of ["/search/", "/evacuations/", "/history/"]) assert.ok(!paths.includes(gone), gone);
  for (const kept of ["/", "/roads/", "/burn/", "/wildfires/", "/sources/"]) assert.ok(paths.includes(kept), kept);
  const xml = sitemapXml(sitemapEntries([{ path: "/events/cc-hwy4-r2/", lastmod: "2026-11-24T02:36:12.000Z" }, { path: "/events/a&b/" }]));
  assert.match(xml, /<loc>https:\/\/grid\.sierragridteam\.org\/events\/cc-hwy4-r2\/<\/loc><lastmod>2026-11-24T02:36:12\.000Z<\/lastmod>/);
  assert.match(xml, /a&amp;b/, "an address is escaped");
  assert.ok(!/<loc>[^<]*roads[^<]*<\/loc><lastmod>/.test(xml), "a view claims no modification time: its content is live");
});

test("a report's slug is its id in lower case with other characters as hyphens, and two ids cannot share one", () => {
  assert.equal(eventSlug("cc:hwy4:r2"), "cc-hwy4-r2");
  assert.equal(eventSlug("evac:US-CA-XCA-CCU-043"), "evac-us-ca-xca-ccu-043");
  assert.equal(eventSlug("wx:urn:oid:2.49.0.1.840.0.b6bc.001.1"), "wx-urn-oid-2-49-0-1-840-0-b6bc-001-1");
  assert.equal(recordPath("pge:417130"), "/events/pge-417130/");
  assert.deepEqual([...slugIndex(["a:b", "c:d", "a:b"])], [["a:b", "a-b"], ["c:d", "c-d"]]);
  assert.throws(() => slugIndex(["a:b", "a.b"]), /share the slug "a-b"/);
  assert.throws(() => slugIndex([":::"]), /no usable slug/);
});

test("the documented link to a live report is the one the explorer itself writes", () => {
  const events = parseState(new URL("https://grid.test/events/"));
  assert.equal(deepLink("cc:hwy4:r2"), stateUrl({ ...events, eventStatus: "all", record: "cc:hwy4:r2" }));
  assert.equal(deepLink("cc:hwy4:r2", 23), stateUrl({ ...events, eventStatus: "all", record: "cc:hwy4:r2", revision: "23" }));
  const back = parseState(new URL(deepLink("evac:US-CA-XCA-CCU-043", 2), "https://grid.test"));
  assert.equal(back.record, "evac:US-CA-XCA-CCU-043");
  assert.equal(back.revision, "2");
  assert.equal(back.topic, "events");
});

test("structured data names the organisation once and gives a dataset its JSON, with no licence invented", () => {
  const roads = viewLd(viewFor("roads"));
  assert.equal(roads["@context"], "https://schema.org");
  const [org, site, dataset] = roads["@graph"];
  assert.equal(org["@type"], "NGO");
  assert.equal(org.alternateName, "Signal Integrity & Emergency Radio Response Alliance");
  assert.equal(site.publisher["@id"], org["@id"]);
  assert.match(site.potentialAction.target.urlTemplate, /\/search\/\?q=\{search_term_string\}$/);
  assert.equal(dataset["@type"], "Dataset");
  assert.equal(dataset.creator["@id"], org["@id"]);
  assert.deepEqual(dataset.distribution.map((d) => d.contentUrl), viewHead(viewFor("roads")).alternates.map((a) => a.href));
  assert.ok(!("license" in dataset), "none has been chosen for the data");
  assert.equal(datasetLd(viewFor("search")), undefined);
  assert.equal(viewLd(viewFor("search"))["@graph"].length, 2, "a page with no data of its own carries only the organisation and the site");
  for (const view of views) if (pageMeta[view.id].dataset) assert.ok(pageMeta[view.id].index, `${view.id}: a dataset is on a page that is indexed`);
});

test("structured data cannot close the script element it sits in", () => {
  const json = ldJson({ headline: "</script><script>alert(1)</script>" });
  assert.ok(!json.includes("</script>"));
  assert.equal(JSON.parse(json).headline, "</script><script>alert(1)</script>");
});

test("robots.txt invites every crawler, names the assistants', and points at the sitemap", () => {
  const text = robotsTxt();
  assert.match(text, /^User-agent: \*$/m);
  for (const name of ["GPTBot", "ClaudeBot", "PerplexityBot", "OAI-SearchBot"]) assert.match(text, new RegExp(`^User-agent: ${name}$`, "m"));
  assert.match(text, /^Allow: \/$/m);
  assert.ok(!/^Disallow:/m.test(text));
  assert.match(text, /^Sitemap: https:\/\/grid\.sierragridteam\.org\/sitemap\.xml$/m);
  // One group: every User-agent line comes before the one rule.
  assert.ok(text.lastIndexOf("User-agent:") < text.indexOf("Allow:"));
});

test("llms.txt says what a scriptless fetch gets, where the live data is, and how to link one report", () => {
  const text = llmsTxt({ records: 226 });
  assert.match(text, /^# S\.I\.E\.R\.R\.A Grid\n\n> /);
  assert.match(text, /A fetch that runs no JavaScript gets/);
  assert.match(text, /Nothing here is an all-clear/);
  assert.match(text, /\(226 in this build\)/);
  assert.ok(text.includes("https://grid.sierragridteam.org/events/?status=all&record=<id>"));
  assert.ok(text.includes(absolute(recordPath("cc:hwy4:r2"))));
  assert.ok(text.includes("https://data.sierragridteam.org/mcp"));
  for (const view of views) {
    const listed = text.includes(`](${absolute(view.path)}): `);
    assert.equal(listed, pageMeta[view.id].index && canonicalPath(view) === view.path, view.id);
  }
  assert.ok(!llmsTxt().includes("in this build"), "no count when the build did not read one");
});
