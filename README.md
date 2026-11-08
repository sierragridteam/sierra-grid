# Sierra Grid — Three Tenses

A live-only exploration proposal organized around Now, Ahead and Recorded.

Use the repository-pinned Node/pnpm environment. Install with `pnpm install --frozen-lockfile`, validate with `make verify`, and run locally with `pnpm dev --host 127.0.0.1 --port 8185 --ignore-lock`.

`pnpm test:browser` is a separate live integration suite requiring that local server and access to `https://data.sierragridteam.org`. It never fabricates observations. See CONCEPT.md, COVERAGE.md and BAKEOFF_REPORT.md for the design, route inventory, verification evidence and limitations.
