import { test, expect } from '@playwright/test';

test('hostile query text remains inert and survives internal navigation', async ({ page }) => {
  // Fault injection blocks real requests; it supplies no observation responses.
  await page.route('https://data.sierragridteam.org/**', route => route.abort());
  const payload = '\"><img data-query-injection src=x onerror="window.queryInjection=true"><svg onload="window.queryInjection=true">&copy;\' onclick=\'window.queryInjection=true';
  const query = new URLSearchParams({ tense: 'ahead', payload });
  await page.goto('/?' + query);
  await expect(page.locator('.time-rail')).toBeVisible();
  await expect(page.locator('.temporal-lead [role=alert]')).toBeVisible();
  await expect(page.locator('[data-query-injection], [onerror], [onload], [onclick]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).queryInjection)).toBeUndefined();
  const next = page.locator('.time-rail a').filter({ hasText: 'Recorded' });
  const href = await next.getAttribute('href');
  expect(new URL(href!, page.url()).searchParams.get('payload')).toBe(payload);
  await next.click();
  await expect(page).toHaveURL(/tense=recorded/);
  expect(new URL(page.url()).searchParams.get('payload')).toBe(payload);
  await expect(page.locator('[data-query-injection], [onerror], [onload], [onclick]')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'What comes next?' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('payload')).toBe(payload);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).queryInjection)).toBeUndefined();
});

test('hostile query text in display and invalid date paths cannot create markup', async ({ page }) => {
  await page.route('https://data.sierragridteam.org/**', route => route.abort());
  const payload = '\"><img data-query-injection src=x onerror="window.queryInjection=true">';
  await page.goto('/?' + new URLSearchParams({ topic: 'WILDFIRE', tense: payload }));
  await expect(page.locator('#page-status [role=alert]')).toBeVisible();
  await expect(page.locator('#content > .kicker')).toContainText(payload);
  await expect(page.locator('[data-query-injection], [onerror]')).toHaveCount(0);
  await page.goto('/?' + new URLSearchParams({ topic: 'WILDFIRE', tense: 'recorded', from: payload, to: payload }));
  await expect(page.locator('#content [role=alert]')).toBeVisible();
  await expect(page.locator('[data-query-injection], [onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).queryInjection)).toBeUndefined();
});
