# Candidate C — Mesh Evidence Desk

The central question is **“What changed, and how much do we actually know?”**
Start with the node index or observed topology, follow an endpoint, compare its
sampled evidence against a neighbor, and inspect its revision ledger. Filters and
selected evidence stay in the URL; the overview remains available above the detail.

## Three strongest implemented features

1. **Connected investigation.** Search by name/key; filter current place attachment
   and monitor verdict; select a schematic node, roster entry or connection endpoint;
   follow neighbors into detail. External endpoints retain their public keys and
   remain selectable outside the place filter. The schematic is explicitly not
   geography, RF coverage or complete topology. The DS connection table supplies
   packet counts, distinct days and last-seen times for accessible inspection.
2. **Comparable evidence, with gaps intact.** Two-node shared DS charts support
   battery, temperature, admin SNR and received packet rates. Archive metadata,
   collection gap counts, reboot times and truncation appear beside the plot.
   BigInt counter subtraction avoids precision loss; reboots, decreases, gaps,
   missing cadence and unsafe deltas remain unknown. Null gauges never become zero.
   An accessible DS data table is available for every chart.
3. **Independent source and collection state.** Radio activity uses lastRelayedAt,
   then lastHeardAt; monitor reachability and event snapshots remain distinct.
   Source health is visible, with stale evaluator checks. Partial telemetry failure
   preserves a successful comparison series. Pagination follows continuation tokens,
   including short pages, and retains prior evidence if a later page fails. A
   bounded, paginated revision ledger describes snapshots, not periodic telemetry.

## Run and review

Use the pinned Node 26.13.0 / pnpm 12.18.0 environment. From this worktree:

```sh
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 8185
make verify
pnpm test:browser
```

In the shared host, prefix commands with `direnv exec` and explicitly change back
into this worktree, since the root direnv configuration changes the working directory.
Playwright uses `--ignore-lock` to keep Astro 7 in the foreground and manages its own
server when one is not already available. All final preview/test servers are stopped.

Useful exact URLs after starting the preview:

- Overview: http://127.0.0.1:8185/?mode=demo
- Collection gap against a neighbor: http://127.0.0.1:8185/?mode=demo&node=2222222222222222222222222222222222222222222222222222222222222222&compare=1111111111111111111111111111111111111111111111111111111111111111&metric=batteryPercent&hours=24
- Reboot-aware packet rates: http://127.0.0.1:8185/?mode=demo&node=4444444444444444444444444444444444444444444444444444444444444444&metric=packetsReceived
- Partial comparison failure: http://127.0.0.1:8185/?mode=demo&scenario=partial&node=1111111111111111111111111111111111111111111111111111111111111111&compare=3333333333333333333333333333333333333333333333333333333333333333
- Empty: http://127.0.0.1:8185/?mode=demo&scenario=empty
- Stale: http://127.0.0.1:8185/?mode=demo&scenario=stale
- Unavailable: http://127.0.0.1:8185/?mode=demo&scenario=unavailable
- Live: http://127.0.0.1:8185/

The default is live; demo is explicit, synthetic and fixed-clock. A visible switch
and scenario selector retain the rest of the investigation state.

## Validation

- `make verify`: 6 unit tests pass; Astro check reports zero errors/warnings/hints;
  static production build succeeds.
- `pnpm test:browser`: 9 tests pass. Exercises selecting nodes, comparing series,
  measurement changes, revision ledger, reload/back URL restoration, filters,
  outside endpoint preservation, empty/stale/partial/unavailable scenarios and retry,
  zero/unknown/gap/reboot semantics, keyboard selection and 390px page overflow.
- Axe WCAG 2 A/AA and 2.1 AA scan of a selected investigation: no violations.
- Public read-only SDK smoke: listEvents(MESH, pageSize 2), listMeshLinks(24h), and
  listSources each returned HTTP 200 and schema-validated responses. These checks
  are deliberately outside deterministic CI tests.
