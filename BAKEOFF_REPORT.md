# Following the evidence — proposal B

A question opens a live observation, which opens a more specific question. The opening regional observation is selected from the live summary, alongside a separate road-domain reading that makes the rollup's limits visible. Sky, journeys, land/fire, earth, power and signals have equal standing in a permanent compass. The complete index is one step away; nobody must complete a wizard.

The selected concept and alternatives are in [CONCEPT.md](CONCEPT.md). The full public field-group map and unavailable datasets are in [COVERAGE.md](COVERAGE.md).

## What works

- Branching inquiry, persistent browser-history trail, direct query URLs, place lenses and explicit refresh. Context restores on back navigation, including previously read event pages.
- Live opening evidence, location-to-forecast exploration with five chart quantities, and category-specific evidence panels explaining burn authorities, fire area/containment, quake magnitude/depth, outage counts/estimates and monitor reachability.
- Every event category, current/ended lifecycles, bounded revision archives, paged per-event snapshots and source/provenance/geometry detail. Continuation tokens determine completeness; later-page failure retains earlier rendered evidence.
- All condition projections, on-demand DS geometry previews, camera imagery on intent, scanner references, source ledger, place boundaries/address resolution and regional summary details.
- Radio observations lead to exact archived samples, nine nullable gauge charts, cadence/coverage/reboots and rolling observed links. No counter rates are invented. Nulls and gaps over 1.5× median cadence break chart lines; unknown cadence isolates distinct-time points with a 1 ms threshold.
- Stored enhancement prompt/response has an explicit advanced action using `enhancementIo: true` with a separate cache key. No enrichment, writes, polling, fixtures or demo transport.
- Shared DS logo, tokens/typography/styles, Button, GeoJSONMap and accessible time-series renderer/value tables. SDK 0.1.1 and DS 0.5.1 manifest/lockfile remain unchanged.

## Validation

Checked against the real public API on 2026-11-07 Pacific / 2026-11-08 UTC.

`make verify` passed: one deterministic transport test, Astro check with zero errors/warnings/hints, static production build. The build warns about a client chunk above 500 kB after the shared geometry/MapLibre component is included; this remains a performance improvement opportunity.

Live browser suite is separate from deterministic verification. Final four-test run passed in 19.9 seconds; the additional targeted stored-I/O test passed in 6.4 seconds:

1. Opening → sky → location → forecast metric; reload/back/deep-link restoration; desktop and 390 px screenshots; keyboard skip navigation; no page exceptions. Axe WCAG 2 A/AA and 2.1 A/AA (`wcag21a` included) found zero violations on the deep forecast and narrow opening.
2. Real road record → revision list → historical snapshot; live burn record and authority explanation.
3. Network blocking of the actual conditions request → unknown/error state → unblock → successful retry. No observation responses were fabricated.
4. Live road/chain/sign/fire-weather/camera/scanner/source/place/summary and empty event-category routes; DS geometry mounting; mesh continuation paging/back restoration; real telemetry archive; bounded road revision archive.
5. Advanced stored-I/O action makes an actual request containing `enhancementIo=true`, updates the deep URL, and explains absent stored content.

An earlier 30-day global road revision query exceeded the 20-second request deadline. Its unknown/retry presentation worked. The default was narrowed to seven days; the final bounded route succeeded. Tests record upstream unavailability explicitly if it recurs, rather than asserting fixed live counts. No test asserts that an empty hazard feed means safety.

Desktop, narrow and deep screenshots were visually inspected after the final layout changes. They are direct runtime captures, not populated fixtures: [desktop](artifacts/desktop.png), [narrow](artifacts/narrow.png), [forecast evidence](artifacts/deep.png).

## Review locally

Use the pinned Node/pnpm environment, then:

```sh
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 8184 --ignore-lock
```

Run `pnpm test:browser` separately while that server is available. No hosted site was registered, published or deployed. The owned preview server is stopped at handoff.

Useful review URLs:

- Opening inquiry: <http://127.0.0.1:8184/>
- All evidence: <http://127.0.0.1:8184/?view=index>
- Hourly forecast: <http://127.0.0.1:8184/?place=ebbetts-pass&view=weather&location=murphys&metric=windGustKmh>
- Burn decisions: <http://127.0.0.1:8184/?place=&view=BURN_STATUS>
- Current/planned road observations: <http://127.0.0.1:8184/?place=&view=ROAD_INCIDENT>
- Bounded road revisions: <http://127.0.0.1:8184/?place=&view=ROAD_INCIDENT&archive=1>
- Roadside messages: <http://127.0.0.1:8184/?place=ebbetts-pass&view=message_sign>
- Reported radio measurements: open an observation from <http://127.0.0.1:8184/?place=&view=MESH>, then “What did the monitor measure?”
- Source ledger: <http://127.0.0.1:8184/?view=sources>

## Honest limits

Fresh direct links to historical revisions use a bounded 200-revision lookup. Older snapshots reached through paging remain selectable in the visit cache, but a fresh direct URL beyond that bound reports the limit. Global archive requests can time out. The application does not silently substitute empty data.

Current conditions/forecasts/cameras have no public historical archive. Raw mesh receptions/path traces, daily topology buckets, burn staging diagnostics and private relay operations are unavailable. Some event categories are currently empty; their ended records and bounded histories remain reachable. See coverage for precise distinctions.

The structured detail layer exposes all returned fields, while tailored panels explain primary domain facts. It is intentionally less bespoke for rare secondary fields. There is no side-by-side revision diff, forecast-vintage archive or inferred counter-rate analysis. Camera HLS and scanner listening are provider links, not embedded players; remote imagery can fail independently of directory health. Address resolution and every external media provider were not exhaustively browser-tested. The screenshot evidence does not claim they were.

## Independent-review coverage correction

Forecast discovery now includes forecast locations absent from `weather[]`. Those choices explicitly say no current weather was returned, show only the actual forecast issuance/source/horizon, and open the existing full forecast detail. `make verify` passed again, and a targeted real-API browser test verified that every returned forecast location has exactly one discovery route. The test checks the missing-current label if that situation occurs in the live response; no synthetic response was introduced to force it.
