import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fromApi, useApiOrigin } from "./api-origin";

const ready = async (page: Page) => expect(page.locator("#content")).toHaveAttribute("aria-busy", "false", { timeout: 45000 });
/** Requests for the events list, as the page sent them. */
function listRequests(page: Page) {
  const seen: URL[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/events" && !request.headers()["sec-purpose"]?.includes("prefetch")) seen.push(url);
  });
  return seen;
}
const total = async (page: Page) => Number((await page.locator("#finder-status").innerText()).match(/^([\d,]+) reports? match/)?.[1].replace(/,/g, ""));
/** A word from the newest report's headline: something a search is sure to find. */
async function headlineWord(page: Page) {
  await page.goto("/events/?selection=none&status=all"); await ready(page);
  await expect(page.locator(".feed-item").first()).toBeVisible({ timeout: 30000 });
  const word = (await page.locator(".feed-item h2, .feed-item h3").first().innerText()).split(/\s+/).find(w => /^[a-z]{5,}$/i.test(w))!;
  expect(word, "a headline word to search for").toBeTruthy();
  return word;
}

test.beforeEach(async ({ page }) => { await useApiOrigin(page); });

test("Events filters by type, status and importance and has no text box; text belongs to Search", async ({ page }) => {
  const requests = listRequests(page);
  await page.goto("/events/"); await ready(page);
  await expect(page.locator(".feed-item").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#content input[type=search]")).toHaveCount(0);
  expect(requests.some(url => url.searchParams.has("q"))).toBe(false);
  // No labels above the controls: each filter names itself.
  await expect(page.locator("#browser-type")).toHaveAccessibleName("Type: Any type");
  await expect(page.locator("#browser-status")).toHaveAccessibleName("Status: Current");
  await expect(page.locator(".filter-bar .is-applied")).toHaveCount(0);
  await expect(page.locator(".filter-reset")).toHaveCount(0);
  const row = async () => JSON.stringify(await Promise.all(["#browser-type", "#browser-status", "#browser-severity"].map(async id => { const b = (await page.locator(id).boundingBox())!; return [Math.round(b.x), Math.round(b.width)]; })));
  const rowBefore = await row();
  await page.locator("#browser-status").click();
  await page.locator('#browser-status-options [data-value="all"]').click(); await ready(page);
  await expect(page.locator("#browser-status")).toHaveClass(/is-applied/);
  expect(requests.at(-1)!.searchParams.getAll("status").join(",")).toContain("RESOLVED");
  // The buttons keep their size and place whatever is chosen, and Reset sits on the count line.
  expect(await row()).toBe(rowBefore);
  expect((await new AxeBuilder({ page }).include(".browser-filters").analyze()).violations).toEqual([]);
  await page.locator(".browser-count .filter-reset").click(); await ready(page);
  expect(new URL(page.url()).search).not.toMatch(/status=/);
  await expect(page.locator("#browser-count")).toContainText("newest received first");
  await page.setViewportSize({ width: 412, height: 915 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

  // A link from when Events had a search box opens the same text on the Search page.
  await page.goto("/events/?q=zzzz-no-such-report&status=all"); await ready(page);
  await expect(page).toHaveURL(/\/search\/\?q=zzzz-no-such-report$/);
  await expect(page.locator("#finder-search")).toHaveValue("zzzz-no-such-report");
});

test("the revisions view has no text box either", async ({ page }) => {
  const period = new URLSearchParams({ time: "fixed", mode: "history", from: new Date(Date.now() - 30 * 86400000).toISOString(), to: new Date(Date.now() + 3600000).toISOString(), selection: "none" });
  await page.goto("/events/?" + period); await ready(page);
  await expect(page.locator(".feed-item").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#browser-count")).toContainText("newest reported first");
  await expect(page.locator("#content input[type=search]")).toHaveCount(0);
});

test("Search lists every matching report, newest first, with the service's count", async ({ page }) => {
  const word = await headlineWord(page);
  const requests = listRequests(page);
  // The best few say there are more (whatever today's count is) and link to all of them.
  await page.route(url => url.pathname === "/api/v1/search", async route => {
    const response = await fromApi(route), body = await response.json();
    for (const t of body.totals) if (t.kind === "EVENT") t.matches += 100;
    await route.fulfill({ response, json: body });
  });
  await page.goto("/search/?q=" + encodeURIComponent(word)); await ready(page);
  const reports = page.locator(".finder-group", { has: page.locator("h2", { hasText: "Reports" }) });
  await expect(reports.locator(".finder-group__more a")).toHaveText(/^All [\d,]+ reports, newest first/, { timeout: 30000 });
  await reports.locator(".finder-group__more a").click(); await ready(page);
  await expect(page).toHaveURL(/\/search\/\?q=[^&]+&kind=EVENT$/);
  await expect(page.locator("#finder-status")).toHaveText(/^[\d,]+ reports? match/, { timeout: 30000 });

  // The service was asked for reports of every status, and not for mesh nodes.
  const asked = requests.filter(url => url.searchParams.get("q")).at(-1)!;
  expect(asked.searchParams.get("q")).toBe(word);
  expect(asked.searchParams.get("qTyping")).toBe("true");
  expect(asked.searchParams.getAll("status").sort().join(",")).toBe("ACTIVE,EXPIRED,RESOLVED,SCHEDULED");
  expect(asked.searchParams.getAll("layer")).not.toContain("MESH");
  expect(asked.searchParams.getAll("layer")).toContain("ROAD_INCIDENT");
  // The count is the service's, over every page: with nothing more to load it is the rows shown.
  const matched = await total(page);
  expect(matched).toBeGreaterThan(0);
  if (!/shown/.test(await page.locator("#finder-status").innerText())) await expect(page.locator("#finder-list .feed-item")).toHaveCount(matched);
  await expect(page.locator("#finder-list .feed-item").filter({ hasText: new RegExp(word, "i") }).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).include("#content").analyze()).violations).toEqual([]);

  // A reload asks the same thing; typing asks again in the same list, once per pause.
  await page.reload(); await ready(page);
  await expect(page.locator("#finder-search")).toHaveValue(word);
  await expect(page.locator("#finder-status")).toHaveText(/^[\d,]+ reports? match/, { timeout: 30000 });
  expect(await total(page)).toBe(matched);
  const before = requests.length;
  await page.locator("#finder-search").fill("zzzz-no-such-report");
  await expect(page.locator(".browser-empty h2")).toHaveText("No report matches “zzzz-no-such-report”", { timeout: 30000 });
  await expect(page.locator(".browser-empty")).toContainText("current or past");
  await expect(page.locator(".browser-empty")).toContainText("does not establish clear conditions");
  await expect(page.locator("#finder-status")).toHaveText(/^0 reports match/);
  expect(requests.length - before).toBeLessThanOrEqual(2);
  await expect.poll(() => new URL(page.url()).searchParams.get("kind")).toBe("EVENT");

  // Back to the best of every kind; a report opens in Events.
  await page.locator("#finder-search").fill(word);
  await expect(page.locator("#finder-list .feed-item").first()).toBeVisible({ timeout: 30000 });
  const title = await page.locator("#finder-list .feed-item a").first().innerText();
  await page.locator(".finder-scope a").click(); await ready(page);
  await expect(page).toHaveURL(/\/search\/\?q=[^&]+$/);
  await expect(page.locator(".finder-group").first()).toBeVisible({ timeout: 30000 });
  await page.goBack(); await ready(page);
  await page.locator("#finder-list .feed-item a").first().click(); await ready(page);
  await expect(page).toHaveURL(/\/events\/\?.*record=/);
  await expect(page.locator("#browser-detail h2")).toHaveText(title, { timeout: 30000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/search/?q=${encodeURIComponent(word)}&kind=EVENT`); await ready(page);
  await expect(page.locator("#finder-status")).toHaveText(/^[\d,]+ reports? match/, { timeout: 30000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("Search in revision history finds reports by any stored version, and opens the revision that matched", async ({ page }) => {
  const word = await headlineWord(page);
  const asked: URL[] = [];
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname === "/api/v1/history") asked.push(url); });
  await page.goto("/search/?q=" + encodeURIComponent(word)); await ready(page);
  await expect(page.locator(".finder-history a")).toHaveText(/^Search in revision history/, { timeout: 30000 });
  await page.locator(".finder-history a").click(); await ready(page);
  await expect(page).toHaveURL(/\/search\/\?q=[^&]+&kind=REVISIONS$/);
  await expect(page.locator("#finder-status")).toHaveText(/^[\d,]+ reports? ha(s|ve) a matching revision/, { timeout: 30000 });
  // One question: every stored revision, one row per report.
  const last = asked.at(-1)!;
  expect(last.searchParams.get("q")).toBe(word);
  expect(last.searchParams.get("qTyping")).toBe("true");
  expect(last.searchParams.get("collapse")).toBe("event");
  expect(last.searchParams.get("place")).toBe("ebbetts-pass");
  const row = page.locator("#finder-list .feed-item").first();
  await expect(row).toContainText(/Revision \d+ matches|\d+ revisions match, from revision \d+ to revision \d+/);
  expect((await new AxeBuilder({ page }).include("#content").analyze()).violations).toEqual([]);
  // The row opens the report at its first matching revision.
  const href = new URL((await row.locator("a").first().getAttribute("href"))!, page.url());
  expect(href.pathname).toBe("/events/");
  expect(href.searchParams.get("record")).toBeTruthy();
  expect(href.searchParams.get("revision")).toMatch(/^\d+$/);
  const title = await row.locator("a").first().innerText();
  await row.locator("a").first().click(); await ready(page);
  await expect(page.locator("#browser-detail h2")).toHaveText(title, { timeout: 30000 });

  // Nothing in any revision: said as that, and never as clear conditions.
  await page.goto("/search/?q=zzzz-no-such-report&kind=REVISIONS"); await ready(page);
  await expect(page.locator(".browser-empty h2")).toHaveText("No revision matches “zzzz-no-such-report”", { timeout: 30000 });
  await expect(page.locator(".browser-empty")).toContainText("does not establish clear conditions");
  await expect(page.locator("#finder-status")).toHaveText(/^0 reports have a matching revision/);
  // A search with no current match still offers the revision history.
  await page.goto("/search/?q=zzzz-no-such-report"); await ready(page);
  await expect(page.locator(".browser-empty h2")).toHaveText("Nothing matches “zzzz-no-such-report”", { timeout: 30000 });
  await expect(page.locator(".finder-history a")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/search/?q=${encodeURIComponent(word)}&kind=REVISIONS`); await ready(page);
  await expect(page.locator("#finder-status")).toHaveText(/matching revision/, { timeout: 30000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("a list the service cannot answer is an error on the page, never an empty list", async ({ page }) => {
  // The index being rebuilt: 503 for requests with q.
  await page.route(url => url.pathname === "/api/v1/events" && url.searchParams.has("q"), route => route.fulfill({
    status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*", "retry-after": "5" },
    body: JSON.stringify({ code: 14, codeName: "UNAVAILABLE", message: "the search index is still being built", details: [] }),
  }));
  await page.goto("/search/?q=flooded&kind=EVENT"); await ready(page);
  await expect(page.locator("#content .callout")).toContainText("index is being rebuilt", { timeout: 30000 });
  await expect(page.locator("#finder-status")).toHaveText("Search unavailable");
  await expect(page.locator(".browser-empty")).toHaveCount(0);
  await expect(page.locator("#content")).not.toContainText(/No report matches|0 reports/);
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
    if (!template && url.pathname === "/api/v1/events" && !url.searchParams.has("q") && response.ok()) template = (await response.json()).events.find((e: any) => e.layer !== "MESH");
  });
  await page.goto("/events/?selection=none&status=all"); await ready(page);
  await expect.poll(() => !!template).toBe(true);
  await page.goto("/search/?q=culvert&kind=EVENT"); await ready(page);
  await expect(page.locator("#finder-status")).toHaveText("1 report matches", { timeout: 30000 });
  const excerpt = page.locator("#finder-list .feed-item .feed-item__match");
  await expect(excerpt).toHaveText("Crews are clearing a blocked culvert.");
  await expect(excerpt.locator("mark")).toHaveText("culvert");
  expect((await new AxeBuilder({ page }).include("#finder-list").analyze()).violations).toEqual([]);
});

test("the Search page finds things of every kind and leads to their pages", async ({ page }) => {
  const asked: URL[] = [];
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname === "/api/v1/search") asked.push(url); });
  await page.goto("/"); await ready(page);
  await page.locator('.grid-sidebar [data-view="search"]').click(); await ready(page);
  await expect(page).toHaveURL(/\/search\/$/);
  await expect(page.locator("h1")).toHaveText("Search");
  // Nothing asked, nothing claimed: a hint, no results and no "0 matches".
  await expect(page.locator(".finder-help")).toBeVisible();
  await expect(page.locator("#finder-status")).toHaveText("");
  expect(asked).toEqual([]);

  await page.locator("h1").click();
  await page.keyboard.press("/");
  await expect(page.locator("#finder-search")).toBeFocused();
  await page.keyboard.type("hwy 4");
  await expect(page.locator("#finder-status")).toHaveText(/^[\d,]+ match(es)?: /, { timeout: 30000 });
  // One question for the phrase, scoped to the corridor and to the kinds Grid has pages for.
  expect(asked.length).toBeLessThanOrEqual(3);
  const last = asked.at(-1)!;
  expect(last.searchParams.get("q")).toBe("hwy 4");
  expect(last.searchParams.get("qTyping")).toBe("true");
  expect(last.searchParams.get("place")).toBe("ebbetts-pass");
  expect(last.searchParams.getAll("kind").join(",")).toBe("EVENT,MESH_NODE,ROAD,CAMERA,SCANNER");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("hwy 4");

  // Highway 4 is a monitored road, whatever is happening on it today.
  const roads = page.locator(".finder-group", { has: page.locator("h2", { hasText: "Roads" }) });
  await expect(roads.locator(".feed-item").first()).toContainText("Hwy 4");
  await expect(roads.locator(".feed-item a").first()).toHaveAttribute("href", "/roads/");
  expect((await new AxeBuilder({ page }).include("#content").analyze()).violations).toEqual([]);

  // A reload asks the same thing; a report hit opens that report in Events.
  await page.reload(); await ready(page);
  await expect(page.locator("#finder-search")).toHaveValue("hwy 4");
  await expect(page.locator("#finder-status")).toHaveText(/^[\d,]+ match(es)?: /, { timeout: 30000 });
  const reports = page.locator(".finder-group", { has: page.locator("h2", { hasText: "Reports" }) });
  if (await reports.count()) {
    const title = await reports.locator(".feed-item a").first().innerText();
    await reports.locator(".feed-item a").first().click(); await ready(page);
    await expect(page).toHaveURL(/\/events\/\?.*record=/);
    await expect(page.locator("#browser-detail h2")).toHaveText(title, { timeout: 30000 });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/search/?q=hwy+4"); await ready(page);
  await expect(page.locator("#finder-status")).toHaveText(/^[\d,]+ match(es)?: /, { timeout: 30000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("the Search page says what nothing found means, and never invents an empty answer", async ({ page }) => {
  await page.goto("/search/?q=zzzz-no-such-thing"); await ready(page);
  await expect(page.locator(".browser-empty h2")).toHaveText("Nothing matches “zzzz-no-such-thing”", { timeout: 30000 });
  await expect(page.locator(".browser-empty")).toContainText("does not establish clear conditions");
  await expect(page.locator("#finder-status")).toHaveText("0 matches");
  await expect(page.locator(".finder-group")).toHaveCount(0);

  // A kind the service could not search is named, not shown as none.
  await page.route(url => url.pathname === "/api/v1/search" && url.searchParams.get("q") === "bear valley", route => route.fulfill({
    status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ hits: [], totals: [{ kind: "EVENT", matches: 0 }, { kind: "MESH_NODE", matches: 0 }, { kind: "ROAD", matches: 0 }, { kind: "SCANNER", matches: 0 }], unavailable: ["CAMERA"], search: { query: "bear valley", since: "2026-07-07T00:19:16Z", note: "note" } }),
  }));
  await page.locator("#finder-search").fill("bear valley");
  await expect(page.locator("#content .callout")).toContainText("Road cameras could not be searched just now", { timeout: 30000 });
  await expect(page.locator(".browser-empty")).toHaveCount(0);
  await expect(page.locator("#content")).not.toContainText("Nothing matches");

  // The index being rebuilt: an error, with the box still usable.
  await page.route(url => url.pathname === "/api/v1/search" && url.searchParams.get("q") === "flooded", route => route.fulfill({
    status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*", "retry-after": "5" },
    body: JSON.stringify({ code: 14, codeName: "UNAVAILABLE", message: "the search index is still being built", details: [] }),
  }));
  await page.locator("#finder-search").fill("flooded");
  await expect(page.locator("#content .callout")).toContainText("index is being rebuilt", { timeout: 30000 });
  await expect(page.locator("#finder-status")).toHaveText("Search unavailable");
  await expect(page.locator("#content")).not.toContainText(/Nothing matches|0 matches/);
  // Clearing the box clears the page back to the hint.
  await page.locator("#finder-search").fill("");
  await expect(page.locator(".finder-help")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#content .callout")).toHaveCount(0);
});
