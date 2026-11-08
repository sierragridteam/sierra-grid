import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',use:{baseURL:'http://127.0.0.1:8183',headless:true},webServer:{command:'pnpm dev --host 127.0.0.1 --port 8183 --ignore-lock',url:'http://127.0.0.1:8183',reuseExistingServer:true},workers:1});
