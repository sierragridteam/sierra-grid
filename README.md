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

The default development port is 8182. Preview branches use separate ports.
Shared library code comes from published `@sierragridteam/sdk` and
`@sierragridteam/design-system` dependencies. Brand assets are copied from the DS
package during dev/build, not maintained independently here.

Read [the common competition brief](docs/BAKEOFF.md) and [AGENTS.md](AGENTS.md).
No production deployment is configured until the design review and selection.

Copyright © 2026 Signal Integrity & Emergency Radio Response Alliance.
All rights reserved.
