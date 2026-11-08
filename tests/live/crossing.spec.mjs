import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const ready = async (p) =>
  expect(p.locator("#evidence")).toHaveAttribute("aria-busy", "false", {
    timeout: 45000,
  });
test("live crossing, evidence, URL, history and accessible narrow reading", async ({
  page,
}) => {
  await page.goto("/?place=ebbetts-pass");
  await ready(page);
  await expect(page.locator(".weather-row")).not.toHaveCount(0);
  await expect(page.locator("#connections")).not.toBeEmpty({ timeout: 25000 });
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  await page.locator(".weather-action a").first().click();
  await expect(page.locator("#detail")).toBeVisible();
  await expect(page.locator("#forecast-chart svg").first()).toBeVisible();
  const deep = page.url();
  await page.locator("#forecast-chart").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/deep.png" });
  const dialogAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(dialogAxe.violations).toEqual([]);
  await page.locator("#close-detail").click();
  await page.goBack();
  await expect(page).toHaveURL(deep);
  await expect(page.locator("#detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#detail")).not.toBeVisible();
  await page.locator("#stops a").first().click();
  await ready(page);
  await expect(page).toHaveURL(/place=murphys/);
  await page.locator("#crossing-position").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Tab");
  await ready(page);
  await expect(page).toHaveURL(/place=arnold/);
  await page.goto("/?place=all&chapter=passage&collection=ROAD_INCIDENT");
  await ready(page);
  await expect(page.locator(".entry")).not.toHaveCount(0);
  await page.locator(".entry h3 a").first().click();
  await expect(page.locator("#detail")).toBeVisible();
  await page.getByRole("button", { name: "Open revision history" }).click();
  await expect(page.locator("#revisions details").first()).toBeVisible({
    timeout: 45000,
  });
  const ioResponse = page.waitForResponse(r => r.url().includes('/history?') && r.url().includes('enhancementIo=true'));
  await page.getByRole('button', {name:'Read revisions with stored AI I/O'}).click();
  expect((await ioResponse).ok()).toBe(true);
  await page
    .getByText("Advanced attribution · stored AI input and output")
    .click();
  await page
    .getByRole("button", { name: "Read stored AI input/output" })
    .click();
  await expect(page.locator("#enhancement-io")).toContainText(
    /No stored|Current record revision/,
    { timeout: 30000 },
  );
  await page.keyboard.press("Escape");
  await ready(page);
  const desktopAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(desktopAxe.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?place=ebbetts-pass");
  await ready(page);
  await expect(page.locator(".weather-row")).not.toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#connections")).not.toBeEmpty({ timeout: 25000 });
  await page.screenshot({ path: "artifacts/narrow.png", fullPage: true });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
});
test("blocked live API remains an explicit failure", async ({ page }) => {
  await page.route("https://data.sierragridteam.org/**", (route) =>
    route.abort("failed"),
  );
  await page.goto("/");
  await ready(page);
  await expect(page.getByText("This reading is unavailable.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry reading" }),
  ).toBeVisible();
});
test("public domain routes retain health, scope, and readable evidence", async ({
  page,
}) => {
  for (const route of [
    "?place=ebbetts-pass&chapter=burn",
    "?place=ebbetts-pass&chapter=passage&collection=map:road_segment",
    "?place=ebbetts-pass&chapter=passage&collection=cameras",
    "?place=ebbetts-pass&chapter=signals&collection=scanners",
    "?place=ebbetts-pass&chapter=sources&collection=sources",
    "?place=ebbetts-pass&chapter=sources&collection=summary",
    "?place=all&chapter=ground&collection=EVACUATION&history=history&from=2026-10-01&to=2026-11-08",
  ]) {
    await page.goto("/" + route);
    await ready(page);
    await expect(page.locator("#evidence")).not.toBeEmpty();
    await expect(page.getByText("This reading is unavailable.")).toHaveCount(0);
  }
  await expect(page.locator("#pagination")).toContainText(
    /result set|Partial reading/,
  );
  const archived = page.locator(".entry h3 a").first();
  if (await archived.count()) {
    await archived.click();
    await expect(page.locator("#detail .warning").first()).toContainText(
      "Archived revision",
    );
    await expect(page).toHaveURL(/kind=revision/);
    await page.reload();
    await expect(page.locator("#detail .warning").first()).toContainText(
      "Archived revision",
      { timeout: 45000 },
    );
  }
});

test("radio continuation and bounded monitor evidence survive URL navigation", async ({
  page,
}) => {
  await page.goto("/?place=all&chapter=signals&collection=MESH");
  await ready(page);
  const initial = await page.locator(".entry").count();
  const more = page.getByRole("button", { name: "Read the next page" });
  if (await more.count()) {
    await more.click();
    await ready(page);
    await expect(page).toHaveURL(/pages=2/);
    expect(await page.locator(".entry").count()).toBeGreaterThan(initial);
  }
  await page.locator(".entry h3 a").first().click();
  await expect(
    page.getByRole("button", { name: "Read monitor archive" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read monitor archive" }).click();
  await expect(page.locator("#telemetry")).toContainText(
    /samples|unavailable/,
    { timeout: 30000 },
  );
  await expect(page.locator("#telemetry")).not.toContainText(
    "This reading is unavailable.",
  );
  await page.keyboard.press("Escape");
  await ready(page);
  if (initial === 30)
    expect(await page.locator(".entry").count()).toBeGreaterThan(initial);
});
