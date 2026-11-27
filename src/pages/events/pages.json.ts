import type { APIRoute } from "astro";
import { snapshot } from "../../lib/build/snapshot";
/**
 * The ids of every report with a page in this build. The next build reads it
 * from the published site, so a report keeps its page once it has one.
 */
export const GET: APIRoute = async () => {
  const snap = await snapshot();
  return new Response(JSON.stringify({ builtAt: snap ? new Date(snap.builtAt).toISOString() : null, ids: (snap?.notable.items ?? []).map((report) => report.id) }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
