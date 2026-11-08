import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', fullyParallel: true, use: { baseURL: 'http://127.0.0.1:8184', browserName: 'chromium' }, webServer: { command: 'pnpm dev --host 127.0.0.1 --port 8184 --ignore-lock', url: 'http://127.0.0.1:8184', reuseExistingServer: true }, reporter: 'list' });
