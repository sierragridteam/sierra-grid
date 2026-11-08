# Candidate B — The Mesh Notebook

The central workflow is **follow a connection → compare sampled behavior → check the change record**. The node index stays available while an investigation opens in the main notebook. A member can identify a low or unknown battery, follow a peer, compare telemetry, and inspect bounded event revisions without losing the query.

## Three strongest implemented features

1. **Connections lead directly to investigations.** A geometry map and a fully keyboard-accessible connection ledger show returned undirected observations. Endpoint buttons open a node; “Compare endpoints” opens both in one action. Search covers names and full public keys. Filters separate low batteries, unknown batteries, and missing admin readings. Outside endpoints retain public-key identity even if their event is not loaded.
2. **Paired telemetry with explicit uncertainty.** The shared DS chart compares battery, temperature, reported SNR, or packet transmission rate for two nodes. The requested UTC window is displayed and charted in full, including unsampled ends. Per-node coverage, cadence, truncation, errors, gap counts and reboot times remain visible. Packet rates use BigInt differences and never cross resets, source-declared reboot boundaries, unknown cadence, or collection gaps. The chart includes the shared accessible exact-value table. A failed comparison does not erase the successful node's observations.
3. **A reproducible evidence notebook.** Node selection, comparison, measure, search, filter, window length and absolute window end are in the URL; back/forward restores them. Mode/scenario persist. Bounded mesh/road revision history loads on request and follows continuation tokens even after short pages. Source health, measurement time, attribution and event identity remain inspectable. “Copy investigation link” copies the complete URL.

## Running and review URLs

Run from this worktree with the pinned toolchain:

```sh
pnpm dev --host 127.0.0.1 --port 8184
```

- Overview: http://127.0.0.1:8184/?mode=demo
- Meadow collection gap versus Ridge reboot, packet rates: http://127.0.0.1:8184/?mode=demo&node=2222222222222222222222222222222222222222222222222222222222222222&compare=4444444444444444444444444444444444444444444444444444444444444444&metric=packets&hours=24&until=2026-11-07T12%3A00%3A00.000Z
- Unknown battery versus real zero: http://127.0.0.1:8184/?mode=demo&node=3333333333333333333333333333333333333333333333333333333333333333&compare=4444444444444444444444444444444444444444444444444444444444444444
- Partial archive and independently failed comparison: http://127.0.0.1:8184/?mode=demo&scenario=partial&node=1111111111111111111111111111111111111111111111111111111111111111&compare=3333333333333333333333333333333333333333333333333333333333333333
- http://127.0.0.1:8184/?mode=demo&scenario=empty
- http://127.0.0.1:8184/?mode=demo&scenario=stale
- http://127.0.0.1:8184/?mode=demo&scenario=unavailable
- Live: http://127.0.0.1:8184/ (default; never replaced with fixtures on failure)

## Verification

- `make verify`: six unit tests pass; Astro check reports zero errors/warnings; production build passes. Build warns about MapLibre's large bundle.
- `pnpm test:browser`: five deterministic Playwright workflows cover selection, paired charts, metrics, full URL reload, browser back, changed UTC bounds, archive pagination through short pages, unknown/zero, unmonitored telemetry, stale sources, empty/unavailable states, retry, narrow overflow and keyboard selection/table access.
- `node scripts/audit.mjs` against the running preview: one known shared DS Logo `label-content-name-mismatch` violation at frozen DS 0.5.0. Root is applying a shared correction to all entrants; no consumer workaround or exclusion is retained. No other axe violations were reported. This supplements keyboard/responsive testing.
- `node scripts/capture.mjs`: records desktop, narrow, analysis and partial screenshots under `artifacts/`; no browser page errors during capture.
- Read-only live smoke: SDK mesh event index, rolling links and source diagnostics all returned validated HTTP 200 responses on 2026-11-07. Live availability is deliberately excluded from CI.
- Exact original dependency versions and lockfile retained. No deployments or data writes.

## Boundaries and tradeoffs

- Current mesh index uses `listEvents` with explicit `MESH` and OBJECT geometry; at most 20 pages of 100 records are fetched. The UI marks a surviving token or fetch failure as partial. Search/filter operate over loaded records. Counts are loaded counts, not fleet totals.
- The connection endpoint accepts a rolling duration, not historical absolute endpoints. Its own generation timestamp and window are displayed separately from the archive's end; the UI does not pretend to replay historical topology. Returned links are observations, not RF coverage or complete topology.
- Telemetry uses `getMeshTelemetry` with explicit `[from,to)` windows of 24h, 72h or seven days; sample receipt time is the x axis. Gauges are neither interpolated nor smoothed. Unknown cadence splits every sample and disables rate inference. Charts compare at most two nodes to keep interpretation legible.
- No basemap dependency: the DS geometry map is deterministic and works without tile service access. Object Point coordinates are used for link endpoints. Non-Point or unlocated endpoints remain in the connection ledger, not invented geographic positions. Collinear fixture nodes cause overlapping link geometries; the ledger is the authoritative individual-link presentation.
- History uses `listHistory` for mesh and road revisions, 25/page, explicitly paginated by the user. It is a contextual change ledger, not an event telemetry substitute. It shows snapshot headlines/status and source identity, without inferring causation. No evacuation or other life-safety layer is presented.
- Source diagnostics use `listSources`; selected identity can use `getEvent` for an outside endpoint. All API calls go through the frozen SDK. No production captures are committed.
- Refresh is manual. There is no push stream, persistent annotation store, export file or claimed network-health score. Absolute query bounds and URL links make investigations reproducible without inventing a notebook backend.
- Mode uses the original transport and fixture clock. The source-health stale scenario does not rewrite telemetry. Demo values and transport were not altered.

## Shared library follow-ups

- An updateable `GeoJSONMap` data property would avoid replacing the element to load SDK responses. An optional selected-key property and per-feature accessible label support would improve linked map/index views.
- Chart per-series cadence thresholds, annotation marks for reboots, and concise axis tick formatting would support richer comparison. This app inserts null separators using actual cadence and shows reboot text separately.
- The DS Logo's wordmark text is concatenated across spans; axe flagged an accessible-name mismatch. No consumer workaround is retained; root is applying the same shared correction to all entrants.
- SDK fixtures currently have shared centroids despite distinct Point object coordinates; this app uses the Point geometry. No package fork or modification was made.

## Artifacts

- `artifacts/desktop.png`: overview and connection ledger.
- `artifacts/analysis.png`: gap/reboot packet-rate comparison.
- `artifacts/narrow.png`: same working investigation at 390px.
- `artifacts/partial.png`: partial coverage plus an independently unavailable comparison.
