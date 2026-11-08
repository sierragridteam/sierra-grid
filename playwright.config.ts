import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/browser', timeout: 90000, expect: { timeout: 30000 }, use: { baseURL: 'http://127.0.0.1:8184', headless: true }, workers: 1, reporter: 'list' });
