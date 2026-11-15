import type { Page } from "@playwright/test";

/**
 * Point the pages at another Grid API for one run: GRID_TEST_API_ORIGIN, for
 * example a sierra-data server on this machine (http://127.0.0.1:8188) while a
 * change to the API is not deployed yet. Unset, the pages use the public API
 * as built, which is what CI does. The product itself has no such switch.
 */
export async function useApiOrigin(page: Page) {
  const origin = process.env.GRID_TEST_API_ORIGIN?.replace(/\/$/, "");
  if (!origin) return;
  await page.route("https://data.sierragridteam.org/**", async route => {
    const url = new URL(route.request().url());
    try {
      const response = await route.fetch({ url: origin + url.pathname + url.search });
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {}); // the page moved on and cancelled it
    }
  });
}
