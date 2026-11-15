import type { Page, Route } from "@playwright/test";

/**
 * Point the pages at another Grid API for one run: GRID_TEST_API_ORIGIN, for
 * example a sierra-data server on this machine (http://127.0.0.1:8188) while a
 * change to the API is not deployed yet. Unset, the pages use the public API
 * as built, which is what CI does. The product itself has no such switch.
 */
const origin = () => process.env.GRID_TEST_API_ORIGIN?.replace(/\/$/, "");

/** The API's own answer to a routed request, for a test that changes part of it. */
export function fromApi(route: Route) {
  const url = new URL(route.request().url());
  return route.fetch(origin() ? { url: origin() + url.pathname + url.search } : {});
}

export async function useApiOrigin(page: Page) {
  if (!origin()) return;
  await page.route("https://data.sierragridteam.org/**", async route => {
    try {
      const response = await fromApi(route);
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {}); // the page moved on and cancelled it
    }
  });
}
