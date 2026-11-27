import type { APIRoute } from "astro";
import { llmsTxt } from "../lib/seo-model";
import { snapshot } from "../lib/build/snapshot";
export const GET: APIRoute = async () => {
  const snap = await snapshot();
  return new Response(llmsTxt({ records: snap?.notable.items.length }), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
