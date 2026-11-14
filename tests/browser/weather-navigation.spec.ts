import { test, expect } from "@playwright/test";
const ready = async (page: any) =>
  expect(page.locator("#content")).toHaveAttribute("aria-busy", "false", {
    timeout: 30000,
  });
test("overview forecast location and units persist into weather and reload", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await expect(
    page.locator("#overview-chart canvas").first(),
  ).toBeVisible();
  const places = page.locator('#overview-weather-panel input[name="overview-location"]');
  expect(await places.count()).toBeGreaterThan(1);
  const id = await places.nth(1).getAttribute("value");
  await places.nth(1).check();
  await page
    .getByRole("radio", { name: "°C", exact: true })
    .check();
  expect(
    await page
      .locator("#overview-chart")
      .evaluate((el: any) => el.options.unit),
  ).toBe("°C");
  expect(
    await page
      .locator("#overview-chart")
      .evaluate((el: any) => el.options.timeZone),
  ).toBe("America/Los_Angeles");
  await page.locator('.grid-sidebar [data-view="weather"]').click();
  await ready(page);
  expect(new URL(page.url()).searchParams.get("weatherLocation")).toBe(id);
  // The overview's units and town carry over: metres, and the week is that town's.
  await expect(page.getByRole("radio", { name: "°C · m", exact: true })).toBeChecked();
  await expect(page.locator(`input[name="weather-location"][value="${id}"]`)).toBeChecked();
  await expect(page.locator(".weather-climb .ds-profile__elevation").first()).toContainText(/ m$/);
  await page.reload();
  await ready(page);
  await expect(page.locator(`input[name="weather-location"][value="${id}"]`)).toBeChecked();
  await expect(page.getByRole("radio", { name: "°C · m", exact: true })).toBeChecked();
  await expect(page.locator(".weather-week .ds-day").first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("page hierarchy is not a browsing trail and unchanged DST bounds stay exact", async ({
  page,
}) => {
  await page.goto(
    "/wildfires/?time=fixed&mode=history&from=2026-11-01T09%3A30%3A00Z&to=2026-11-01T12%3A00%3A00Z",
  );
  await ready(page);
  await expect(page.locator("#trail")).toBeHidden();
  await page.getByRole("button", { name: "Choose dates" }).click();
  await expect(page.locator('.period-custom [name="from"]')).toHaveValue(
    "2026-11-01T01:30",
  );
  await page.getByRole("button", { name: "Apply dates" }).click();
  await ready(page);
  expect(new URL(page.url()).searchParams.get("from")).toBe(
    "2026-11-01T09:30:00.000Z",
  );
  await page.locator('.grid-sidebar [data-view="mesh"]').click();
  await ready(page);
  // A node opens its report on the Events page (the old node page is gone).
  await page.locator("#mesh-node-rows a").first().click();
  await ready(page);
  expect(new URL(page.url()).searchParams.get("record")).toMatch(/^meshcore:/);
  await page.locator('.grid-sidebar [data-view="weather"]').click();
  await ready(page);
  await expect(page.locator("#trail")).toBeHidden();
});
