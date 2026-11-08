import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('live question trail, evidence, forecast, URL restoration and narrow keyboard', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('#opening')).not.toContainText('Reading this place');
    await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });
    await page.getByRole('heading', { name: 'What is the sky telling us?' }).click();
    await page.getByRole('heading', { name: 'Weather & hourly outlook', exact: false }).click();
    await expect(page.locator('.weather-choice').first()).toBeVisible();
    await page.locator('.weather-choice').first().click();
    await expect(page.locator('#chart svg').first()).toBeVisible();
    const deep = page.url();
    await page.locator('#metric').selectOption('windGustKmh');
    await expect(page.locator('#chart')).toContainText('Wind Gust Kmh');
    await page.screenshot({ path: 'artifacts/deep.png', fullPage: true });
    await page.reload();
    await expect(page.locator('#chart svg').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('.weather-choice').first()).toBeVisible();
    await page.goto(deep);
    await expect(page.locator('#chart svg').first()).toBeVisible();
    const a = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(a.violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#opening')).not.toContainText('Reading this place');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#reading')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'artifacts/narrow.png', fullPage: true });
    const n = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(n.violations).toEqual([]);
    expect(errors).toEqual([]);
});
test('real event to source record, revision evidence and query lifecycle', async ({ page }) => {
    await page.goto('/?place=&view=ROAD_INCIDENT');
    await expect(page.locator('#complete')).toContainText('records read.');
    await page.locator('.entry').first().click();
    await expect(page.getByRole('heading', { name: 'What was reported?' })).toBeVisible();
    await page.getByRole('link', { name: 'What changed in this record?' }).click();
    await expect(page.locator('#complete')).toContainText('revisions read.');
    await page.locator('.entry').first().click();
    await expect(page.locator('.eyebrow').filter({ hasText: 'Historical snapshot' })).toBeVisible();
    await page.goto('/?place=&view=BURN_STATUS');
    await expect(page.locator('#complete')).toContainText('records read.');
    if (await page.locator('.entry').count()) {
        await page.locator('.entry').first().click();
        await expect(page.locator('#content')).toContainText('Both air-district and CAL FIRE');
    }
});
test('blocked live request reports unknown and retry recovers', async ({ page }) => {
    await page.route('https://data.sierragridteam.org/api/v1/conditions*', r => r.abort());
    await page.goto('/?view=weather');
    await expect(page.getByRole('alert')).toContainText('Availability is unknown');
    await page.unroute('https://data.sierragridteam.org/api/v1/conditions*');
    await page.getByRole('button', { name: 'Try this request again' }).click();
    await expect(page.locator('.weather-choice').first()).toBeVisible();
});
test('condition geometry, sources, empty categories, archive and radio measurement routes', async ({ page }) => {
    for (const v of ['road_segment', 'chain_control', 'message_sign', 'fire_weather', 'cameras', 'scanners', 'sources', 'places', 'summary', 'EARTHQUAKE', 'POWER', 'EVACUATION', 'WEATHER_ALERT']) {
        await page.goto('/?view=' + v);
        await expect(page.locator('#content')).not.toContainText('Following the live evidence…');
        await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await page.goto('/?view=road_segment');
    await page.getByRole('button', { name: 'Locate this evidence' }).click();
    await expect(page.locator('sierra-geo-map')).toHaveCount(1);
    await page.goto('/?place=&view=MESH');
    await expect(page.locator('#complete')).toContainText('records read.');
    const before = await page.locator('.entry').count();
    if (await page.locator('#more').isVisible()) {
        await page.locator('#more').click();
        await expect(page.locator('.entry')).not.toHaveCount(before);
        const after = await page.locator('.entry').count();
        await page.locator('.entry').first().click();
        await expect(page.getByRole('link', { name: 'What did the monitor measure?' })).toBeVisible();
        await page.goBack();
        await expect(page.locator('.entry')).toHaveCount(after);
    }
    await page.locator('.entry').first().click();
    await page.getByRole('link', { name: 'What did the monitor measure?' }).click();
    await expect(page.locator('#content')).toContainText('Whole retained archive coverage');
    await expect(page.locator('#time-form')).toBeVisible();
    await page.goto('/?place=&view=ROAD_INCIDENT&archive=1');
    await expect(page.locator('#complete')).toContainText(/revisions read\.|Availability is unknown/);
    if (await page.getByRole('alert').count())
        test.info().annotations.push({ type: 'live-availability', description: 'Bounded global road archive unavailable; honest failure state verified.' });
});
test('stored enhancement I/O is explicitly requested on intent', async ({ page }) => {
    await page.goto('/?place=&view=ROAD_INCIDENT');
    await expect(page.locator('#complete')).toContainText('records read.');
    await page.locator('.entry').first().click();
    await expect(page.getByRole('heading', { name: 'What was reported?' })).toBeVisible();
    await page.getByText('Enhancement attribution', { exact: true }).click();
    const request = page.waitForRequest(r => r.url().includes('enhancementIo=true'));
    await page.getByRole('link', { name: 'Read stored enhancement prompt & response' }).click();
    await request;
    await expect(page.locator('#content')).toContainText('Stored I/O requested explicitly.');
    await expect(page).toHaveURL(/io=1/);
});
test('every live forecast location has a discovery route even without current weather', async ({page}) => {
    const response = page.waitForResponse(r => r.url().includes('/api/v1/conditions') && r.status() === 200);
    await page.goto('/?view=weather');
    const data = await (await response).json();
    await expect(page.locator('.weather-choice').first()).toBeVisible();
    for (const forecast of data.forecast) {
        const directChoice = page.locator(`.weather-choice[href*="location=${encodeURIComponent(forecast.locationId)}"]`);
        await expect(directChoice).toHaveCount(1);
        if (!data.weather.some((reading: {locationId: string}) => reading.locationId === forecast.locationId)) {
            await expect(directChoice).toContainText('No current weather was returned');
        }
    }
});
test('malicious date query values cannot create markup in archive or telemetry controls', async ({page}) => {
    // Obtain a real public node for the telemetry route; no fabricated observation response.
    await page.goto('/?place=&view=MESH');
    await expect(page.locator('#complete')).toContainText('records read.');
    await page.locator('.entry').first().click();
    const telemetryLink = page.getByRole('link', {name: 'What did the monitor measure?'});
    await expect(telemetryLink).toBeVisible();
    const telemetryQuery = new URLSearchParams((await telemetryLink.getAttribute('href'))!);
    const payload = '\" autofocus onfocus=\"window.__gridXss=1\"><img src=x onerror=\"window.__gridXss=1\">';
    for (const view of ['ROAD_INCIDENT', 'telemetry']) {
        for (const field of ['from', 'to']) {
            const query = new URLSearchParams({view, archive: '1', place: '', from: new Date(Date.now() - 3600000).toISOString(), to: new Date().toISOString()});
            if (view === 'telemetry') query.set('node', telemetryQuery.get('node')!);
            query.set(field, payload);
            await page.goto('/?' + query);
            await expect(page.getByRole('alert')).toContainText('Choose valid date bounds');
            await expect(page.locator('#content [autofocus], #content [onfocus], #content [onerror]')).toHaveCount(0);
            expect(await page.evaluate(() => '__gridXss' in window)).toBe(false);
        }
    }
    // Legitimate query values still populate the controls via their value properties.
    const to = new Date();
    const from = new Date(to.getTime() - 3600000);
    await page.goto('/?' + new URLSearchParams({view: 'ROAD_INCIDENT', archive: '1', from: from.toISOString(), to: to.toISOString()}));
    await expect(page.locator('#time-form input[name="from"]')).toHaveValue(from.toISOString().slice(0,16));
    await expect(page.locator('#time-form input[name="to"]')).toHaveValue(to.toISOString().slice(0,16));
});
