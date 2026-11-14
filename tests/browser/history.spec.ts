import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const ready = async (page: import("@playwright/test").Page) => expect(page.locator("#content")).toHaveAttribute("aria-busy", "false", { timeout: 45000 });

test("old History links open Events with past reports included", async ({ page }) => {
  await page.goto("/history/?layer=ROAD_INCIDENT");
  await expect(page).toHaveURL(/\/events\//, { timeout: 30000 }); await ready(page);
  expect(new URL(page.url()).searchParams.get("layer")).toBe("ROAD_INCIDENT");
  expect(new URL(page.url()).searchParams.get("status")).toBe("all");
  await expect(page.locator('.grid-sidebar [data-view="changes"]')).toHaveCount(0);
});

test("event filters and selection are shareable, and the homepage feed uses live records", async ({ page }) => {
  let actual: any;
  page.on("response", async response => {
    const url = new URL(response.url());
    if (url.pathname === "/api/v1/events" && !url.searchParams.has("layer") && url.searchParams.get("pageSize") === "200") actual = await response.json();
  });
  await page.goto("/"); await ready(page);
  await expect.poll(() => actual?.events?.length).toBeGreaterThan(0);
  // Mesh node records are network observations, not counted as events.
  await expect(page.locator("#overview-summary h1")).toContainText(String(actual.events.filter((e: any) => e.layer !== "MESH").length));
  await expect(page.locator("#overview-feed")).toHaveCount(0);
  await expect(page.locator("#overview-summary")).not.toContainText("Worth your attention");
  await page.locator("#overview-summary").getByRole("link", { name: "Browse all events" }).click(); await ready(page);
  await page.locator(".feed-item a").first().click(); await ready(page);
  await expect(page.locator("#browser-detail h2")).toBeVisible();
  await expect(page.locator("#browser-detail sierra-geo-map .maplibregl-ctrl-top-right")).toHaveCSS("position", "absolute");
  await page.getByRole("link", { name: "Close report", exact: true }).click(); await ready(page);
  await page.locator("#browser-type").click();
  await page.locator('#browser-type-options [data-value="POWER"]').click(); await ready(page);
  await page.locator("#browser-status").click();
  await page.locator('#browser-status-options [data-value="all"]').click(); await ready(page);
  await page.reload(); await ready(page);
  expect(new URL(page.url()).searchParams.get("layer")).toBe("POWER");
  expect(new URL(page.url()).searchParams.get("status")).toBe("all");
  await expect(page.locator(".feed-item").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("main")).not.toContainText(/copy curl|protojson|query params|GET \/api/);
});

test("report selections update only the detail pane; Back and Forward step through them", async ({ page }) => {
  const listRequests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (request.headers()["sec-purpose"]?.includes("prefetch")) return;
    if (url.pathname === "/api/v1/events" || url.pathname === "/burn/") listRequests.push(url.href);
  });
  await page.goto("/weather/"); await expect(page.locator("#content")).toBeVisible();
  await page.goto("/burn/"); await ready(page);
  await expect(page.locator(".feed-item")).toHaveCount(2);
  const initial = new URL(page.url()).searchParams.get("record");
  const list = await page.locator("#browser-list").elementHandle();
  const sameList = () => list!.evaluate(el => el === document.getElementById("browser-list"));
  const beforeRequests = listRequests.length;
  const historyLength = await page.evaluate(() => history.length);
  // Whole-row target: a click near the row's bottom-left corner, away from the title, selects it.
  const row = page.locator(".feed-item").nth(1);
  const box = (await row.boundingBox())!;
  await row.click({ position: { x: 12, y: box.height - 8 } }); await ready(page);
  const second = new URL(page.url()).searchParams.get("record");
  expect(second).not.toBe(initial);
  await expect(page.locator(".feed-item").nth(1).locator(".feed-item__title a")).toHaveAttribute("aria-current", "true");
  expect(await sameList()).toBe(true);
  expect(listRequests.length).toBe(beforeRequests);
  // Choosing a report is a step: one new history entry.
  expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
  await expect(page.locator(".browser-selection")).toHaveCSS("border-left-style", "solid");
  await expect(page.locator(".report-version .ds-diff").first()).toBeVisible();
  // Back returns to the report before, on the same page (the router mounts it again from the URL).
  await page.goBack(); await ready(page);
  await expect.poll(() => new URL(page.url()).searchParams.get("record")).toBe(initial);
  expect(new URL(page.url()).pathname).toBe("/burn/");
  await expect(page.locator(".feed-item").nth(0).locator(".feed-item__title a")).toHaveAttribute("aria-current", "true");
  await page.goForward(); await ready(page);
  await expect.poll(() => new URL(page.url()).searchParams.get("record")).toBe(second);
  await expect(page.locator(".feed-item.is-selected .feed-item__title a")).toHaveAttribute("href", new RegExp(`record=${encodeURIComponent(second!)}`));
  // Closing is a step too: Back reopens the report.
  await page.getByRole("link", { name: "Close report", exact: true }).click(); await ready(page);
  await expect(page.locator(".browser-selection")).toBeHidden();
  expect(new URL(page.url()).searchParams.get("selection")).toBe("none");
  await page.goBack(); await ready(page);
  await expect.poll(() => new URL(page.url()).searchParams.get("record")).toBe(second);
  await expect(page.locator(".browser-selection")).toBeVisible();
  // Leaving the page and coming back restores the selection from the URL.
  await page.getByRole("link", { name: "Weather", exact: true }).click(); await ready(page);
  await page.goBack(); await ready(page);
  expect(new URL(page.url()).pathname).toBe("/burn/");
  expect(new URL(page.url()).searchParams.get("record")).toBe(second);
  await expect(page.locator(".browser-results")).toBeVisible();
});

