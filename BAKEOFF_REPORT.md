# The region, in three tenses — candidate C

The primary interaction is **Now / Ahead / Recorded**. These lenses change the question and the evidence that can answer it. Now draws live weather and domain-level regional signals; Ahead selects an evidence-backed gust in remaining forecast periods and opens forecasts or planned events; Recorded introduces recent non-radio revisions and bounded archive exploration. The product is a temporal reading room, with a subject index that keeps every public domain within reach.

Warm paper, forest ink, large serif tense labels, fine rules and numbered evidence rows support a deliberately quiet reading experience. It is not organized around a node table or map. The published DS supplies fonts/tokens/global styles, logo, buttons and accessible time-series renderer; product composition and structured field presentation remain local. SDK and DS manifest/lockfile versions are unchanged.

## Working behavior

- All eight event families, weather/forecasts, condition projections, cameras, scanner references, places/summary/resolution, source health, rolling radio links and admin measurements have discoverable routes. See COVERAGE.md for exact field mapping.
- Literal live observations lead to evidence; no generated narrative claims, cached showcase records or synthetic observations are used.
- Source text and NWS instructions are preserved, with AI attribution. Stored current and historical enhancement I/O is a separate explicit read-only action.
- URL query state preserves tense, subject, place, event, selected revision, archive interval, loaded page depth, and measurement/history pane including explicit UTC measurement bounds. Browser back and direct historical reload are checked.
- Continuation tokens drive explicit next-page actions. Later failures retain earlier pages and say the collection is incomplete. Historical direct-link lookup is bounded; it does not replace an unresolved snapshot with the current event.
- Requests share a visit-local cache; there is no automatic polling or bulk history crawl. Source clocks remain visible. Measurement nulls and exact integer strings are preserved; counter rates are not invented.

## Review locally

Use the pinned environment and install with `pnpm install --frozen-lockfile`. Start `pnpm dev --host 127.0.0.1 --port 8185 --ignore-lock` from this checkout. The delivery server is stopped after verification; restart it for review.

- `http://127.0.0.1:8185/` — Now and live regional readings.
- `http://127.0.0.1:8185/?tense=ahead` — remaining forecast discovery.
- `http://127.0.0.1:8185/?tense=recorded` — recent cross-domain revisions.
- `http://127.0.0.1:8185/?tense=ahead&topic=ROAD_INCIDENT` — planned windows; select evidence.
- `http://127.0.0.1:8185/?tense=recorded&topic=WILDFIRE` — explicit bounded revision collection.
- `http://127.0.0.1:8185/?topic=weather` — current/forecast quantities and charts.
- `http://127.0.0.1:8185/?topic=roads&layer=message_sign` — current signs and source metadata.
- `http://127.0.0.1:8185/?topic=MESH` — identity evidence; select a node and read measurements.
- `http://127.0.0.1:8185/?topic=sources` — provenance registry and public-data limits.

## Verification

Validation ran against the real public API on 2026-11-08 UTC. `make verify` runs deterministic helper/transport tests, Astro/TypeScript checking and the production build. Live browser tests are separate (`pnpm test:browser` with the local server running); no observation mocks are used.

**Final result:** `make verify` passed: 4 deterministic tests, 0 Astro/TypeScript errors or warnings, production build successful. All 5 live browser tests passed in 34.6 seconds on the final behavioral revision; axe reported no violations on the scanned desktop, deep-evidence and narrow pages. Source was subsequently formatted with the pinned TypeScript printer and `make verify` rerun.

The live suite covers discovery → forecast → planned event → history, browser back and URL restoration, exact historical snapshot reload, explicit current/historical stored AI I/O, narrow keyboard/skip link/layout, real condition/reference/source routes, observed links, admin measurements including an older explicit UTC interval and reload, loaded collection depth after back, and initial/later-page failure recovery using aborted network requests only. Axe scans use `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`.

Runtime screenshots: `artifacts/desktop.png`, `narrow.png`, `deep.png`, `ahead.png`, `recorded.png`. These are real browser captures, not curated datasets or mockups. Initial checks caught inherited dark-panel text contrast and invalid definition-list grouping; both were corrected. A later-page retry bubbling bug was also corrected so loaded pages remain in place.

## Honest limits

- This is a broad evidence browser, not a historical replay. Conditions/reference datasets without public archives remain visibly current in every lens.
- Geometry is inspectable as structured coordinates; there is no interactive map. Camera imagery opens upstream instead of embedding images or autoplaying streams.
- Event lists retain API ordering and disclose that unloaded pages do not form a complete chronological collection. Recorded snapshots are revision-time evidence, not every poll.
- Automatic loaded-page restoration is bounded to ten pages and explicitly reports a larger requested depth; manual pagination can continue. Measurement intervals accept up to 400 days per request, with shorter presets and visible truncation.
- Direct selected-revision and historical I/O lookups stop after five 100-row pages with an explicit incomplete state. Manual per-event pagination can continue further.
- Battery voltage and forecast temperature receive charts; other measurement quantities are structured fields/samples. No uptime/counter rate calculations are claimed.
- Source health displays the server-reported state and its timing/policy fields; the UI does not independently reclassify an old server response. A fresh browser retrieval is not represented as fresh upstream evidence.
- Live outages and availability can change test outcomes; an empty public category does not prove absence on the ground. Tests conditionally exercise an event detail only when real rows exist, and do not fabricate rows to make a test pass.
- Address resolution UI is implemented but not exercised with a real personal address. No paid, write, enrichment or deployment actions were run.

## Query-safety follow-up

PR CodeQL analysis identified query-to-HTML paths through generated navigation URLs. All dynamic link and date-input attributes now explicitly use HTML escaping at the interpolation boundary, in addition to URLSearchParams serialization and date validation. The change does not alter navigation state or dependencies. Two browser regressions send hostile quote/tag/entity payloads through internal navigation, back navigation, visible query text and invalid date errors with API requests blocked, never fabricated. `make verify` passed with five deterministic tests; both targeted query-safety browser tests passed. Remote CodeQL must rerun after the fix is pushed.
