import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const tags=['wcag2a','wcag2aa','wcag21a','wcag21aa'];
test('live discovery, forecast, event evidence, history and URL restoration',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.weather-lead')).toBeVisible({timeout:30000});
  await page.screenshot({path:'artifacts/desktop.png',fullPage:true});
  expect((await new AxeBuilder({page}).withTags(tags).analyze()).violations).toEqual([]);
  await page.locator('.weather-lead').click();
  await expect(page.locator('.ds-time-series').first()).toBeVisible({timeout:30000});
  await page.locator('.time-rail a').filter({hasText:'Ahead'}).click();
  await expect(page).toHaveURL(/tense=ahead/);
  await expect(page.locator('.ds-time-series').first()).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/tense=ahead/);
  await expect(page.locator('.ds-time-series').first()).toBeVisible();
  await page.goto('/?tense=ahead&topic=ROAD_INCIDENT');
  await expect(page.locator('#page-status')).toContainText('loaded',{timeout:30000});
  const record=page.locator('.record').first();
  if(await record.count()){
    await record.click();
    await expect(page.getByRole('heading',{name:'The evidence sheet'})).toBeVisible({timeout:30000});
    
    const auditRequest=page.waitForRequest(r=>r.url().includes('enhancementIo=true'));
    await page.getByRole('button',{name:'Read stored AI audit trail'}).click();
    await auditRequest;
    await expect(page.locator('#deep')).toContainText('Stored AI audit trail',{timeout:30000});
    await page.screenshot({path:'artifacts/deep.png',fullPage:true});
    await page.getByRole('button',{name:'Read revision history'}).click();
    await expect(page.locator('#revision-status')).toContainText('loaded',{timeout:30000});
    const restoredURL=page.url();
    await page.reload();
    await expect(page.getByRole('heading',{name:'The evidence sheet'})).toBeVisible({timeout:30000});
    expect(page.url()).toBe(restoredURL);
    expect((await new AxeBuilder({page}).withTags(tags).analyze()).violations).toEqual([]);
  }
});
test('narrow keyboard and truthful unavailable state',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?tense=ahead');
  await expect(page.getByRole('heading',{name:'What comes next?'})).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#reading')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await expect(page.locator('.temporal-lead h2')).toBeVisible({timeout:30000});
  await page.screenshot({path:'artifacts/narrow.png',fullPage:true});
  expect((await new AxeBuilder({page}).withTags(tags).analyze()).violations).toEqual([]);
  await page.route('https://data.sierragridteam.org/api/v1/events**',route=>route.abort());
  await page.goto('/?topic=WILDFIRE');
  await expect(page.getByRole('alert')).toContainText('could not be retrieved',{timeout:30000});
  await expect(page.locator('#page-status')).toContainText('incomplete');
  await page.unroute('https://data.sierragridteam.org/api/v1/events**');
  await page.getByRole('button',{name:'Try this request again'}).click();
  await expect(page.locator('#page-status')).toContainText('loaded',{timeout:30000});
});
test('other public surfaces remain discoverable',async({page})=>{
  for(const topic of ['roads','cameras','scanners','places','sources']){
    await page.goto('/?topic='+topic);
    await expect(page.locator('#content h1')).not.toHaveText('Every clockhas a source.',{timeout:30000});
    await expect(page.locator('.topic-nav').last()).toBeVisible({timeout:30000});
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await page.goto('/?tense=recorded&topic=WILDFIRE');
  await expect(page.locator('#window')).toBeVisible();
  await expect(page.locator('#page-status')).toContainText('loaded',{timeout:30000});
});
test('archived snapshot survives reload; later page failure retains evidence',async({page})=>{
  await page.goto('/?tense=recorded&topic=WILDFIRE');
  await expect(page.locator('#page-status')).toContainText('loaded',{timeout:30000});
  const row=page.locator('.record').first();
  if(await row.count()){
    await row.click();
    await expect(page.getByRole('heading',{name:'The evidence sheet'})).toBeVisible({timeout:30000});
    const heading=await page.locator('#content h1').textContent();
    const revision=new URL(page.url()).searchParams.get('revision');
    await page.reload();
    await expect(page.getByRole('heading',{name:'The evidence sheet'})).toBeVisible({timeout:30000});
    await expect(page.locator('#content h1')).toHaveText(heading!);
    await expect(page.locator('#content')).toContainText('Historical snapshot: revision '+revision);
    const historyAudit=page.waitForRequest(r=>r.url().includes('/history')&&r.url().includes('enhancementIo=true'));
    await page.getByRole('button',{name:'Read stored historical AI audit trail'}).click();
    await historyAudit;
    await expect(page.locator('#deep')).toContainText('historical revision '+revision,{timeout:30000});
  }
  await page.goto('/?topic=MESH');
  await expect(page.locator('#page-status')).toContainText('loaded',{timeout:30000});
  const count=await page.locator('.record').count();
  if(await page.locator('#more').count()){
    await page.route('https://data.sierragridteam.org/api/v1/events**',route=>route.abort());
    await page.locator('#more').click();
    await expect(page.locator('#page-status')).toContainText('earlier records retained');
    await expect(page.locator('.record')).toHaveCount(count);
    await page.unroute('https://data.sierragridteam.org/api/v1/events**');
    await page.getByRole('button',{name:'Try this request again'}).click();
    await expect.poll(()=>page.locator('.record').count(),{timeout:30000}).toBeGreaterThan(count);
  }
  const loadedCount=await page.locator('.record').count();
  await page.locator('.record').first().click();
  await expect(page.getByRole('heading',{name:'The evidence sheet'})).toBeVisible({timeout:30000});
  await page.goBack();
  await expect(page.locator('.record')).toHaveCount(loadedCount,{timeout:30000});
  await page.locator('.record').first().click();
  await page.getByRole('button',{name:'Read measurements · last 24 hours'}).click();
  await expect(page.locator('#deep .ds-time-series')).toBeVisible({timeout:30000});
  await expect(page.locator('#deep')).toContainText('Measurement clock: reading.reportedAt');
  const from=new Date(Date.now()-14*86400000).toISOString().slice(0,16);
  const to=new Date(Date.now()-13*86400000).toISOString().slice(0,16);
  await page.locator('#measurement-window input[name=from]').fill(from);
  await page.locator('#measurement-window input[name=to]').fill(to);
  await page.getByRole('button',{name:'Read measurement interval'}).click();
  await expect(page).toHaveURL(/measurementFrom=/);
  await expect(page.locator('#deep .ds-time-series')).toBeVisible({timeout:30000});
  await page.reload();
  await expect(page.locator('#measurement-window input[name=from]')).toHaveValue(from,{timeout:30000});
});
test('temporal landing discoveries and road condition projections',async({page})=>{
  await page.goto('/?tense=ahead');
  await expect(page.locator('.temporal-lead h2')).toBeVisible({timeout:30000});
  await page.screenshot({path:'artifacts/ahead.png',fullPage:true});
  await page.goto('/?tense=recorded');
  await expect(page.locator('.temporal-lead h2')).toBeVisible({timeout:30000});
  await page.screenshot({path:'artifacts/recorded.png',fullPage:true});
  for(const layer of ['chain_control','message_sign','fire_weather']){
    await page.goto('/?topic=roads&layer='+layer);
    await expect(page.locator('#content h1')).toHaveText('Along the way.',{timeout:30000});
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await page.goto('/?topic=links');
  await expect(page.locator('#content h1')).toHaveText('Who was heard together?',{timeout:30000});
});
