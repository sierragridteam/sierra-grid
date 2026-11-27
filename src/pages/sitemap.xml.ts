import type { APIRoute } from "astro";
import { sitemapEntries, sitemapXml } from "../lib/seo-model";
import { snapshot } from "../lib/build/snapshot";
import { recordPage } from "../lib/prerender-model";
/** Every indexable view, then each ended report's page with when it was last saved. */
export const GET: APIRoute = async () => {
  const snap = await snapshot();
  const records = (snap?.notable.items ?? [])
    .map((report) => recordPage(report, snap!.histories[report.id], snap!.builtAt))
    .filter((page) => page.indexable)
    .map((page) => ({ path: page.path, lastmod: page.lastSaved }));
  return new Response(sitemapXml(sitemapEntries(records)), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
