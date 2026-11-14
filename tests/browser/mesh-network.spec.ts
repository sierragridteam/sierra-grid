import { test, expect } from "@playwright/test";
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
  await page.waitForTimeout(500);
  // A regional node (labelled, focus) at its projected position.
  const point = await host.evaluate((el: any) => {
    const i = el.data.features.findIndex((f: any) => f.properties.kind === "node" && f.properties.focus);
    const p = el.map.project(el.data.features[i].geometry.coordinates), r = el.map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, label: el.data.features[i].properties.label };
  });
  await page.mouse.click(point.x, point.y);
  const card = page.locator(".ds-map-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: "Node report →" })).toBeVisible();
  await expect(page.locator(".mesh-inspect")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  // The close button works too.
  await page.mouse.click(point.x, point.y);
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("a page-sized map holds its place before it loads, and zooms with Ctrl + wheel while a plain wheel scrolls the page", async ({ page }) => {
  await page.route("**/styles/positron*", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.goto("/roads/", { waitUntil: "domcontentloaded" });
  const slot = page.locator("#roads-map");
  await slot.waitFor({ state: "attached" });
  const reserved = (await slot.boundingBox())!.height;
  expect(reserved).toBeGreaterThan(400);
  await expect(slot.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  expect(Math.abs((await slot.boundingBox())!.height - reserved)).toBeLessThan(12);
  const canvas = slot.locator(".maplibregl-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const zoom = () => page.locator("#roads-map sierra-geo-map").evaluate((el: any) => el.map.getZoom());
  const z0 = await zoom(), y0 = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 240); await page.waitForTimeout(600);
  expect(await zoom()).toBe(z0);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(y0);
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -400); await page.waitForTimeout(1200); await page.keyboard.up("Control");
  expect(await zoom()).toBeGreaterThan(z0);
});
