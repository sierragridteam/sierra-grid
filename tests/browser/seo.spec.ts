import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ready = (page: import("@playwright/test").Page) => expect(page.locator("#content")).toHaveAttribute("aria-busy", "false", { timeout: 30000 });
/** The first report page the sitemap lists: an ended report, whatever the live data holds today. */
async function firstRecord(request: import("@playwright/test").APIRequestContext) {
  const xml = await (await request.get("/sitemap.xml")).text();
  const path = /<loc>https:\/\/grid\.sierragridteam\.org(\/events\/[a-z0-9-]+\/)<\/loc>/.exec(xml)?.[1];
  expect(path, "the sitemap lists at least one report page").toBeTruthy();
  return path!;
}

test("robots.txt, llms.txt and the sitemap are served, and the sitemap's pages exist", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Sitemap: https://grid.sierragridteam.org/sitemap.xml");
  const llms = await (await request.get("/llms.txt")).text();
  expect(llms).toMatch(/^# S\.I\.E\.R\.R\.A Grid/);
  expect(llms).toContain("https://data.sierragridteam.org/llms.txt");
  const xml = await (await request.get("/sitemap.xml")).text();
  const paths = [...xml.matchAll(/<loc>https:\/\/grid\.sierragridteam\.org([^<]*)<\/loc>/g)].map((m) => m[1]);
  expect(paths).toContain("/roads/");
  expect(paths).not.toContain("/search/");
  for (const path of paths.slice(0, 20)) expect((await request.get(path)).status(), path).toBe(200);
});

test("every page's head names its own title, canonical address and data", async ({ page }) => {
  const titles = new Set<string>();
  for (const path of ["/", "/roads/", "/weather/", "/wildfires/", "/power/", "/burn/", "/mesh/", "/sources/", "/events/"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    titles.add(await page.title());
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://grid.sierragridteam.org${path}`);
    expect(await page.locator('link[rel="alternate"][type$="json"]').count(), path).toBeGreaterThan(0);
    for (const href of await page.locator('link[rel="alternate"][type$="json"]').evaluateAll((links) => links.map((l) => (l as HTMLLinkElement).href)))
      expect(href).toMatch(/^https:\/\/data\.sierragridteam\.org\/api\/v1\//);
    const graph = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!)["@graph"];
    expect(graph.some((node: { "@type": string }) => node["@type"] === "NGO")).toBe(true);
  }
  expect(titles.size).toBe(9);
  // A route that sends its reader on: read as served, since the browser has left it by the time it settles.
  const sent = await (await page.request.get("/evacuations/")).text();
  expect(sent).toContain('<meta name="robots" content="noindex">');
  expect(sent).toContain('<link rel="canonical" href="https://grid.sierragridteam.org/wildfires/">');
});

test("without JavaScript a page shows where its data is and the record as built, and nothing about now", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const [path, heading] of [["/roads/", "Chain controls and road status on record"], ["/burn/", "burn line: each recorded call"], ["/wildfires/", "Wildfires on record"], ["/", "What Grid has on record"]] as const) {
    await page.goto(path);
    const fallback = page.locator(".grid-static");
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText("This page loads its live data in the browser");
    await expect(fallback).toContainText(/when the page was built, [A-Z][a-z]{2} \d{1,2}, 20\d\d, \d\d:\d\d PT/);
    await expect(fallback.locator("h2").filter({ hasText: heading }).first()).toBeVisible();
    await expect(fallback.locator(".grid-static__data a").first()).toHaveAttribute("href", /^https:\/\/data\.sierragridteam\.org\/api\/v1\//);
    await expect(page.locator(".grid-loading")).toBeHidden();
    // Every time on the record carries its year: it is read later than it was written.
    for (const text of await fallback.locator("time").allTextContents()) expect(text).toMatch(/, 20\d\d, \d\d:\d\d PT$/);
    expect(await fallback.innerText()).not.toMatch(/\b(\d+ (m|h|min|days?) ago|just now)\b/);
  }
  await context.close();
});

test("with JavaScript the record gives way to the live view and is never shown beside it", async ({ page }) => {
  await page.goto("/roads/", { waitUntil: "commit" });
  // Before the view mounts the fallback is in the document but not on screen.
  if (await page.locator(".grid-static").count()) await expect(page.locator(".grid-static")).toBeHidden();
  await ready(page);
  await expect(page.locator("[data-static-fallback]")).toHaveCount(0);
  await expect(page.locator("#content h1")).toHaveCount(1);
  await page.goto("/");
  await ready(page);
  await expect(page.locator("[data-static-fallback]")).toHaveCount(0);
  await expect(page.locator("#overview-summary .summary-banner")).toBeVisible();
});

test("a report's page is whole without JavaScript, sits under Events, and opens the live report", async ({ page, browser, request }) => {
  const path = await firstRecord(request);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const plain = await context.newPage();
  await plain.goto(path);
  await expect(plain.locator("h1")).toHaveCount(1);
  await expect(plain.locator(".record-page .callout")).toContainText(/At Grid's last saved revision, .* this report had ended/);
  await expect(plain.locator("#report-versions h2")).toHaveText("Revision history");
  await expect(plain.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://grid.sierragridteam.org${path}`);
  expect(await plain.locator('meta[name="robots"]').count(), "an ended report is offered to search engines").toBe(0);
  await context.close();

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await ready(page);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.locator(".grid-sidebar a.is-active")).toHaveText("Events");
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  // From another page, through the router: the sidebar's mark follows.
  await page.goto("/roads/");
  await ready(page);
  await page.evaluate((to) => { const a = document.createElement("a"); a.href = to; a.id = "to-record"; a.textContent = "report"; document.querySelector("#main")!.append(a); }, path);
  await page.locator("#to-record").click();
  await expect(page.locator(".record-page h1")).toBeVisible();
  await expect(page.locator(".grid-sidebar a.is-active")).toHaveText("Events");
  const title = await page.locator(".record-page h1").textContent();
  await page.locator(".record-page__actions a.link-more").click();
  await ready(page);
  await expect(page).toHaveURL(/\/events\/\?status=all&record=/);
  await expect(page.locator("#browser-detail .record-header__title")).toHaveText(title!.replace(/\s·\s.*$/, ""));
  expect(errors).toEqual([]);
});

test("a report's page fits a phone", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(await firstRecord(request));
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
