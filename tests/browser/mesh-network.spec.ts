import { test, expect, type Page } from "@playwright/test";
import { answer } from "./api-origin";
const ready = async (page: import("@playwright/test").Page) => expect(page.locator("#content")).toHaveAttribute("aria-busy", "false", { timeout: 30000 });

test("a mesh directory row opens the node report with its measurements in the sidebar", async ({ page }) => {
  const telemetry: string[] = [];
  page.on("request", request => { if (request.url().includes("/mesh/telemetry")) telemetry.push(request.url()); });
  await page.goto("/mesh/"); await ready(page);
  // The overview: live header, KPIs, a large map, and the fleet dashboard.
  await expect(page.locator(".mesh-live")).toContainText("Live");
  await expect(page.locator(".mesh-kpis .stat")).toHaveCount(5);
  await expect(page.locator("#mesh-network-map sierra-geo-map.ds-map-large")).toBeVisible();
  await expect(page.locator(".mesh-heat .ds-heatmap")).toBeVisible({ timeout: 45000 });
  await expect(page.locator(".mesh-attention")).toBeVisible();
  // Fleet telemetry: one archive per monitored node, no more.
  const monitored = await page.locator("#mesh-node-rows tr").filter({ hasText: /Reachable|Unreachable/ }).count();
  expect(telemetry.length).toBe(monitored);
  const before = telemetry.length;
  // A monitored node has measurements; pick one from the directory (battery column shows a reading).
  const row = page.locator("#mesh-node-rows tr").filter({ hasText: /Reachable/ }).first();
  test.skip(!(await row.count()), "No monitored node in the live directory");
  await row.locator("a").click(); await ready(page);
  expect(new URL(page.url()).pathname).toBe("/events/");
  expect(new URL(page.url()).searchParams.get("record")).toMatch(/^meshcore:/);
  // Measurements sit in the sidebar above the timeline: every measurement with data, no picker.
  const card = page.locator("#browser-detail .report-aside .report-block", { hasText: "Measurements" });
  await expect(card.locator(".ds-trend").first()).toBeVisible({ timeout: 30000 });
  expect(await card.locator(".ds-trend").count()).toBeGreaterThan(1);
  await expect(card.locator(".ds-trend", { hasText: "Battery voltage" }).locator("sierra-sparkline")).toBeVisible();
  const headings = await page.locator("#browser-detail .report-aside .report-block h3").allTextContents();
  expect(headings.indexOf("Measurements")).toBeGreaterThanOrEqual(0);
  expect(headings.indexOf("Measurements")).toBeLessThan(headings.findIndex((h) => h.startsWith("Timeline")));
  expect(telemetry.length).toBeGreaterThan(before);
  const afterReport = telemetry.length;
  await card.getByRole("radio", { name: "7 days" }).check();
  await expect.poll(() => telemetry.length).toBeGreaterThan(afterReport);
});

test("clicking a node on the map opens its card over the map", async ({ page }) => {
  await page.goto("/mesh/"); await ready(page);
  const host = page.locator("#mesh-network-map sierra-geo-map");
  await expect.poll(() => host.evaluate((el: any) => !!el.map?.getLayer("ds-points")), { timeout: 30000 }).toBe(true);
  // A regional node (labelled, focus) at its projected position. The position is read once the map has
  // come to rest and again for every click: the map fits its focus after its layers exist, and a live
  // refresh can redraw it, so a point projected half a second after load was sometimes not where the node was.
  const atRest = () => expect.poll(() => host.evaluate((el: any) => !el.map.isMoving()), { timeout: 30000 }).toBe(true);
  const nodePoint = () => host.evaluate((el: any) => {
    const i = el.data.features.findIndex((f: any) => f.properties.kind === "node" && f.properties.focus);
    const p = el.map.project(el.data.features[i].geometry.coordinates), r = el.map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, label: el.data.features[i].properties.label };
  });
  const card = page.locator(".ds-map-card");
  // A click that lands while the map is redrawn opens nothing; it is made again at the node's new position.
  const clickNode = () => expect(async () => {
    await atRest(); const point = await nodePoint(); await page.mouse.click(point.x, point.y);
    await expect(card).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
  await clickNode();
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: "Node report →" })).toBeVisible();
  await expect(page.locator(".mesh-inspect")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  // The close button works too.
  await clickNode();
  await card.getByRole("button", { name: "Close details" }).click();
  await expect(card).toHaveCount(0);
});

test("an old node measurements link redirects to the node's report", async ({ page }) => {
  await page.goto("/mesh/"); await ready(page);
  const href = await page.locator("#mesh-node-rows a").first().getAttribute("href");
  const key = new URL(href!, page.url()).searchParams.get("record")!.replace("meshcore:", "");
  await page.goto(`/mesh/?node=${key}`); await ready(page);
  await expect.poll(() => new URL(page.url()).searchParams.get("record")).toBe(`meshcore:${key}`);
});

