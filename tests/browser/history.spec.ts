import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { answer, useApiOrigin } from "./api-origin";
const ready = async (page: import("@playwright/test").Page) => expect(page.locator("#content")).toHaveAttribute("aria-busy", "false", { timeout: 45000 });
test.beforeEach(async ({ page }) => { await useApiOrigin(page); });

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
  // Standing state (a mesh node, a burn status, a monitored road) is not counted as events: the API says which reports are (nature).
  const happening = (e: any) => (e.nature && e.nature !== "EVENT_NATURE_UNSPECIFIED" ? e.nature !== "STATE" : e.layer !== "MESH");
  await expect(page.locator("#overview-summary h1")).toContainText(String(actual.events.filter(happening).length));
  await expect(page.locator("#overview-feed")).toHaveCount(0);
  // The severity sentence is the list's own count: read both off the page and compare.
  await expect(page.locator("#attention")).toHaveAttribute("aria-busy", "false");
  const badges = await page.locator("#attention li .badge").allInnerTexts();
  const extreme = badges.filter(b => /extreme/i.test(b)).length, severe = badges.filter(b => /severe/i.test(b)).length;
  const said = extreme ? `${extreme} ${extreme === 1 ? "is" : "are"} extreme.` : severe ? `${severe} ${severe === 1 ? "is" : "are"} severe.` : "None are rated severe or extreme.";
  await expect(page.locator("#overview-summary h1")).toContainText(said);
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

test("a selected report uses the DS record header, property list and close link, and gateway keys are identifier pills in its details and in what changed", async ({ page }) => {
  // What the first mesh report holds today is not the test's to depend on: every node is given the same
  // gateways, and every history the same three revisions, each the API's own with only the gateways set.
  // Revision 2 is the case that printed raw keys: a list of key hashes and the relay's name that becomes the name alone.
  const k1 = "0B0B037985E4980662D3E7862D35AEBB4A01642EECA2EEE561C5065D05C9ACF5", k2 = "0F0F038DE5FD9631E7C6E6DE50844A69E489DD94681640BB92ED8F1C177FFC13", k3 = "131248EED2B265E7C3D7E0FB50554699114E5C6317B6252A4E735EA9269D498E";
  const heardBy = (event: any, gateways: string[]) => ({ ...event, mesh: { ...event.mesh, telemetry: { ...event.mesh?.telemetry, gateways } } });
  await page.route(url => url.pathname === "/api/v1/events" && url.searchParams.get("layer") === "MESH", answer(body => ({ ...body, events: body.events.map((e: any) => heardBy(e, [k1, k3])) })));
  await page.route(url => /^\/api\/v1\/events\/[^/]+\/history$/.test(url.pathname), answer(body => {
    const saved = body.revisions[0];
    return { ...body, nextPageToken: "", revisions: [[k1, k3], ["relay"], [k1, k2, "relay"]].map((gateways, i) => ({ ...saved, kind: "CHANGE", revision: 3 - i, event: heardBy(saved.event, gateways) })) };
  }));
  await page.goto("/events/?layer=MESH"); await ready(page);
  const detail = page.locator("#browser-detail");
  await expect(detail.locator(".record-header .record-header__title")).toBeVisible();
  await expect(detail.locator(".ds-properties").first()).toBeVisible();
  // Gateway hash lists render as six-character identifier pills, never a raw comma blob.
  const pills = detail.locator(".ds-property").filter({ hasText: "Gateways" }).locator(".ds-id-pills code");
  await expect(pills).toHaveText([k1.slice(0, 6), k3.slice(0, 6)]);
  await expect(pills.first()).toHaveAttribute("title", k1);
  // What changed: entries that left and joined as pills, with the whole key in the title; the entry that stayed is counted.
  const changed = detail.locator("#report-versions sierra-data-diff li").filter({ has: page.locator(".ds-diff-field", { hasText: "Gateways" }) });
  await expect(changed).toHaveCount(2, { timeout: 30000 });
  const entries = (row: number, kind: "added" | "removed") => changed.nth(row).locator(`.ds-id-pills--diff li[data-kind="${kind}"] code`);
  await expect(entries(0, "removed")).toHaveText(["relay"]);
  await expect(entries(0, "added")).toHaveText([k1.slice(0, 6), k3.slice(0, 6)]);
  await expect(entries(1, "removed")).toHaveText([k1.slice(0, 6), k2.slice(0, 6)]);
  await expect(entries(1, "removed").first()).toHaveAttribute("title", k1);
  await expect(entries(1, "added")).toHaveCount(0);
  await expect(changed.nth(1).locator(".ds-diff-kept")).toHaveText("1 unchanged");
  // No whole key is printed in what changed, in a list or alone (a JSON array of keys has no ", " between them),
  // and no run of keys anywhere in the report (its own id, one key, is given whole at the foot).
  await expect(detail.locator("#report-versions")).not.toContainText(/[0-9a-f]{16,}/i);
  await expect(detail).not.toContainText(/[0-9a-f]{16,}"?,\s*"?[0-9a-f]{16,}/i);
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

test("the overview ends with who runs The Grid and how to support it", async ({ page }) => {
  await page.goto("/"); await ready(page);
  const about = page.locator("#overview-about");
  await expect(about.locator(".card--panel")).toHaveCount(2);
  await expect(about.getByRole("link", { name: "Visit sierragridteam.org" })).toHaveAttribute("href", "https://sierragridteam.org/");
  await expect(about.getByRole("link", { name: "Donate to S.I.E.R.R.A" })).toHaveAttribute("href", "https://sierragridteam.org/donate");
  // Last on the page: nothing the page loads later lands below it.
  expect(await about.evaluate(el => el.parentElement?.lastElementChild === el)).toBe(true);
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

test("the revisions view lists what was saved in its period", async ({ page }) => {
  // A fixed period ending now: the last three days of revisions.
  const period = new URLSearchParams({ time: "fixed", mode: "history", from: new Date(Date.now() - 3 * 86400000).toISOString(), to: new Date(Date.now() + 3600000).toISOString(), selection: "none" });
  const failed: string[] = [];
  page.on("response", response => { const url = new URL(response.url()); if (url.pathname === "/api/v1/history" && !response.ok()) failed.push(`${response.status()} ${url.search}`); });
  await page.goto("/events/?" + period); await ready(page);
  expect(failed, "the archive answered every request").toEqual([]);
  await expect(page.locator("#content .callout")).toHaveCount(0);
  await expect(page.locator(".feed-item").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#browser-count")).toContainText("revisions");
  await expect(page.locator(".browser-day").first()).toBeVisible();
});
