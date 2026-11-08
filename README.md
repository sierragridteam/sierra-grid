# SIERRA Grid — Mesh Notebook (candidate B)

A standalone Astro investigation workspace for public mesh observations. Built with the published SIERRA SDK and design system. This is an isolated bakeoff candidate; no deployment is selected.

```sh
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 8184
make verify
pnpm test:browser
```

Use Node 26.13.0+ and pnpm 12.18.0. In this workspace, use `direnv exec` at the workspace root and pass an absolute `pnpm --dir` path. Astro may background itself in agent sessions; the Playwright configuration uses `--ignore-lock` to retain foreground lifecycle.

Live is the default. `?mode=demo` explicitly selects synthetic fixtures. Add `scenario=empty`, `stale`, `partial` or `unavailable` to exercise data states. Every query is public and read-only; no credentials are required.

See [BAKEOFF_REPORT.md](BAKEOFF_REPORT.md) for exact review links, data boundaries, verification evidence and screenshots.
