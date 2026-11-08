# Candidate A — Mesh investigation bench

The central workflow is **node → observed neighbors → sampled evidence → comparison**.
A compact, searchable ledger keeps the investigation grounded in individual radios;
a schematic explains relationships without suggesting RF coverage. The notebook opens
below the same context so closing it never destroys the search or place filter.

## Three strongest implemented features

1. **Connected investigation.** Search names or keys, filter place and liveness/admin
   evidence, select a node from the ledger, keyboard-accessible schematic, geographic
   view or neighbor list, and follow neighbors without losing context. The schematic
   preserves endpoints outside filters and explicitly limits large networks to 20
   endpoints, prioritizing the selected neighborhood then observed degree. Geographic
   plotting uses the actual Point geometry through the shared DS map, not centroids.
2. **Bounded historical comparison.** Compare two nodes over 6/24/72-hour windows,
   choose an archive ending time in UTC, and examine battery, SNR, RSSI, temperature
   or received packets/minute. Shared DS charts provide accessible tables. Packet
   rates use BigInt counter deltas, break at counter resets/reboots and collection
   gaps, and never imply negative throughput. URL state restores selections, filters,
   metric and archive ending; Copy pins the ending time for reproducibility.
3. **Evidence quality stays visible.** Source health and last successful collection
   remain distinct from radio last-relayed/last-heard time. Latest admin measurement
   time, source links, coverage bounds, sample counts, gaps, reboots, null readings,
   genuine zeroes, truncation and node-specific errors are explicit. Event revisions
   are a separate paginated trail, clearly described as snapshots rather than samples.

## Validation

Run from this worktree using the pinned environment:

```sh
make verify
pnpm test:browser
```

- `make verify`: 5 unit tests pass; Astro check has zero errors/warnings/hints;
  static build passes. Build warns about the shared MapLibre chunk size.
- `pnpm test:browser`: 5 interaction tests pass: selection/comparison/metrics/revisions/
  reload/back, partial pagination and per-node failure, empty/unavailable/retry/stale,
  390px layout and axe, and place/outside-endpoint plus historical-window restoration.
- Axe scan reports zero violations on the narrow selected-node view; document has
  no horizontal overflow at 390px. This is automated coverage, not a full manual audit.
- Read-only live SDK smoke on 2026-11-07: events (one-row request), mesh links (24h)
  and sources all returned HTTP 200. A live browser smoke loaded 764 nodes, rendered
  the disclosed 20-endpoint diagram and reported zero page errors. No live data is
  checked into the repository.
- `node scripts/screenshots.mjs`: reproducible screenshots with the preview on 8183.
  Screenshots in `artifacts/`: desktop, analysis, narrow, partial and unavailable.

Playwright starts its own server with `--ignore-lock` to prevent Astro 7's agent
background mode from exiting the runner. It reuses an existing server on 8183 when
present. No deploy, merge, API writes or credential access was performed.

## Review URLs

Start: `pnpm dev --host 127.0.0.1 --port 8183`.

- Live default: http://127.0.0.1:8183/
- Demo overview: http://127.0.0.1:8183/?mode=demo
- Meadow gap versus Ridge reboot, packet rate:
  http://127.0.0.1:8183/?mode=demo&node=meshcore:2222222222222222222222222222222222222222222222222222222222222222&compare=meshcore:4444444444444444444444444444444444444444444444444444444444444444&metric=packets&window=24&to=2026-11-07T12%3A00%3A00.000Z
- Truncated archive:
  http://127.0.0.1:8183/?mode=demo&scenario=partial&node=meshcore:1111111111111111111111111111111111111111111111111111111111111111
- Partial node failure:
  http://127.0.0.1:8183/?mode=demo&scenario=partial&node=meshcore:3333333333333333333333333333333333333333333333333333333333333333
- Empty: http://127.0.0.1:8183/?mode=demo&scenario=empty
- Stale: http://127.0.0.1:8183/?mode=demo&scenario=stale
- Unavailable: http://127.0.0.1:8183/?mode=demo&scenario=unavailable

## Boundaries and tradeoffs

All API traffic goes through frozen SDK 0.1.0. Presentation consumes DS 0.5.0,
including Logo, Button, DataTable, GeoJSONMap and TimeSeriesChart; no shared code is
vendored. Lockfile and package versions are unchanged. Native selects intentionally
provide straightforward keyboard and mobile platform behavior.

Supported calls: mesh-filtered event listing (20-page cap, explicit incomplete marker),
places, sources, rolling mesh links, bounded node telemetry, and bounded per-event
revision history (10-page cap, explicit partial marker). Pagination follows tokens,
not page length. API errors do not produce health conclusions. Latest observations
and links remain current even when examining a past archive window; the UI labels
this distinction. Refresh is manual; no polling loop or hidden background archive crawl.

Intentional focus is mesh evidence, not a broad multi-layer dashboard. There is no
road/weather correlation view, alerting, topology replay, custom aggregation, export,
packet-level drilldown, or arbitrary multi-day date range. Geometry-only context
avoids a basemap dependency; the ledger and neighbor list are usable without WebGL.
Schematic arrangement is radial, not geographic or a routing algorithm; 20-endpoint
limits avoid implying a complete topology. Full neighbor evidence remains in the
notebook. Comparisons use the stricter of the two reported cadences to avoid joining
gaps; unknown cadence conservatively avoids connected lines. Reboot evidence is
listed rather than drawn as a chart overlay. Source attribution is linked per node.

## Shared additions to consider later

- Logo accessible-name whitespace: adjacent wordmark spans trigger axe label-content-name-mismatch
  against its explicit aria-label; this consumer removes the redundant label so visible
  wordmark text supplies the name. Reported to root; no shared package edits.
- Updateable GeoJSONMap data API (currently replace the element to apply filters),
  selected-feature setter and explicit viewport fit controls.
- Shared chart event annotations for reboot/reset intervals and per-series cadence
  thresholds; denser axis tick formatting and optional synchronized cursor.
- SDK bounded-pagination result metadata helper (complete/capped/failed after pages),
  and topology archive support if the server eventually offers historical links.
- Shared responsive graph/neighbor primitive with full endpoint identity, keyboard
  navigation and unlocated/outside-filter treatments.

No foundation blocker required a private fork. Root notified all entrants of the
fixture centroid inconsistency; this implementation uses `geometry.object` already.
