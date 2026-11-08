# Sierra Grid

Standalone SIERRA data exploration, intended for `https://grid.sierragridteam.org`.
The project is currently comparing three independent implementations before choosing
and combining their strongest features. This main-branch foundation is deliberately
minimal; it does not choose a layout or information architecture for the entrants.

Use Node 26.13.0 and pnpm 12.18.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
make verify
```

All observations come live from **https://data.sierragridteam.org** through the SDK.
There is no demo or fixture mode. Read [the data inventory](docs/DATA_INVENTORY.md).

This proposal uses development port 8184. Run `pnpm test:browser` separately
while the development server is running; these checks read the live API and are
not deterministic CI. See [the proposal report](BAKEOFF_REPORT.md),
[coverage](COVERAGE.md) and [selected concept](CONCEPT.md).
Shared library code comes from published `@sierragridteam/sdk` and
`@sierragridteam/design-system` dependencies. Brand assets are copied from the DS
package during dev/build, not maintained independently here.

Read [the common competition brief](docs/BAKEOFF.md) and [AGENTS.md](AGENTS.md).
No production deployment is configured until the design review and selection.

Copyright © 2026 Signal Integrity & Emergency Radio Response Alliance.
All rights reserved.
