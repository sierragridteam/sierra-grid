# SIERRA Grid: common competition brief

You are one of three agents in a clean-room competition. Your implementation will
be run, tested and compared with the others. Aim to build the most useful, coherent
and compelling explorer for advanced SIERRA members. No competitor sees another's
work. All receive this same brief, starting commit, SDK, design system and fixtures.
Work only in the branch/worktree assigned in your task. Do not inspect other
competitors' directories, branches, PRs, screenshots, notes or agent messages.

## Product

Sierra Data aggregates public observations across Calaveras and nearby areas. Its
embedded website mixes data exploration with API documentation. **Grid is a new,
standalone exploration product**, intended for grid.sierragridteam.org. It must
feel like a SIERRA property, using sierra-ds, while serving technically advanced,
deeply interested people. Jay and other members especially want rich mesh data
exploration. The main SIERRA website continues serving a simpler public subset.

Help people answer questions, follow changes, compare observations and spot patterns.
Choose your own information architecture, visual composition and investigation
workflow. A wall of status cards, raw JSON or API endpoint explanations is not the
product. Prioritize a small number of connected, working investigative experiences
rather than a large inventory of disconnected screens. Make the mesh experience
substantial, and connect it to other relevant data where that adds real value.

## Equal shared foundations

- Astro, TypeScript, pnpm and the exact committed dependency lockfile.
- `@sierragridteam/sdk`: generated TypeScript/Zod client. All data API requests go
  through it. Read its README and source package exports before assuming fields.
- `@sierragridteam/design-system`: shared typography, tokens, logos, controls,
  data tables/status, map primitives and the new updateable time-series chart.
- `src/lib/client.ts` provides `createExplorerContext(location.search)`, returning
  `{client, mode, scenario, now}`. Default is **live**. `?mode=demo` explicitly uses
  synthetic data with a fixed reference clock. Never pass fake data off as live.
- Demo scenarios: `normal`, `empty`, `stale`, `partial`, `unavailable`. Preserve
  `mode` and `scenario` across navigation. These affect the SDK transport rather
  than just changing a banner. Reviewers will exercise every one.
- SDK fixtures use six synthetic mesh nodes with contrasting records: real zero
  versus unknown, a collection gap, a reboot, an unmonitored node, truncation, and
  an out-of-region endpoint. Use the API's returned coverage/completeness metadata.

The starter deliberately provides no navigation, page layout or dashboard design.
Shared libraries are frozen during competition: do not edit/fork/vendor them or
install a different version to gain an advantage. Report a blocker to the root agent
so any necessary shared fix can be given to all entrants. Record optional reusable
component requests in `BAKEOFF_REPORT.md`; keep new generic DS needs visible.

## Data semantics that must hold

- Mesh links are **observed** undirected connections, not proof of RF range or
  complete network topology. Preserve endpoint identity even outside a place filter.
- Mesh liveness comes from `lastRelayedAt`, then `lastHeardAt`; event `observedAt`
  is not a reliable last-heard clock. State which window a conclusion covers.
- Event revisions are snapshots, not periodic telemetry samples. Use the telemetry
  endpoint for node time series. Counter resets/reboots cannot become negative
  throughput; nulls and unsampled gaps cannot become zero or a continuous line.
- Archive/telemetry requests need explicit bounded windows. History has half-open
  `[from,to)` bounds; some history filters refer to current event/place attachments.
- Continue pagination using `nextPageToken`, not page length. A capped/truncated or
  partially fetched result must never imply complete history or a definitive total.
- Keep unavailable, empty, stale, partial and healthy states distinct. An API failure
  must not produce an all-clear. Preserve source attribution and measurement times.
- Keep directive life-safety text verbatim, AI text identified, and evacuation data
  reference-only with its authoritative source link if you choose to show it.
- Fixtures are synthetic test observations. Do not change their values/transport to
  make your design look better. No private member data, credentials or paid API calls.

## Minimum working evidence

Deliver a runnable explorer with meaningful mesh investigation, node/history detail
or comparison, useful filters/search and shareable URL state. Use the shared chart
for temporal data and DS map/table/control primitives where appropriate. A user must
be able to get from an overview to a concrete observation and back without losing
context. Provide visible live/demo identification and a way to switch modes.

Support desktop and narrow screens, keyboard access, legible labels/units and useful
loading/error/retry states. Avoid horizontal page overflow. Charts must have an
accessible alternative; maps cannot be the only way to select or understand data.

Run `make verify` and add browser tests for the core investigative workflow, URL
restoration, empty/failed/partial data and a narrow viewport. Browser testing must
exercise interactions rather than merely assert that the homepage loaded. You may
use Playwright already provided by the starter. Keep tests deterministic using the
shared SDK fixture transport. Read-only live smoke checks are useful but must not
become flaky CI dependencies.

Include `BAKEOFF_REPORT.md` with:
- the central investigation workflow and your three strongest implemented features;
- test commands/results and exact useful review URLs (including selected state);
- known limitations, supported API boundaries, and intentional tradeoffs;
- reusable DS/SDK additions to consider after the competition;
- screenshots in `artifacts/` of desktop, narrow, one detail/analysis state, and a
  partial/unavailable state. No fabricated success claims.

Commit your finished implementation on your assigned branch. Do not merge or deploy.
The root agent will create review PRs, reproduce tests and compare the proposals.

## Evaluation rubric (same for all entrants)

| Dimension | Weight |
| --- | ---: |
| Investigative usefulness and discovery of patterns | 25 |
| Mesh and historical exploration supported by real data | 25 |
| Interaction clarity, navigation and accessibility | 15 |
| Honest treatment of freshness, missing/failed/partial data | 15 |
| Visual coherence with SIERRA and responsive layout | 10 |
| Maintainability, SDK/DS reuse and test coverage | 10 |

Reviewers will distinguish working capabilities from aspirations and choose the best
ideas across implementations. This is not a speed contest; finish a coherent product
and substantiate its behavior with tests. Do not ask for details from other entrants.

## Chart usage reference

```astro
---
import TimeSeriesChart from '@sierragridteam/design-system/components/TimeSeriesChart.astro';
---
<TimeSeriesChart id="signal-chart" label="Signal history" unit="dB" series={[]} />
<script>
  import type { TimeSeriesChartElement } from '@sierragridteam/design-system/lib/time-series';
  await customElements.whenDefined('sierra-time-series');
  const chart = document.querySelector<TimeSeriesChartElement>('#signal-chart')!;
  chart.series = [{ id: 'snr', label: 'SNR', points: [
    { time: Date.UTC(2026, 10, 7, 8), value: 0 },
    { time: Date.UTC(2026, 10, 7, 9), value: null },
  ] }];
  // Set a justified gap threshold from sampling cadence, not guesswork.
  chart.options = { ...chart.options, maxGapMs: 60 * 60 * 1000 };
</script>
```

Charts share one unit per axis, use UTC, and preserve an accessible data table.
Four line/color styles repeat; use small multiples or selection for more series.
The component does not aggregate, smooth, infer availability or compute deltas.
