# Crossing — proposal A

Crossing makes geographic movement the invitation: slide from foothill towns to
high country, pause at a named place, then follow live observations across all six
domains. It is an observational transect, not a road-routing or journey-safety tool.
The regional shelf exposes observations outside named local attachments.

The strongest evidence connection is deliberately modest and live-computed: a
place's hazard posture and roads severity can disagree because they measure
different things. The sentence links into the roads reading. Weather readings
lead to a matching NWS forecast with accessible DS charts; event observations lead
to source text, clocks, full quantities and archived snapshots. Historical snapshot
links retain revision identity and offer a separate current-record link.

## Review locally

Run `pnpm install --frozen-lockfile`, then `pnpm dev --host 127.0.0.1 --port 8183`.
The handoff stops the owned test server; no hosting registration or deployment.

- Crossing: <http://127.0.0.1:8183/?place=ebbetts-pass>
- Road evidence: <http://127.0.0.1:8183/?place=ebbetts-pass&chapter=passage&collection=map:road_segment>
- Burn authorities: <http://127.0.0.1:8183/?place=ebbetts-pass&chapter=burn>
- Historical evacuation snapshots: <http://127.0.0.1:8183/?place=all&chapter=ground&collection=EVACUATION&history=history&from=2026-10-01&to=2026-11-08>
- Regional radio reading: <http://127.0.0.1:8183/?place=all&chapter=signals&collection=MESH>
- Source health and access limits: <http://127.0.0.1:8183/?chapter=sources>

Desktop, narrow and forecast-detail runtime captures are in `artifacts/desktop.png`,
`artifacts/narrow.png` and `artifacts/deep.png`. Screenshots are actual live reads;
they are not application datasets or fallback content. Inspected all three for
layout, reading order, overflow and chart legibility.

## Validation

`make verify` passes: deterministic transport test, Astro/TypeScript check with
zero diagnostics, static build. Four live browser tests pass. No live request is made at build time.

`pnpm test:browser` is explicitly separate live verification. It exercises actual
weather-to-forecast exploration, place/slider keyboard interaction, back/URL restore,
current event revision loading, global historical snapshot selection and reload,
multiple non-mesh domains, bounded radio pagination and monitor archive, and blocked-
network failure messaging. Axe checks include `wcag2a`, `wcag2aa`, `wcag21a`,
`wcag21aa` on desktop, narrow and an evidence dialog. Narrow overflow is asserted.
No observation responses are mocked; the only request interception aborts the API.
Live results are time/availability-dependent, checked on 2026-11-08 UTC.

SDK 0.1.1 and DS 0.5.1 are consumed unchanged. Manifest and lockfile match the frozen
foundation. DS supplies global typography/tokens, logo, buttons and time-series
rendering with accessible data tables. Formatting used a temporary pinned formatter;
no dependency input changed.

## Limits and tradeoffs

See `COVERAGE.md` for category/field mapping and unexposed data. Public observations
remain live-only; requests are cached within a visit and local view time is labeled
as such. Reload for fresh retrieval. Source health, observed time and fetched time
remain distinct. Automatic global-list restoration is bounded to ten pages with a visible notice;
manual continuation stays available. Per-event history keeps explicit
20-revision continuation available while a token remains. Nothing auto-crawls history;
later-page failures retain earlier successful results. Loaded event page depth is
URL state. No automatic polling or eager full-history crawl.

The geographic projections are inspectable structured feature/geometry records,
not a full interactive map. Complex secondary measurements are exposed in named
field groups rather than bespoke graphics for every schema. Telemetry charts battery
voltage; all exact counters, null gauges and monitor/storage clocks remain inspectable.
Unknown cadence isolates samples, known cadence breaks at 1.5×, and reboot metadata
is shown without erasing valid voltage observations. No counter rates are inferred.

There is no public history for weather, forecast vintages, road condition services,
signs or cameras. Raw mesh receptions/paths, daily topology buckets, private relay
operations and burn staging diagnostics are not exposed. This app does not infer
those datasets from storage internals. Source outage/empty/truncated/unmonitored
states never become all-clear claims. Source URLs and camera sources require HTTP(S).

Stored enhancement I/O is available through an explicitly on-demand advanced
attribution action with its own cache key. This reads the current record only,
labels absent I/O and does not run enrichment. Historical input/output is separately available through “Read revisions with stored
AI I/O”, preserving per-event continuation and bounded pages.

Coordinator coverage correction: per-event history no longer hides its continuation
action at 200 revisions. Each request is still user-initiated and bounded to 20 rows.
