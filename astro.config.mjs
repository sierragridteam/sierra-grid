import { defineConfig } from 'astro/config';
// Extra hostnames the dev server answers to (comma-separated), e.g. behind a tunnel or proxy.
const allowedHosts = (process.env.GRID_DEV_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
export default defineConfig({
  site: 'https://grid.sierragridteam.org',
  output: 'static',
  devToolbar: { enabled: false },
  server: { host: '0.0.0.0', port: 8182, allowedHosts },
  vite: {
    // DS ships source with a Vite worker import; transform it normally rather
    // than prebundling it as an ordinary dependency during development.
    optimizeDeps: { exclude: ['@sierragridteam/design-system'] },
    server: { strictPort: true },
  },
});