test("a failed telemetry archive leaves an explicit state in the report", async ({ page }) => {
  await page.route("https://data.sierragridteam.org/api/v1/mesh/telemetry*", route => route.abort());
  await page.goto("/mesh/"); await ready(page);
  const row = page.locator("#mesh-node-rows tr").filter({ hasText: /Reachable/ }).first();
  test.skip(!(await row.count()), "No monitored node in the live directory");
  await row.locator("a").click(); await ready(page);
  await expect(page.locator("#browser-detail")).toContainText("Measurements could not load", { timeout: 30000 });
});

test("the relay section says whether each gateway is up and which radios each reporter reads", async ({ page }) => {
  await page.goto("/mesh/"); await ready(page);
  const panel = page.locator(".mesh-relay");
  await expect(panel.locator(".mesh-relay__group").first()).toBeVisible({ timeout: 30000 });
  // The relay leads, with a reporting state and at least one radio, each with a status and a link to its report.
  const relay = panel.locator(".mesh-relay__group").first();
  await expect(relay.locator(".mesh-relay__name .badge")).toHaveText(/Reporting|Stale|Not reporting/);
  const rows = relay.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(rows.first().locator("td[data-label='Status'] .badge")).toHaveText(/Up|Not read|No answer|Reachable|Read overdue/);
  await expect(rows.first().locator("th a")).toHaveAttribute("href", /record=meshcore%3A/);
  await page.setViewportSize({ width: 390, height: 844 });
  // Polled: a chart keeps its old canvas width for a moment after the viewport shrinks.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

/**
 * The Roads page with its map held at a known moment. `routes` holds the road
 * layer, without which the page mounts no map: until it is let through, the
 * slot is the empty placeholder. `basemap` holds the map's style, without
 * which the map element is on the page and still says "Loading map.".
 * Moments are held and let go, not timed: the test measured after fixed waits
 * before, and what it measured depended on how fast the page loaded.
 *
 * The style is a plain ground, answered here: what is tested is the page's
 * layout and the map's gestures, and the real basemap's tiles are a third
 * party's (when its style takes over five seconds the map says "Geometry
 * only" in a note over the canvas, which is not what is tested here).
 */
async function roadsMap(page: Page) {
  const gate = () => { let open!: () => void; const held = new Promise<void>(resolve => { open = resolve; }); return { held, open }; };
  const routes = gate(), basemap = gate();
  const ground = { version: 8, sources: {}, layers: [{ id: "ground", type: "background", paint: { "background-color": "#e9e4d8" } }] };
  await page.route(url => url.pathname.endsWith("/map/road_segment.geojson"), async route => { await routes.held; await answer(body => body)(route); });
  await page.route("**/styles/positron*", async route => { await basemap.held; await route.fulfill({ json: ground, headers: { "access-control-allow-origin": "*" } }).catch(() => {}); });
  await page.goto("/roads/", { waitUntil: "domcontentloaded" });
  const slot = page.locator("#roads-map");
  await slot.waitFor({ state: "attached" });
  const height = async () => (await slot.boundingBox())!.height;
  /**
   * Loaded: the map is built and its "Loading map." line is gone, which the element does in the same step as
   * fitting the routes. (MapLibre's own `loaded()` is no use here: a map with moving dashes is always drawing.)
   */
  const loaded = async () => {
    routes.open(); basemap.open();
    await expect(slot.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30000 });
    await expect(slot.locator("sierra-geo-map [role=status]").first()).toBeHidden({ timeout: 30000 });
  };
  return { slot, height, routes, basemap, loaded };
}

test("a page-sized map stands where its placeholder stood, and zooms with Ctrl + wheel while a plain wheel scrolls the page", async ({ page }) => {
  const { slot, height, loaded } = await roadsMap(page);
  // Before the routes arrive there is no map, only the room kept for it.
  await expect(slot.locator("sierra-geo-map")).toHaveCount(0);
  const reserved = await height();
  expect(reserved).toBeGreaterThan(400);
  await loaded();
  expect(Math.abs(await height() - reserved)).toBeLessThan(2);
  const canvas = slot.locator(".maplibregl-canvas");
  const overMap = async () => {
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  };
  // Read once the map has fitted its routes: before that the zoom is the map's starting one, and the fit changes it.
  const zoom = () => slot.locator("sierra-geo-map").evaluate((el: any) => el.map.getZoom());
  await overMap();
  const z0 = await zoom(), y0 = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y0);
  expect(await zoom()).toBe(z0);
  await overMap();
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -400);
  await expect.poll(zoom).toBeGreaterThan(z0);
  await page.keyboard.up("Control");
});

test("a page-sized map does not move the page while it loads", async ({ page }) => {
  // The map's "Loading map." line is a note over the canvas (design system 0.9.11). Before that it took a line of
  // its own under the canvas until MapLibre had loaded, 49px, and everything below the map dropped and came back.
  const { slot, height, routes, loaded } = await roadsMap(page);
  await expect(slot.locator("sierra-geo-map")).toHaveCount(0);
  const reserved = await height();
  // The map element is on the page and its basemap has not answered: the longest a reader waits on a slow connection.
  routes.open();
  await expect(slot.locator("sierra-geo-map [role=status]").first()).toHaveText("Loading map.", { timeout: 30000 });
  const loading = await height();
  await loaded();
  expect(Math.abs(await height() - reserved)).toBeLessThan(2);
  expect(Math.abs(loading - reserved)).toBeLessThan(2);
});
