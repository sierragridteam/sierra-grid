# Sierra Grid — Question Trail

Follow a question into a live observation, its source, history and related evidence; use the compass to reach any public collection.

All observations come live from **https://data.sierragridteam.org** through the
published Sierra SDK. There is no demo or fixture mode. Shared presentation uses
`@sierragridteam/design-system`.

Use Node 26.13.0 and pnpm 12.18.0:

```sh
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 8184 --ignore-lock
```

Run `make verify` for deterministic tests, checking and build. `pnpm test:browser`
is a separate live integration suite; it requires the local server and public API.
It does not fabricate observations to make tests pass.

Read [the concept](CONCEPT.md), [coverage inventory](COVERAGE.md),
[proposal report](BAKEOFF_REPORT.md), [shared brief](docs/BAKEOFF.md) and
[data inventory](docs/DATA_INVENTORY.md). This is an independent review proposal for
`grid.sierragridteam.org`; no production winner or deployment is selected.

Copyright © 2026 Signal Integrity & Emergency Radio Response Alliance.
All rights reserved.
