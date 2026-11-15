import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { useApiOrigin } from "./api-origin";

const ready = async (page: Page) => expect(page.locator("#content")).toHaveAttribute("aria-busy", "false", { timeout: 45000 });
const settled = async (page: Page) => expect(page.locator("#browser-count")).not.toHaveText(/Searching|Loading/, { timeout: 30000 });
/** Requests for the events list, as the page sent them. */
function listRequests(page: Page) {
  const seen: URL[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/events" && !request.headers()["sec-purpose"]?.includes("prefetch")) seen.push(url);
  });
  return seen;
}
const total = async (page: Page) => Number((await page.locator("#browser-count").innerText()).match(/^([\d,]+) reports? match/)?.[1].replace(/,/g, ""));

test.beforeEach(async ({ page }) => { await useApiOrigin(page); });

test("search asks the service, counts every match, combines with filters, survives a reload and resets", async ({ page }) => {
  const requests = listRequests(page);
  await page.goto("/events/?selection=none"); await ready(page);
  await expect(page.locator(".feed-item").first()).toBeVisible({ timeout: 30000 });
  // No labels above the controls: each filter names itself.
  await expect(page.locator("#browser-type")).toHaveAccessibleName("Type: Any type");
  await expect(page.locator("#browser-status")).toHaveAccessibleName("Status: Current");
  await expect(page.locator(".filter-bar .is-applied")).toHaveCount(0);
  await expect(page.locator(".filter-reset")).toHaveCount(0);
  const row = async () => JSON.stringify(await Promise.all(["#browser-type", "#browser-status", "#browser-severity"].map(async id => { const b = (await page.locator(id).boundingBox())!; return [Math.round(b.x), Math.round(b.width)]; })));
  const rowBefore = await row();
  const list = await page.locator("#browser-list").elementHandle();
  const word = (await page.locator(".feed-item h2, .feed-item h3").first().innerText()).split(/\s+/).find(w => /^[a-z]{5,}$/i.test(w))!;
  expect(word, "a headline word to search for").toBeTruthy();

  await page.locator("h1").click();
  await page.keyboard.press("/");
  await expect(page.locator("#browser-search")).toBeFocused();
  await page.keyboard.type(word.toUpperCase());
  await expect(page.locator("#browser-count")).toContainText(/reports? match/, { timeout: 30000 });
  await settled(page);
  // The service was asked, with the text and as a search box asks (the last word still being typed).
  const asked = requests.filter(url => url.searchParams.get("q"));
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.at(-1)!.searchParams.get("q")).toBe(word.toUpperCase());
  expect(asked.at(-1)!.searchParams.get("qTyping")).toBe("true");
  // Typing a word is one question, not one per letter, and the list element is not rebuilt.
  expect(asked.length).toBeLessThanOrEqual(3);
  expect(await list!.evaluate(el => el === document.getElementById("browser-list"))).toBe(true);
  await expect(page.locator("#browser-search")).toBeFocused();
  // The count is the service's, over every page: with nothing more to load it is the rows shown.
  const matched = await total(page);
  expect(matched).toBeGreaterThan(0);
  if (!/shown/.test(await page.locator("#browser-count").innerText())) await expect(page.locator(".feed-item")).toHaveCount(matched);
  // The report the word came from is among them.
  await expect(page.locator(".feed-item").filter({ hasText: new RegExp(word, "i") }).first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(word.toUpperCase());

  await page.reload(); await ready(page);
  await expect(page.locator("#browser-search")).toHaveValue(word.toUpperCase());
  await settled(page);
  expect(await total(page)).toBe(matched);

  // A search nothing matches says what was searched, not that conditions are clear.
  await page.locator("#browser-search").fill("zzzz-no-such-report");
  await expect(page.locator(".browser-empty")).toContainText("does not establish clear conditions", { timeout: 30000 });
  await expect(page.locator(".browser-empty h2")).toHaveText("No report matches “zzzz-no-such-report”");
  await expect(page.locator("#browser-count")).toHaveText(/^0 reports match/);
  await expect(page.locator(".feed-item")).toHaveCount(0);
  // A filter chosen straight after keeps the text, and both go to the service together.
  await page.locator("#browser-status").click();
  await page.locator('#browser-status-options [data-value="all"]').click(); await ready(page);
  expect(new URL(page.url()).searchParams.get("q")).toBe("zzzz-no-such-report");
  await expect(page.locator("#browser-status")).toHaveClass(/is-applied/);
  const both = requests.at(-1)!;
  expect(both.searchParams.get("q")).toBe("zzzz-no-such-report");
  expect(both.searchParams.getAll("status").join(",")).toContain("RESOLVED");
  // The buttons keep their size and place whatever is chosen, and Reset sits on the count line.
  expect(await row()).toBe(rowBefore);
  expect((await new AxeBuilder({ page }).include(".browser-filters").analyze()).violations).toEqual([]);
  await page.locator(".browser-count .filter-reset").click(); await ready(page);
  expect(new URL(page.url()).search).not.toMatch(/q=|status=/);
  await expect(page.locator("#browser-search")).toHaveValue("");
  await expect(page.locator(".feed-item").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#browser-count")).toContainText("newest received first");
  await page.setViewportSize({ width: 412, height: 915 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("clearing the box returns the plain list without a reload", async ({ page }) => {
  await page.goto("/events/?selection=none&q=zzzz-no-such-report"); await ready(page);
  await expect(page.locator("#browser-count")).toHaveText(/^0 reports match/, { timeout: 30000 });
  const content = await page.locator("#browser-list").elementHandle();
  await page.locator("#browser-search").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#browser-search")).toHaveValue("");
  await expect(page.locator("#browser-count")).toContainText("newest received first", { timeout: 30000 });
  await expect(page.locator(".feed-item").first()).toBeVisible();
  expect(await content!.evaluate(el => el === document.getElementById("browser-list"))).toBe(true);
  await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false);
});

test("a search the service cannot answer is an error on the page, never an empty list", async ({ page }) => {
  // The index being rebuilt: 503 for requests with q, the plain list unaffected.
  await page.route(url => url.pathname === "/api/v1/events" && url.searchParams.has("q"), route => route.fulfill({
    status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*", "retry-after": "5" },
    body: JSON.stringify({ code: 14, codeName: "UNAVAILABLE", message: "the search index is still being built", details: [] }),
  }));
  await page.goto("/events/?selection=none"); await ready(page);
  await expect(page.locator(".feed-item").first()).toBeVisible({ timeout: 30000 });
  await page.locator("#browser-search").fill("flooded");
  await expect(page.locator("#content .callout")).toContainText("index is being rebuilt", { timeout: 30000 });
  await expect(page.locator("#browser-count")).toHaveText("Reports unavailable");
  await expect(page.locator(".browser-empty")).toHaveCount(0);
  await expect(page.locator("#content")).not.toContainText(/No report matches|0 reports/);
  // Clearing the search brings the reports back.
  await page.locator("#browser-search").fill("");
  await expect(page.locator(".feed-item").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#content .callout")).toHaveCount(0);
});

test("a match in a report's own text shows where, with the words marked", async ({ page }) => {
  // One canned answer, so the excerpt does not depend on today's reports.
  let template: any;
  await page.route(url => url.pathname === "/api/v1/events" && url.searchParams.get("q") === "culvert", async route => {
    const event = { ...template, id: "test:excerpt", headline: "Road closed", areaLabel: "SR 4 at Big Trees", summary: "Crews are clearing a blocked culvert." };
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({
      events: [event], nextPageToken: "", totalMatches: 1, counts: [{ layer: event.layer, category: event.category, events: 1 }],
      matches: { "test:excerpt": { field: "text", parts: [{ text: "Crews are clearing a blocked ", hit: false }, { text: "culvert", hit: true }, { text: ".", hit: false }] } },
      search: { query: "culvert", since: "2026-07-07T00:19:16Z", note: "note" },
    }) });
  });
  page.on("response", async response => {
    const url = new URL(response.url());
    if (!template && url.pathname === "/api/v1/events" && !url.searchParams.has("q") && response.ok()) template = (await response.json()).events[0];
  });
  await page.goto("/events/?selection=none"); await ready(page);
  await expect.poll(() => !!template).toBe(true);
  await page.locator("#browser-search").fill("culvert");
  await expect(page.locator("#browser-count")).toHaveText("1 report matches", { timeout: 30000 });
  const excerpt = page.locator(".feed-item .feed-item__match");
  await expect(excerpt).toHaveText("Crews are clearing a blocked culvert.");
  await expect(excerpt.locator("mark")).toHaveText("culvert");
  expect((await new AxeBuilder({ page }).include("#browser-list").analyze()).violations).toEqual([]);
});

test("saved updates are searched by what each one said, with the service's count", async ({ page }) => {
  const asked: URL[] = [];
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname === "/api/v1/history") asked.push(url); });
  // The saved-updates view is a fixed period: the last thirty days.
  const period = new URLSearchParams({ time: "fixed", mode: "history", from: new Date(Date.now() - 30 * 86400000).toISOString(), to: new Date(Date.now() + 3600000).toISOString(), selection: "none" });
  await page.goto("/events/?" + period); await ready(page);
  await expect(page.locator(".feed-item").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#browser-count")).toContainText("newest reported first");
  const word = (await page.locator(".feed-item h2, .feed-item h3").first().innerText()).split(/\s+/).find(w => /^[a-z]{5,}$/i.test(w))!;
  await page.locator("#browser-search").fill(word);
  await expect(page.locator("#browser-count")).toHaveText(/^[\d,]+ saved updates? match/, { timeout: 30000 });
  const last = asked.at(-1)!;
  expect(last.searchParams.get("q")).toBe(word);
  expect(last.searchParams.get("qTyping")).toBe("true");
  // The period still bounds the search.
  expect(last.searchParams.get("from")).toBeTruthy();
  expect(last.searchParams.get("to")).toBeTruthy();
  await expect(page.locator(".feed-item").filter({ hasText: new RegExp(word, "i") }).first()).toBeVisible();
  await page.locator("#browser-search").fill("zzzz-no-such-report");
  await expect(page.locator(".browser-empty h2")).toHaveText("No saved update matches “zzzz-no-such-report”", { timeout: 30000 });
  await expect(page.locator(".browser-empty")).toContainText("in this period");
  await expect(page.locator(".browser-empty")).toContainText("does not establish clear conditions");
});
