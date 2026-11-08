import { chromium } from '@playwright/test';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});
await page.goto('http://127.0.0.1:8183/?mode=demo');await page.locator('#nodes .node').first().waitFor();await page.screenshot({path:'artifacts/desktop.png',fullPage:true});
await page.goto('http://127.0.0.1:8183/?mode=demo&node=meshcore:'+ '2'.repeat(64)+'&compare=meshcore:'+'4'.repeat(64)+'&metric=packets');await page.locator('#archive-status').getByText('Ridge Relay:',{exact:false}).waitFor();await page.locator('#detail').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/analysis.png',fullPage:true});
await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:8183/?mode=demo&node=meshcore:'+'4'.repeat(64));await page.locator('#archive-status').getByText('Ridge Relay:',{exact:false}).waitFor();await page.screenshot({path:'artifacts/narrow.png',fullPage:true});
await page.setViewportSize({width:1440,height:1050});await page.goto('http://127.0.0.1:8183/?mode=demo&scenario=partial&node=meshcore:'+'1'.repeat(64));await page.getByText(/PARTIAL \/ TRUNCATED/).waitFor();await page.screenshot({path:'artifacts/partial.png',fullPage:true});
await page.goto('http://127.0.0.1:8183/?mode=demo&scenario=unavailable');await page.locator('#list-status').getByText(/unavailable/).waitFor();await page.screenshot({path:'artifacts/unavailable.png',fullPage:true});
await browser.close();
