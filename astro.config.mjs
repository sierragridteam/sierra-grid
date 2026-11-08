import { defineConfig } from 'astro/config';
const allowedHosts = Object.entries(process.env)
  .filter(([key, value]) => key.startsWith('MOAT_URL_GRID') && value)
  .map(([, value]) => new URL(value).hostname);
export default defineConfig({
  site: 'https://grid.sierragridteam.org',
  output: 'static',
  server: { host: '0.0.0.0', port: 8182, allowedHosts },
  vite: { server: { strictPort: true } },
});
