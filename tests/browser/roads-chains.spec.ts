import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fromApi } from "./api-origin";

/**
 * Chain control on the Roads page. The routes are the API's own (their lines
 * are needed to place anything), with every section set open so the test
 * reads the same in any weather; the chain-control layer is the API's answer
 * with its requirements replaced by the ones under test, and each road lists
 * the same requirements.
 */
const sign = (id: string, place: string, direction: string, coordinates: [number, number], level: string) =>
  ({ id, place, direction, level, since: "2026-11-18T08:54:36-08:00", coordinates, source: "cwwp2.dot.ca.gov", county: "Calaveras", postmile: "0.00" });
/** Real checkpoints on Hwy 4 between Arnold and Bear Valley, low to high. */
const GATES: [string, [number, number]][] = [["MILL CREEK", [-120.24879, 38.32371]], ["COTTAGE SPRINGS", [-120.21184, 38.35049]], ["POISON SPRINGS", [-120.18315, 38.38902]], ["BIG MEADOWS", [-120.10318, 38.41775]], ["TAMARACK", [-120.07671, 38.43934]]];
const title = (place: string) => place.toLowerCase().replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());
/** The ends of the lowest monitored section of Hwy 4, 13 km of the route: the shortest section there is. */
const LOW: typeof GATES = [["ANGELS CAMP", [-120.54006, 38.0675]], ["MURPHYS", [-120.45612, 38.1391]]];
function requirement(level: string, first: number, last: number, all = GATES) {
  const gates = all.slice(first, last + 1), from = title(gates[0][0]), to = title(gates.at(-1)![0]);
  return {
    type: "Feature", geometry: { type: "Point", coordinates: gates[0][1] },
    properties: {
      id: `cc:hwy4:${level.toLowerCase()}`, layer: "CHAIN_CONTROL", kind: "Chain control", category: level.toLowerCase(), severity: "MODERATE", severityRank: 2,
      headline: `Hwy 4 chains required, ${from} to ${to} (${level})`, description: "Chains or traction devices are required.", effective: "2026-11-18T08:53:41-08:00", areaLabel: `${from} to ${to}`,
      source: { id: "caltrans", name: "Caltrans", attribution: "cwwp2.dot.ca.gov" },
      chainControl: { level, highway: "Highway 4", from: { place: from, coordinates: gates[0][1] }, to: { place: to, coordinates: gates.at(-1)![1] }, signs: gates.map(([place, at], i) => sign(`cc:test-${level}-${i}`, place, "Eastbound", at, level)) },
    },
  };
}

/** Answer a routed request with the API's own answer, changed; a request the page has already dropped is let go. */
const answer = (change: (body: any) => any) => async (route: Route) => {
  try {
    const response = await fromApi(route);
    await route.fulfill({ response, json: change(await response.json()) });
  } catch {
    await route.abort().catch(() => {});
  }
};

/** `chains` is the chain-control layer ("fail": the request fails); `listed` is what the roads themselves list (default: the same; "unknown": nothing), on `road`. */
async function roads(page: Page, chains: "fail" | ReturnType<typeof requirement>[], listed: "unknown" | ReturnType<typeof requirement>[] = chains === "fail" ? "unknown" : chains, road = "road:hwy4-arnold-bearvalley") {
  await page.route((url) => url.pathname.endsWith("/map/road_segment.geojson"), answer((body) => {
    for (const f of body.features) {
      f.properties.status = "OPEN";
      if (!f.properties.road) continue;
      Object.assign(f.properties.road, { delayMinutes: 0, congestion: "CLEAR" });
      // What the API lists on each road: the requirements under test on one road (Arnold to Bear Valley unless said), none elsewhere; or nothing at all.
      if (listed === "unknown") delete f.properties.road.chains;
      else f.properties.road.chains = f.properties.id !== road ? [] : listed.map((x) => {
        const k = x.properties.chainControl;
        return { level: k.level, eventId: x.properties.id, headline: x.properties.headline, from: k.from.place, to: k.to.place, since: x.properties.effective, inferred: false };
      });
    }
    return body;
  }));
  await page.route((url) => url.pathname.endsWith("/map/chain_control.geojson"), chains === "fail" ? (route) => route.abort()
    : answer((body) => ({ ...body, metadata: { ...body.metadata, sourceStatus: "OK" }, features: [...body.features.filter((f: any) => !f.properties.chainControl?.level), ...chains] })));
  await page.goto("/roads/");
  await expect(page.locator("#content")).toHaveAttribute("aria-busy", "false", { timeout: 30000 });
  await expect(page.locator(".roads-answer")).not.toHaveText("Checking the roads…", { timeout: 30000 });
}
const hwy4 = (page: Page) => page.locator(".roads-route").filter({ has: page.locator(".ds-corridor__name", { hasText: /^Hwy 4$/ }) });
const box = async (locator: Locator) => (await locator.boundingBox())!;

