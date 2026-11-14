import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function ready(page: import("@playwright/test").Page) {
  await expect(page.locator("#content")).toHaveAttribute("aria-busy", "false", {
    timeout: 30000,
  });
}

test("static onboarding, lazy domains and persistent DS shell survive route revisits", async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await ready(page);
  await expect(page.locator("#overview-summary .summary-banner")).toBeVisible();
  expect(requests.some((u) => /\/mesh\.[^/]+\.js/.test(u))).toBe(false);
  expect(requests.some((u) => u.includes("/mesh/telemetry"))).toBe(false);
  await page.evaluate(() => {
    (window as any).__originalBrand = document.querySelector(".sidebar .logo");
    (window as any).__documentMarker = "same-session";
  });
  const before = await page.locator(".sidebar .logo").evaluate((el) => ({
    color: getComputedStyle(el).color,
    font: getComputedStyle(el).fontFamily,
  }));
  await page.locator('.grid-sidebar a[data-view="roads"]').click();
  await ready(page);
  await expect(page).toHaveURL(/\/roads\//);
  await page.locator('.grid-sidebar a[data-view="discover"]').click();
  await ready(page);
  expect(
    await page.evaluate(
      () =>
        (window as any).__originalBrand ===
        document.querySelector(".sidebar .logo"),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => (window as any).__documentMarker)).toBe(
    "same-session",
  );
  expect(
    await page.locator(".sidebar .logo").evaluate((el) => ({
      color: getComputedStyle(el).color,
      font: getComputedStyle(el).fontFamily,
    })),
  ).toEqual(before);
  expect(errors).toEqual([]);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

test("domain defaults and direct links work; malformed state is normalized", async ({
  page,
}) => {
  // Earthquakes has no page any more.
  expect((await page.request.get("/earthquakes/")).status()).toBe(404);
  await page.goto("/weather/");
  await ready(page);
  for (const key of ["mode", "from", "to", "layer", "metric"]) expect(new URL(page.url()).searchParams.has(key), key).toBe(false);
  await page.goto("/mesh/?from=invalid&to=nope&metric=__proto__&node=bad");
  await ready(page);
  expect(new URL(page.url()).searchParams.has("metric")).toBe(false); // __proto__ falls back to the default metric
  expect(new URL(page.url()).searchParams.has("node")).toBe(false);
  await expect(page.locator("#mesh-node-rows a").first()).toBeVisible();
  // Invalid intervals fall back to the domain lens, which needs no URL params.
  expect(new URL(page.url()).searchParams.has("from")).toBe(false);
});

test("a failed summary does not hide onboarding, and retry has one page lifetime", async ({
  page,
}) => {
  await page.route("https://data.sierragridteam.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/");
  await ready(page);
  await expect(page.locator("#attention")).toContainText(
    "could not be checked",
  );
  await expect(
    page.getByRole("link", { name: "Explore roads", exact: true }),
  ).toBeVisible();
  await page.unroute("https://data.sierragridteam.org/**");
  await page.getByRole("button", { name: "Retry current reports" }).click();
  await ready(page);
  await expect(page.locator("#attention")).not.toContainText(
    "could not be checked",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

test("departed view cannot overwrite new page after a delayed response", async ({
  page,
}) => {
  let requested = false;
  await page.route(
    "https://data.sierragridteam.org/api/v1/conditions*",
    async (route) => {
      requested = true;
      await new Promise((r) => setTimeout(r, 1200));
      try {
        await route.continue();
      } catch {}
    },
  );
  await page.goto("/weather/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => requested).toBe(true);
  await page.locator('.grid-sidebar a[data-view="roads"]').click();
  await ready(page);
  await page.waitForTimeout(1600);
  await expect(page).toHaveURL(/\/roads\//);
  await expect(page.locator("#content .grid-hero .kicker")).toContainText("Roads");
  await expect(page.locator("#chart-wrap")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("source reports retain list context and expose source text and saved changes", async ({ page }) => {
  await page.goto("/burn/");
  await ready(page);
  const first = page.locator(".feed-item a").nth(1);
  await expect(first).toBeVisible();
  const id = new URL((await first.getAttribute("href"))!, page.url()).searchParams.get("record");
  await first.click();
  await ready(page);
  expect(new URL(page.url()).searchParams.get("record")).toBe(id);
  await expect(page.locator(".browser-results")).toBeVisible();
  await expect(page.locator("#browser-detail h2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Version history", exact: true })).toBeVisible();
  await expect(page.locator("#browser-detail")).not.toContainText("protojson");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Close report", exact: true }).click();
  await ready(page);
  expect(new URL(page.url()).searchParams.has("record")).toBe(false);
  await expect(page.locator(".feed-item a").first()).toBeVisible();
});

test("fixed corridor and DS mobile navigation work without global scope controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?place=calaveras-county");
  await ready(page);
  expect(new URL(page.url()).searchParams.has("place")).toBe(false);
  await expect(page.locator("#scope, #edit-scope, #place")).toHaveCount(0);
  await expect(page.locator(".grid-sidebar")).toHaveJSProperty("inert", true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.locator('.grid-sidebar [data-view="discover"]'),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator('.grid-sidebar [data-view="events"]').click();
  await ready(page);
  await expect(page.locator(".grid-shell")).toHaveAttribute(
    "data-drawer",
    "closed",
  );
  await expect(page.locator("select:visible")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("roads answer first, then routes, map, work, signs and quiet cameras", async ({ page }) => {
  await page.goto("/roads/");
  await ready(page);
  await expect(page.locator(".roads-answer")).not.toHaveText("Checking the roads…", { timeout: 30000 });
  await expect(page.locator(".roads-kpis .stat")).toHaveCount(6);
  await expect(page.locator(".roads-kpis .stat").nth(1)).toContainText("Chain controls");
  await expect(page.locator(".roads-corridors .ds-corridor").first()).toBeVisible();
  await expect(page.locator("#roads-map sierra-geo-map.ds-map-large")).toBeVisible();
  // No tabs: everything is on the page, cameras last.
  await expect(page.locator("[data-road-panel]")).toHaveCount(0);
  const panels = await page.locator(".roads-dashboard > section").evaluateAll((els) => els.map((el) => el.className));
  expect(panels.at(-1)).toContain("roads-cameras");
  // A scheduled job links to its report.
  const job = page.locator(".roads-schedule .ds-schedule__title a").first();
  if (await job.count()) {
    expect(new URL((await job.getAttribute("href"))!, page.url()).searchParams.get("record")).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("weather answers first, places towns against the snow level, and source health has no irrelevant scope editor", async ({
  page,
}) => {
  await page.goto("/weather/");
  await ready(page);
  await expect(page.locator(".weather-answer")).not.toHaveText(/Checking|unavailable/);
  await expect(page.locator(".weather-kpis .stat")).toHaveCount(5);
  // Hwy 4 towns climb left to right.
  const dots = page.locator(".weather-climb .ds-profile__dot");
  expect(await dots.count()).toBeGreaterThan(2);
  const first = (await dots.first().boundingBox())!, last = (await dots.last().boundingBox())!;
  expect(last.y).toBeLessThan(first.y);
  expect(last.x).toBeGreaterThan(first.x);
  // One row per town in the hourly grid; the measurement and units switch its legend.
  expect(await page.locator(".weather-hours .ds-heatmap__label").count()).toBeGreaterThan(3);
  await page.getByRole("radio", { name: "°F · ft", exact: true }).check();
  await page.getByRole("radio", { name: "Gusts", exact: true }).check();
  await expect(page.locator(".weather-hours .ds-heatmap__legend")).toContainText("mph");
  await page.getByRole("radio", { name: "°C · m", exact: true }).check();
  await expect(page.locator(".weather-hours .ds-heatmap__legend")).toContainText("km/h");
  await expect(page.locator("#weather-map .maplibregl-canvas, #weather-map canvas").first()).toBeVisible();
  await expect(page.locator(".weather-week .ds-day").first()).toBeVisible();
  await expect(page.locator("#chart-wrap")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.grid-sidebar a[data-view="sources"]').click();
  await ready(page);
  await expect(page.locator("#edit-scope, #scope")).toHaveCount(0);
  await expect(page.locator("#view-period")).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("wildfires and power answer first and keep the season's record; evacuations and earthquakes have left the sidebar", async ({ page }) => {
  await page.goto("/wildfires/");
  await ready(page);
  await expect(page.locator(".conditions-answer")).not.toHaveText(/Checking/);
  expect(await page.locator(".conditions-kpis .stat").count()).toBeGreaterThanOrEqual(4);
  await expect(page.locator(".conditions-footnote")).toContainText("Updated");
  await expect(page.locator("#status")).toHaveText("");
  await expect(page.locator('.grid-sidebar [data-view="EVACUATION"], .grid-sidebar [data-view="EARTHQUAKE"]')).toHaveCount(0);
  // A fire in the season's table opens its report on Events.
  const fire = page.locator(".conditions-table tbody th a").first();
  if (await fire.count()) {
    await fire.click();
    await ready(page);
    expect(new URL(page.url()).pathname).toBe("/events/");
    expect(new URL(page.url()).searchParams.get("record")).toBeTruthy();
    await expect(page.locator("#browser-detail h2")).toBeVisible();
  }
  // The old evacuations page lands on wildfires.
  await page.goto("/evacuations/");
  await ready(page);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/wildfires/");
  await expect(page.locator('.grid-sidebar [data-view="WILDFIRE"]')).toHaveAttribute("aria-current", "page");
  await page.goto("/power/");
  await ready(page);
  await expect(page.locator(".conditions-answer")).not.toHaveText(/Checking/);
  await expect(page.locator(".conditions-kpis .stat")).toHaveCount(5);
  await expect(page.locator(".conditions-dashboard sierra-bar-chart, .conditions-dashboard .meta").first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("preview=live shows the live layout from past records and says it is a test", async ({ page }) => {
  await page.goto("/wildfires/?preview=live");
  await ready(page);
  // The switch exists only in development builds or a build made with PUBLIC_GRID_PREVIEW=1; a normal build ignores it.
  if (!(await page.locator(".conditions-preview").count())) {
    await expect(page.locator(".conditions-answer--alarm")).toHaveCount(await page.locator(".conditions-live").count() ? 1 : 0);
    test.skip(true, "preview is not enabled in this build");
  }
  await expect(page.locator(".conditions-preview")).toContainText("Test view, not live");
  // The season has fires on record, so one is shown as active.
  await expect(page.locator(".conditions-answer--alarm")).toBeVisible();
  await expect(page.locator(".conditions-live .feed-item").first()).toBeVisible();
  expect(new URL(page.url()).searchParams.get("preview")).toBe("live");
  // The switch does not follow you to other pages, and the way back drops it.
  await expect(page.locator('.grid-sidebar [data-view="roads"]')).not.toHaveAttribute("href", /preview/);
  await page.locator(".conditions-preview a").click();
  await ready(page);
  expect(new URL(page.url()).searchParams.has("preview")).toBe(false);
  await expect(page.locator(".conditions-preview")).toHaveCount(0);
  await page.goto("/power/?preview=live");
  await ready(page);
  await expect(page.locator(".conditions-preview")).toContainText("Test view, not live");
});

test("source health answers first with an aligned table; scanner feeds are cards that open Broadcastify", async ({ page }) => {
  await page.goto("/sources/");
  await ready(page);
  await expect(page.locator(".sources-answer")).toHaveText(/sources are current/);
  await expect(page.locator(".sources-kpis .stat")).toHaveCount(4);
  expect(await page.locator(".sources-table tbody tr:not(.sources-group)").count()).toBeGreaterThan(8);
  // Every status badge starts at the same x: one table, not a grid per row.
  const xs = await page.locator(".sources-table td[data-label='Status'] .badge").evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().x)))]);
  expect(xs).toHaveLength(1);
  await expect(page.locator(".sources-table a[href='/earthquakes/']")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/scanners/");
  await ready(page);
  await expect(page.locator("#content h1")).toHaveCount(1);
  const feeds = page.locator(".scanners-feed");
  expect(await feeds.count()).toBeGreaterThan(0);
  await expect(feeds.first().getByRole("link", { name: /^Listen to .* on Broadcastify$/ })).toHaveAttribute("href", /broadcastify\.com/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the 404 page keeps the shell and its address, and leads back to real pages", async ({ page }) => {
  await page.goto("/404.html");
  await expect(page.locator("#content")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#content h1")).toHaveText("There is nothing at this address");
  // It is not rewritten to a real route, and no view loads into it.
  expect(new URL(page.url()).pathname).toBe("/404.html");
  await expect(page.locator(".grid-sidebar .nav-link.is-active")).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.locator(".not-found-places a", { hasText: "Roads" }).click();
  await ready(page);
  expect(new URL(page.url()).pathname).toBe("/roads/");
  await expect(page.locator(".roads-answer")).toBeVisible();
});

test("camera transport failure leaves an explicit state and source links", async ({
  page,
}) => {
  await page.route("**/*", (route) => {
    if (
      route.request().resourceType() === "image" &&
      !["localhost", "127.0.0.1"].includes(
        new URL(route.request().url()).hostname,
      )
    )
      return route.abort();
    return route.continue();
  });
  await page.goto("/cameras/");
  await ready(page);
  const cameras = page.locator(".road-camera-image img");
  test.skip((await cameras.count()) === 0, "No live camera images returned");
  await page.locator(".road-camera-image").first().scrollIntoViewIfNeeded();
  await expect(
    page.locator('[data-camera-state="error"]').first(),
  ).toContainText("Camera image unavailable");
  await expect(
    page.getByRole("link", { name: "Full image", exact: true }).first(),
  ).toBeVisible();
});
