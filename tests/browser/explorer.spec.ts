import { test, expect } from '@playwright/test';
test('investigate, compare and restore URL state', async ({ page }) => {
    await page.goto('/?mode=demo');
    await expect(page.locator('#nodes .node')).toHaveCount(6);
    await page.locator('#nodes .node').first().click();
    await expect(page.locator('#node-title')).not.toContainText('Loading');
    await expect(page.locator('#archive-notes')).toContainText('samples returned');
    await page.selectOption('#metric', 'packetsReceived');
    await page.selectOption('#compare', { index: 2 });
    await expect(page.locator('#archive-notes .archive-note')).toHaveCount(2);
    await page.locator('#revisions summary').click();
    await expect(page.locator('#history-status')).toContainText('exhausted');
    const url = page.url();
    await page.reload();
    await expect(page.locator('#archive-notes .archive-note')).toHaveCount(2);
    await expect(page.locator('#metric')).toHaveValue('packetsReceived');
    expect(page.url()).toBe(url);
    await page.locator('#close-detail').click();
    await expect(page.locator('#detail')).toBeHidden();
    await page.goBack();
    await expect(page.locator('#detail')).toBeVisible();
});
test('filters retain external neighbor identity and no matches are honest', async ({ page }) => { await page.goto('/?mode=demo'); await expect(page.locator('#nodes .node')).toHaveCount(6); await page.selectOption('#place', { index: 1 }); await expect(page.locator('#network')).toContainText('OUTSIDE FILTER'); await page.fill('#search', 'impossible name'); await expect(page.locator('#nodes')).toContainText('No matching node'); await page.reload(); await expect(page.locator('#search')).toHaveValue('impossible name'); });
for (const scenario of ['empty', 'stale', 'partial', 'unavailable'])
    test(`honest ${scenario} scenario`, async ({ page }) => { await page.goto(`/?mode=demo&scenario=${scenario}`); if (scenario === 'empty')
        await expect(page.locator('#nodes')).toContainText('No matching'); if (scenario === 'unavailable') {
        await expect(page.locator('#nodes')).toContainText('unavailable');
        await expect(page.locator('#link-status')).toContainText('unavailable');
        await page.locator('#refresh').click();
        await expect(page.locator('#nodes')).toContainText('unavailable');
    } if (scenario === 'stale')
        await expect(page.locator('#health')).toContainText('STALE'); if (scenario === 'partial') {
        await expect(page.locator('#nodes .node')).toHaveCount(6);
        await page.locator('#nodes .node').first().click();
        await expect(page.locator('#archive-notes')).toContainText('PARTIAL / TRUNCATED');
        await page.selectOption('#compare', { label: 'Valley Relay' });
        await expect(page.locator('#archive-status')).toContainText('unavailable for Valley Relay'); await page.screenshot({path:'artifacts/partial.png',fullPage:true});
    } });
test('narrow, keyboard and screenshots', async ({ page }) => { await page.goto('/?mode=demo'); await expect(page.locator('#nodes .node')).toHaveCount(6); await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true }); await page.locator('#nodes .node').nth(1).focus(); await page.keyboard.press('Enter'); await expect(page.locator('#archive-notes')).toContainText('samples returned'); await page.screenshot({ path: 'artifacts/analysis.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 844 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'artifacts/narrow.png', fullPage: true }); await page.goto('/?mode=demo&scenario=unavailable'); await expect(page.locator('#nodes')).toContainText('unavailable'); await page.screenshot({ path: 'artifacts/unavailable.png', fullPage: true }); });
test('zero, unknown, gap and reboot evidence stay distinct', async ({ page }) => {
    await page.goto('/?mode=demo');
    await page.locator('#nodes .node').filter({ hasText: 'Ridge Relay' }).click();
    await expect(page.locator('#identity')).toContainText('0 %');
    await page.locator('#nodes .node').filter({ hasText: 'Meadow Relay' }).click();
    await expect(page.locator('#archive-notes')).toContainText('collection gap');
    await page.locator('#nodes .node').filter({ hasText: 'Ridge Relay' }).click();
    await expect(page.locator('#archive-notes')).toContainText('Reboot boundaries');
    await page.selectOption('#metric', 'packetsReceived');
    await page.locator('#telemetry-chart summary').click();
    await expect(page.locator('#telemetry-chart table')).toContainText('Not reported');
    await page.locator('#nodes .node').filter({ hasText: 'Pine Companion' }).click();
    await expect(page.locator('#identity')).toContainText('Unknown');
    await expect(page.locator('#archive-notes')).toContainText('No sampled evidence');
});
test('page has no serious automated accessibility violations', async ({ page }) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    await page.goto('/?mode=demo');
    await page.locator('#nodes .node').first().click();
    await expect(page.locator('#archive-notes')).toContainText('samples returned');
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
});