test("an open road under chain control stays open and is marked: strip, section, summary, map and key", async ({ page }) => {
  await roads(page, [requirement("R2", 0, 4)]);
  const route = hwy4(page);
  // The status is the source's: open, in the open colour, with chains said beside it.
  const summary = route.locator(".ds-corridor__summary");
  await expect(summary.locator(".roads-chain-note .roads-key--band")).toBeVisible(); // the band's colour beside the words
  await expect(summary).toContainText(/^Open · \d+ min end to end · chains R2 from Mill Creek to Tamarack/);
  await expect(summary).toHaveClass(/ds-corridor__summary--ok/);
  const labels = await route.locator(".ds-corridor__label").allInnerTexts();
  expect(labels.filter((text) => /chains/.test(text))).toEqual([expect.stringMatching(/^Open · chains R2 · \d+ min$/)]);
  expect(labels.filter((text) => /^Open · \d+ min$/.test(text)).length).toBeGreaterThan(0); // sections it does not touch stay as they were
  await expect(route.locator(".ds-corridor ol.sr-only")).toContainText("Arnold to Bear Valley: Open · chains R2");
  await expect(route.locator(".ds-corridor ol.sr-only")).toContainText("Open, chains required (R2) from Mill Creek to Tamarack");
  // One band, on the strip's own scale: it starts at the stretch's marker and lies inside the Arnold to Bear Valley section.
  const band = route.locator(".roads-chain-band");
  await expect(band).toHaveCount(1);
  await expect(band.locator(".roads-chain-band__label")).toContainText("Chains R2");
  const bar = await box(band.locator(".roads-chain-band__bar")), marker = await box(route.locator(".ds-corridor__marker--chain")), track = await box(route.locator(".ds-corridor__track"));
  expect(Math.abs(bar.x - (marker.x + marker.width / 2))).toBeLessThan(4);
  const joints = await route.locator(".ds-corridor__joint").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => r.x + r.width / 2));
  expect(bar.x).toBeGreaterThan(joints[2]); // past Arnold
  expect(bar.x + bar.width).toBeLessThan(joints[3]); // short of Bear Valley
  expect(bar.x).toBeGreaterThan(track.x);
  // A route with no requirement has no band.
  await expect(page.locator(".roads-route").filter({ hasText: "Hwy 49" }).locator(".roads-chain-band")).toHaveCount(0);
  // The map: the stretch is a line cut from the route, and the route under it keeps its open colour.
  await expect(page.locator(".roads-legend")).toContainText("Chains required");
  const features = await page.locator("#roads-map sierra-geo-map").evaluate((el: any) => el.data.features.map((f: any) => ({ ...f.properties, type: f.geometry.type, points: f.geometry.coordinates.length })));
  const stretch = features.filter((f: any) => f.kind === "chain-stretch");
  expect(stretch).toHaveLength(1);
  expect(stretch[0]).toMatchObject({ type: "LineString", tone: "glacier", label: "Chains required (R2) on Hwy 4 from Mill Creek to Tamarack" });
  expect(stretch[0].points).toBeGreaterThan(10);
  expect(features.filter((f: any) => f.kind === "segment").every((f: any) => f.tone === "pine")).toBe(true);
  // Phone: the strip runs down the page and has no axis to draw a band on, so the summary (keyed with the band's colour) and the section's label carry it.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(route.locator(".roads-chain-lane")).toBeHidden();
  await expect(summary.locator(".roads-chain-note")).toHaveText("chains R2 from Mill Creek to Tamarack");
  await expect(summary.locator(".roads-chain-note .roads-key--band")).toBeVisible();
  await expect(route.locator(".ds-corridor__label", { hasText: "chains R2" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(await route.locator(".ds-corridor__label").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent))).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("two stretches on one route are two bands whose labels do not collide", async ({ page }) => {
  // Short neighbours, on a strip narrow enough that each band is shorter than its label: R1 from Mill Creek to Cottage Springs, R3 on to Poison Springs.
  await page.setViewportSize({ width: 1024, height: 900 });
  await roads(page, [requirement("R3", 1, 2), requirement("R1", 0, 1)]);
  const route = hwy4(page);
  await expect(route.locator(".ds-corridor__summary")).toContainText("chains R1 from Mill Creek to Cottage Springs and R3 from Cottage Springs to Poison Springs");
  await expect(route.locator(".ds-corridor__label", { hasText: "chains" })).toHaveText(/^Open · chains R1, R3 · \d+ min$/);
  const bands = route.locator(".roads-chain-band");
  await expect(bands).toHaveCount(2);
  await expect(bands.locator(".roads-chain-band__label")).toContainText(["Chains R1", "Chains R3"]);
  const [r1, r3] = [await box(bands.nth(0).locator(".roads-chain-band__bar")), await box(bands.nth(1).locator(".roads-chain-band__bar"))];
  expect(r1.x + r1.width).toBeLessThan(r3.x); // a gap between them
  // Each band is as long as its stretch, not as long as its label: it runs from its own marker to the next stretch's.
  const markers = await route.locator(".ds-corridor__marker--chain").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => r.x + r.width / 2));
  expect(Math.abs(r1.x - markers[0])).toBeLessThan(4);
  expect(Math.abs(r1.x + r1.width - markers[1])).toBeLessThan(4);
  expect(Math.abs(r3.x - markers[1])).toBeLessThan(4);
  const [a, b] = [await box(bands.nth(0).locator(".roads-chain-band__label")), await box(bands.nth(1).locator(".roads-chain-band__label"))];
  const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap).toBe(false);
});

