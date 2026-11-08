# Sierra Grid — round 2

Read `docs/BAKEOFF.md` and `docs/DATA_INVENTORY.md` before designing. They define the
approved competition: full live-data exploration through evidence-backed stories.
The real API is **https://data.sierragridteam.org**. Use the published sierra-sdk;
no synthetic observations, fixture transports or demo modes. Use sierra-ds for shared
presentation. Follow the brief's data semantics, coverage and validation requirements.

Node 26.13.0+, pnpm 12.18.0, TypeScript 6. Keep committed dependency versions/lockfile
identical across entrants. Report shared blockers to root; do not fork packages.
No credentials, private data, production writes or deployments. Use your assigned
worktree/branch only; do not inspect any competing or previous implementations.
Run `make verify` plus real-data browser interaction/accessibility checks. Record
coverage, missing public access and limitations honestly. Do not merge a winner.
