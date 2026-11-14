# Grid architecture

Grid is an Astro static site. Every page reads the public API at
https://data.sierragridteam.org in the browser through `@sierragridteam/sdk`
(typed, Zod-validated) and is built from `@sierragridteam/design-system`.
There is no server of its own and no stored state beyond the URL and two
display preferences in `localStorage` (units and the chosen weather town).

## Pages and modules

`src/config/views.ts` maps each route to a module in `src/lib/views/`, loaded
on demand. `src/pages/[view].astro` and `index.astro` render the shell
(`src/layouts/ExplorerLayout.astro`); the module fills `#content`.

| Route | Module | Shape |
| --- | --- | --- |
| `/` | `overview` | Summary banner, tiles, weather, signs |
| `/events/`, `/burn/`, `/weather-notices/` | `events` → `event-browser.ts` | List and detail of reports |
| `/roads/` | `roads` | Answer, tiles, route strips, map, work schedule, signs, cameras |
| `/weather/` | `weather` | Answer, tiles, elevation profile, alert map, hourly grid, week |
| `/wildfires/`, `/power/` | `conditions` | Live when something is active; the season's record when not |
| `/mesh/` | `mesh` → `mesh-network` | Map, fleet dashboard, relay and gateways |
| `/scanners/`, `/sources/`, `/cameras/` | their own | Directories and health |

`/evacuations/` redirects to Wildfires (evacuations lead that page when in
effect) and `/history/` to Events with past reports included.

**Answer-first pages** (Roads, Weather, Wildfires, Power, Source health) share
one structure: `pageHero` with the conclusion as the title, a row of tiles, the
main picture (strip, profile or map), then a `.dashboard` of panels. What the
page concludes is computed in a pure module beside the view
(`road-corridor.ts`, `weather-model.ts`, `conditions-model.ts`,
`mesh-monitors.ts`, `report-profile.ts`) and unit-tested there; the view only
renders. A conclusion is never drawn from a failed request: a rejected or
stale source produces "unavailable", not "none".

## The report browser

`event-browser.ts` lists reports (one row per report; one per saved version in
history mode) beside the selected report (`event-detail.ts`). Lists are read
without shapes (`geometryFormat=NONE`); the open report fetches its own shape,
saved versions and related reports.

Selecting or closing a report pushes a history entry without a navigation, so
the list is not reloaded; Back and Forward go through the router, which mounts
the page again from the URL. On a phone the list leads and Back from an open
report returns to it. On desktop the first result opens beside the list.

`report-profile.ts` turns each report type into tiles, sections and a timeline
(a mesh node's monitor readings are dated, and a repeater read on schedule is
not called late). Reports of other types fall back to a generic view.

## Lifecycle

Static pages use Astro's `ClientRouter`. `page.ts` uses the design system's
`definePage` to mount each DOM root once and hands the module a `Context` with
an `AbortSignal`. Everything a module starts (requests, intervals, listeners,
store subscriptions, maps) is tied to that signal and stops before the next
page swaps in. Pages that refresh themselves say when in their own footnote
(`data-page-updated`); others get a "Loaded" line from the shell.

Slow or secondary data loads after the first paint and fills in: past records
and fire perimeters on Wildfires, the outage record on Power, the relay's
gateways on Mesh, a report's shape and related reports.

## URL state

`state.ts` parses and writes the query string; only values that differ from
the page's defaults are written, so a shared link reads as the view it opens.
The geography is always the Ebbetts Pass corridor. `?record=` selects a
report, `?status=`, `?layer=` and `?severity=` filter Events, and
`?weatherLocation=` chooses the town for the week's forecast.

`?preview=live` (Wildfires, Power) shows the live layout from the most recent
past records, marked "Test view, not live". It is honoured only in development
builds or when built with `PUBLIC_GRID_PREVIEW=1`.

## Design system

The design system owns fonts, tokens, the shell and sidebar, controls, cards,
tables, charts and the map (`createGeoMap`, with selection cards, per-feature
styling and cooperative zoom gestures). Grid's CSS (`src/styles/`) only
composes domain layouts; it does not set type sizes or override component
internals. A page-sized map's height is reserved before it loads.

Vite's dependency prebundling excludes the design system (`astro.config.mjs`)
so its MapLibre worker import is transformed normally.

## Data boundaries

- Source time, Grid's receipt time and source health are different things, and
  the pages keep them apart. A missing observation is not a clear condition.
- "This season" on Wildfires and Power is what Grid has on record, not a census.
- CAL FIRE incidents and FIRIS perimeters of one fire are joined by name.
- Chain control is shown as a stretch between Caltrans's checkpoints.
- Which gateway reached which mesh repeater is not published by the API.
- Camera coverage is supplemental; there is no Highway 4 camera in the catalogue.

## Checks

`make verify` runs the unit tests (`node --test tests/*.test.mjs`), `astro
check` and a production build. `pnpm test:browser` serves the build on port
8190 with Python and runs Playwright against the live API, including axe
accessibility checks and phone-width overflow checks.