test("on a phone, Back from an open report returns to the list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/burn/"); await ready(page);
  await expect(page.locator(".browser-selection")).toBeHidden();
  expect(new URL(page.url()).searchParams.has("record")).toBe(false);
  await page.locator(".feed-item").first().click(); await ready(page);
  await expect(page.locator(".browser-selection")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("record")).toBeTruthy();
  await page.goBack(); await ready(page);
  await expect(page.locator(".browser-selection")).toBeHidden();
  expect(new URL(page.url()).pathname).toBe("/burn/");
  expect(new URL(page.url()).searchParams.has("record")).toBe(false);
  await expect(page.locator(".feed-item").first()).toBeVisible();
});

test("a late detail response cannot replace a newer selection", async ({ page }) => {
  await page.goto("/burn/"); await ready(page);
  const rows = page.locator(".feed-item");
  const firstId = new URL((await rows.first().locator("a").getAttribute("href"))!, page.url()).searchParams.get("record");
  const firstTitle = await rows.first().locator("h3").textContent();
  const secondId = new URL((await rows.nth(1).locator("a").getAttribute("href"))!, page.url()).searchParams.get("record");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finished!: () => void;
  const completed = new Promise<void>(resolve => { finished = resolve; });
  let held = false;
  await page.route("https://data.sierragridteam.org/api/v1/events/*/history*", async route => {
    if (!decodeURIComponent(new URL(route.request().url()).pathname).includes(secondId!)) return route.continue();
    try {
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response }).catch(() => {}); // The old request is expected to be cancelled.
    } finally { finished(); }
  });
  try {
    await rows.nth(1).locator("a").click();
    await expect.poll(() => held, { timeout: 30000 }).toBe(true);
    await rows.first().locator("a").click();
    release();
    await ready(page);
    expect(new URL(page.url()).searchParams.get("record")).toBe(firstId);
    await expect(page.locator("#browser-detail h2")).toHaveText(firstTitle!);
    await expect(rows.first().locator(".feed-item__title a")).toHaveAttribute("aria-current", "true");
  } finally { release(); await completed; }
});

test("a selected report uses the DS record header, property list and close link", async ({ page }) => {
  await page.goto("/events/?layer=MESH"); await ready(page);
  const detail = page.locator("#browser-detail");
  await expect(detail.locator(".record-header .record-header__title")).toBeVisible();
  await expect(detail.locator(".ds-properties").first()).toBeVisible();
  // Gateway hash lists render as six-character identifier pills, never a raw comma blob.
  const pills = detail.locator(".ds-property .ds-id-pills code");
  if (await pills.count()) {
    expect((await pills.first().textContent())!.length).toBe(6);
    expect((await pills.first().getAttribute("title"))!.length).toBeGreaterThan(6);
  }
  await expect(detail).not.toContainText(/[0-9a-f]{16,},\s*[0-9a-f]{16,}/i);
  await expect(page.getByRole("link", { name: "Browse history" })).toHaveCount(0);
  await detail.getByRole("link", { name: "Close report", exact: true }).click(); await ready(page);
  await expect(page.locator(".browser-selection")).toBeHidden();
  expect(new URL(page.url()).searchParams.get("selection")).toBe("none");
});

test("the overview shows highway message signs instead of camera stills", async ({ page }) => {
  await page.goto("/"); await ready(page);
  await expect(page.locator("#overview-signs")).not.toContainText("Reading highway signs");
  await expect(page.locator("#overview-camera-grid")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
  const signs = page.locator("#overview-signs .message-sign");
  if (await signs.count()) await expect(signs.first().locator(".message-sign__face")).toHaveAttribute("aria-label", /^Sign (reads|is blank)|not in service/);
});

test("the report list loads the next page as its end scrolls into reach", async ({ page }) => {
  await page.goto("/events/?status=all"); await ready(page);
  const rows = page.locator("#browser-list .feed-item");
  const more = page.locator("sierra-load-more");
  await expect(more).toBeVisible();
  test.skip(!(await more.getByRole("button").count()), "Fewer than one page of live reports");
  const before = await rows.count();
  // With a report selected on desktop the results column is its own scroll container.
  await page.locator(".browser-results").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(() => rows.count(), { timeout: 30000 }).toBeGreaterThan(before);
  expect(Number(new URL(page.url()).searchParams.get("pages"))).toBeGreaterThanOrEqual(2);
  // The button is still there for keyboard users while more pages exist.
  await expect(more.getByRole("button", { name: /Load more reports|Try again/ })).toHaveCount(1);
});
