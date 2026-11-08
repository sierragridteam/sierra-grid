# Sierra Grid

Read `docs/BAKEOFF.md` before implementation. This is a standalone data explorer
for technically advanced SIERRA members, intended for grid.sierragridteam.org.
It is not the public landing page, an API reference, or the embedded data-service site.

Use pnpm 12.18.0 and Node 26.13.0+. Astro provides the static site; use TypeScript
for browser behavior. Consume `@sierragridteam/sdk` for every data API request and
`@sierragridteam/design-system` for shared presentation. Do not vendor their code.
Map tile requests are the only data-network exception. Keep all credentials out
of this public repo; the data API is public and read-only.

Application-specific investigation logic belongs here. New generally reusable
components belong in sierra-ds. During the competition the shared SDK and DS
versions are frozen: record additional needs instead of giving one entrant a fork.

Never turn unknown, failed, stale, unmonitored, incomplete or truncated data into
an all-clear or a zero. Keep source attribution and measurement time visible.
Observed links do not establish RF coverage. Event revisions are not telemetry
samples; use the telemetry endpoint for sampled node history. Preserve gaps and
counter-reset boundaries. Make query state shareable in the URL.

Use normal semver dependency ranges with committed pnpm lockfiles. Run `make verify`
and browser tests for real interactions, error states and responsive overflow.
Do not deploy an entrant, alter existing services, or merge a winner during bakeoff.
Work only in your assigned worktree/branch; do not inspect other candidates.
