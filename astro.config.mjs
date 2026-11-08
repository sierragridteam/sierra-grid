import { defineConfig } from 'astro/config';
const allowedHosts = Object.entries(process.env)
  .filter(([key, value]) => key.startsWith('MOAT_URL_GRID') && value)
  .map(([, value]) => new URL(value).hostname);
export default defineConfig({
  site: 'https://grid.sierragridteam.org',
  output: 'static',
  devToolbar: { enabled: false },
  server: { host: '0.0.0.0', port: 8184, allowedHosts },
  vite: { server: { strictPort: true } },
});