test("when the chain-control layer cannot be read, no band is drawn and nothing says there are no chains", async ({ page }) => {
  await roads(page, "fail");
  await expect(page.locator(".callout")).toContainText("chain controls and closure points");
  await expect(page.locator(".roads-kpis .stat").nth(1)).toContainText("chain control status is unavailable");
  await expect(page.locator(".roads-chain-band")).toHaveCount(0);
  await expect(hwy4(page).locator(".ds-corridor__summary")).toContainText("chain control unavailable");
  await expect(hwy4(page).locator(".ds-corridor__label", { hasText: "chains" })).toHaveCount(0);
  const features = await page.locator("#roads-map sierra-geo-map").evaluate((el: any) => el.data.features.map((f: any) => f.properties.kind));
  expect(features).not.toContain("chain-stretch");
  expect((await page.locator("#roads-page").innerText()).toLowerCase()).not.toMatch(/no chain|chains? none|none on monitored/);
});

test("the layer cannot be read but the road lists its requirement: title, figure, section and route say it, and no band is drawn", async ({ page }) => {
  await roads(page, "fail", [requirement("R2", 0, 4)]);
  const route = hwy4(page);
  // The page's answer is the requirement, in the API's own words for the stretch; it does not say everything is open.
  await expect(page.locator(".roads-answer")).toHaveText("Hwy 4 chains required, Mill Creek to Tamarack (R2)");
  const figure = page.locator(".roads-kpis .stat").nth(1);
  await expect(figure).toContainText("R2");
  await expect(figure).toContainText("Hwy 4 from Mill Creek to Tamarack (R2)");
  await expect(figure).not.toContainText("unavailable");
  await expect(route.locator(".ds-corridor__label", { hasText: "chains" })).toHaveText(/^Open · chains R2 · \d+ min$/);
  await expect(route.locator(".ds-corridor__summary")).toContainText("chains R2 from Mill Creek to Tamarack");
  await expect(route.locator(".ds-corridor__summary")).not.toContainText("unavailable");
  // Without checkpoints there is no extent: nothing is drawn on the strip or the map.
  await expect(page.locator(".roads-chain-band")).toHaveCount(0);
  await expect(route.locator(".roads-key--band")).toHaveCount(0);
  const features = await page.locator("#roads-map sierra-geo-map").evaluate((el: any) => el.data.features.map((f: any) => f.properties.kind));
  expect(features).not.toContain("chain-stretch");
  // The failure is still said, and a road that lists none says nothing and is not called unknown.
  await expect(page.locator(".callout")).toContainText("chain controls and closure points");
  await expect(page.locator(".roads-route").filter({ hasText: "Hwy 49" }).locator(".ds-corridor__summary")).not.toContainText(/chain/i);
});

test("a section too short for its text gets a shorter one that keeps the chain level, never a cut one", async ({ page }) => {
  // R3 on Angels Camp to Murphys, the shortest section: 13 km of the strip.
  const short = (p: Page) => hwy4(p).locator(".ds-corridor__label").first();
  const cut = (p: Page) => hwy4(p).locator(".ds-corridor__label", { hasText: /chains/i }).evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent));
  await roads(page, [requirement("R3", 0, 1, LOW)], [requirement("R3", 0, 1, LOW)], "road:hwy4-angels-murphys");
  // Wide: all of it.
  await expect(short(page)).toHaveText(/^Open · chains R3 · \d+ min$/);
  expect(await cut(page)).toEqual([]);
  // A 900 px window: the section is about 90 px of the strip.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(short(page)).toHaveText("Chains R3");
  expect(await cut(page)).toEqual([]);
  // A small phone, where the strip runs down the page: the minutes go, the level stays.
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(short(page)).toHaveText(/^(Open · chains R3|Chains R3)$/);
  expect(await cut(page)).toEqual([]);
  // And back: the full text returns when there is room.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(short(page)).toHaveText(/^Open · chains R3 · \d+ min$/);
  // The untouched sections keep their one text.
  await expect(hwy4(page).locator(".ds-corridor__label").nth(1)).toHaveText(/^Open · \d+ min$/);
});