- Screenshots: [desktop](artifacts/desktop.png), [analysis](artifacts/analysis.png),
  [390px narrow](artifacts/narrow.png), [partial](artifacts/partial.png),
  [unavailable](artifacts/unavailable.png). Reviewed the desktop/detail/narrow output.
- Published SDK 0.1.0 and DS 0.5.0 retained; dependency manifest and lockfile unchanged.

## Boundaries and tradeoffs

- Focused mesh investigation, not a general emergency dashboard. No evacuation,
  directive text, AI summaries, alerts, production writes or paid services.
- Calls use SDK listEvents, getEvent (for endpoints outside the loaded index),
  listPlaces, listSources, listMeshLinks, getMeshTelemetry and listHistory.
  No direct API fetches and no copied shared-library implementation.
- Lookback is 24h, 72h or seven days ending at the loaded reference clock. Live
  share links retain relative query state, not an immutable historical snapshot;
  refresh/reload advances the live clock. Custom absolute historical windows,
  brushing, export and archived topology playback are intentionally absent.
- Mesh history does not support a node-ID filter. One bounded MESH archive is
  paginated and then filtered locally to selected IDs. The 20-page cap is explicit;
  a busy live archive can require a narrower lookback. It never implies complete
  history when a token remains or a page fails.
- The schematic draws at most 40 endpoints; the connection table retains all
  returned links touching the filtered roster. This is an investigation aid, not a
  geographic map or RF model. No dependency on external tiles. No use of fixture
  centroids (the shared fixture inconsistency does not affect this design).
- Charts break gaps at 1.5× the returned median cadence. Comparison charts use the
  smaller cadence conservatively; no smoothing or interpolation is performed.
  Samples missing their reportedAt cannot be positioned and are omitted from plots;
  returned sample counts still describe the raw archive. Reboot-related packet rate
  samples are unknown; gauge readings remain valid across a reboot if reported.
- Source diagnostics remain independent from archived readings: a STALE source
  does not rewrite a historical series. No node liveness boolean is inferred.
- No automatic polling: explicit refresh controls the reference clock and data load.
- Native labeled select controls complement DS Button, Logo, MapFrame, DataTable,
  shared chart and typography/tokens. SVG schematic logic is product-specific.

## Reusable additions to consider after competition

- DS: accessible observed-network diagram primitive with per-endpoint selection,
  deterministic layout, keyboard interaction and an external endpoint treatment.
- DS: chart annotations for reboot boundaries and explicit collection intervals;
  per-series gap thresholds would avoid conservative shared thresholds.
- SDK/API: bounded node-specific revision query or event-ID filter on listHistory,
  and cancellable pagination that returns a typed completeness result.
- SDK: an explicit archive coverage intersection helper distinguishing no retained
  archive, outside requested coverage, truncated response and missing samples.

No shared blocker, fork, production deployment, merge or dependency upgrade was used.

## Coordinator review, 7 November 2026

The independent implementation above was completed against SDK 0.1.0 and DS 0.5.0.
All three entrants then received the same registry patches: SDK **0.1.1** (consistent
fixture Point geometry) and DS **0.5.1** (natural whitespace in the accessible logo name).
These supersede the original frozen-version and logo-issue notes above. Candidate A’s
local logo workaround was removed; all entrants now use the shared fix.

The coordinator reran `make verify` and the full browser suite successfully after
these patches. Independent WCAG 2/2.1 A/AA checks include `wcag21a`.

Local freshness evaluation can replace an authoritative UNAVAILABLE source status with STALE. Live investigation links use relative windows, so they do not reproduce an absolute historical interval. These are review findings to resolve before production.

This is a competing review proposal, not a production-ready or selected implementation.

The coordinator’s broader WCAG 2.1 A scan also found `label-content-name-mismatch`
on schematic node links: visible key text is absent from the accessible name. This
is a candidate issue, separate from the corrected shared Logo. The original browser
suite omitted the `wcag21a` tag and did not catch it.
