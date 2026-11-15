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
| `/search/` | `search` | The one text search: best matches of every kind, or every matching report |
| `/scanners/`, `/sources/`, `/cameras/` | their own | Directories and health |

`src/pages/404.astro` is the not-found page: the same shell and sidebar, no
view module (`data-view="not-found"` tells `page.ts` to mount nothing and leave
the address as typed). The host must serve `404.html` for unknown paths.

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

**Text search has one place: the Search page.** The report browser filters by
type, status and importance and has no text box; a link to it that carries
`q` (from when it had one) is sent on to Search. Browsing a feed and looking
for a thing are different jobs, and two boxes with different reach were one
too many.

The Search page (`views/search.ts`, `finder-model.ts`, `search-model.ts`)
has two views of one box. Without `kind`, it asks `/api/v1/search` for the
best few hits of each kind Grid has a page for, scoped to the corridor, and
each hit leads to its page. With `kind=EVENT` or `kind=MESH_NODE` (the "All N
reports, newest first" link under a group) it lists every match of that kind
from `/api/v1/events` with `q`: every status, newest first, a page at a time,
with the service's total over all pages and an excerpt where the match is in
a report's own text. A report opens in Events.

Nothing is matched in the browser. The text is sent a quarter of a second
after typing pauses, with `qTyping` so the word being typed matches as a
prefix; the results on screen stay until the new answer lands, and an answer
to older text is dropped and its request cancelled. The models decide the
words: a count, what an empty result does and does not mean, and why a search
could not be answered (the service refuses with 503 while it rebuilds its
index, which is shown as an error and never as no results). A kind the
service could not search is named on the page, because its absence is unknown
and not none.

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
