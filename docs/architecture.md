# Grid architecture

Grid is an Astro static site. Every page reads the public API at
https://data.sierragridteam.org in the browser through `@sierragridteam/sdk`
(typed, Zod-validated) and is built from `@sierragridteam/design-system`.
There is no server of its own and no stored state beyond the URL and two
display preferences in `localStorage` (units and the chosen weather town).

The build reads the same API once, for what is prerendered: the record each
page shows before any script runs, and the page of each notable report (see
"Without JavaScript" below). Nothing prerendered says how things are now.

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

`src/pages/events/[record].astro` is the page of one report
(`/events/<slug>/`): static like the 404 (`data-view="record"`, no module
mounts, the address stays as typed) and marked under Events in the sidebar.
`robots.txt`, `llms.txt` and `sitemap.xml` are endpoints in `src/pages/`.

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
has three views of one box. Without `kind`, it asks `/api/v1/search` for the
best few hits of each kind Grid has a page for, scoped to the corridor, and
each hit leads to its page. With `kind=EVENT` or `kind=MESH_NODE` (the "All N
reports, newest first" link under a group) it lists every match of that kind
from `/api/v1/events` with `q`: every status, newest first, a page at a time,
with the service's total over all pages and an excerpt where the match is in
a report's own text. A report opens in Events.

`kind=REVISIONS` ("Search in revision history", offered under any answer,
including an empty one) searches every stored revision of every report, so
it finds wording a source has since changed. It asks `/api/v1/history` with
`q` and `collapse=event`: one row per report, saying which revisions matched
(first, last, how many), latest match first. A row opens the report in Events
at its first matching revision. The revisions view on Events itself has no text box.

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

## What Grid has on record

Some reports are the standing state of a tracked thing, which the API revises
when it changes: a monitored road (`ROAD_SEGMENT`), a county's burn answer
(`BURN_STATUS`), an upstream feed's health (`SOURCE_HEALTH`, in no place), a
mesh node. Others are something happening (an incident, an alert, a chain
requirement). The API says which with `nature` (`STATE` or `OCCURRENCE`), and
Grid keeps no list of its own: `isOccurrence` in `event-model.ts` reads it and
falls back to "everything but mesh nodes" only for an API that predates the
field. The Overview counts occurrences. Events lists every report, and its
count line says how the total divides ("32 reports · 26 events and 6 standing
status reports (road status, burn day)"), so the two do not disagree.

`record-model.ts` reads revisions into what happened. Source health lists each
feed's status changes and since when it has held its status; Roads lists chain
requirements posted, changed and lifted, and roads closing and reopening and
going under chains and coming out, over the last week. It decides every word of those panels, including each entry's
badge (label and tone, in the page's own vocabulary). The rules:

- A read of the record is not read yet, failed, or answered (`Read`). No panel
  while it is not read; a panel that says the record could not be read when it
  failed; "no uptime history is kept" only when both reads answered and held
  nothing. A failed refresh keeps the last list with "could not be refreshed;
  as of …", and drops every "since" that came from the failed read.
- An entry says what changed only when the revision before it is loaded.
  Without it, it says the state ("R2 in effect") and claims no change. A
  chain-control event is a slot per highway and level, so "posted again" is an
  ordinary entry.
- A road under chains is open. Its record (`roadSegment.chains` on the road's
  event, since 2026-11-19) names the requirement beside the status, and Roads
  words it by the highest level (`roadChainLevel`): "Hwy 4 Arnold to Bear
  Valley: chains required (R2)", "chains now R1", "chains lifted", with the
  badges "Chains R2" and "Chains lifted". The requirement's own entries ("R2
  posted · Hwy 4, Big Trees Park to Mount Reba Road") stay beside them: they
  say how far it runs, the road's say which monitored road is under it, and a
  stretch that grows onto the next road has only the road's entry. A revision
  that changes status and chains is two entries. The road's report shows a
  "Chains" figure only while a requirement is on record. Revisions from
  before the API recorded chains (`ROAD_CHAINS_ON_RECORD_FROM`, 2026-11-19
  22:00Z) list none whatever the road was under, so for them chains are not
  known: the first revision after is not an entry and not "was None", and a
  requirement held since then reads "for at least …, on record since Nov 19".
- A period is claimed only when recording covers it. Revision 1 of a standing
  state is where recording began: a health event never revised shows
  "recorded since", and a period that recording began inside is described as
  "since recording began on …", not "the last 30 days".
- The record is read up to `RECORD_PAGES` pages. If the service still has
  more, the panel says older entries are not loaded and gives no count.
- The record is read every ten minutes (`RECORD_REFRESH_MS`), apart from the
  live data. Its period is on whole hours so the request repeats, and the last
  ETag is sent so an unchanged answer is a 304 that changes nothing. (A
  browser can read the ETag only if the API exposes it across origins; where
  it does not, the repeated URL still lets the browser's own cache revalidate.)

A revision has a kind. A report's own history asks for both (`CHANGE` and
`READING`) and shows a reading as "checked; the answer did not change" with
the call it records (`readingCalls`: the burn lines whose call moved since the
revision before); lists of revisions elsewhere show changes only.

`reportProfile` is told whether the loaded revisions are the report's whole
history (`complete`: every page loaded, none pending or failed). A duration is
exact only when the revision where the state changed is loaded; otherwise it
is "at least" as long as the loaded revisions reach, or omitted. "First saved
by Grid" is shown only when revision 1 is loaded.

A development server can read another API (`PUBLIC_GRID_API_ORIGIN`, for a
sierra-data change that is not deployed). The switch is compiled out of a
production build.

## Without JavaScript

Search engines' and assistants' crawlers, link previews and an agent's fetch
mostly run no script, and used to get a heading and "Loading this view…".
What they get now is decided in two pure modules and one rule.

**The rule: prerendered text carries its own date.** A built page is read
hours or weeks later, so it never says how things are ("open", "none
active", "3 h ago"). It says what was saved and when ("closed Nov 17, 2026,
15:35 PT"), which stays true whenever it is read, and it says where the live
data is. `datedTime` (`time.ts`) always writes the year, which `regionalTime`
drops for the current one.

- `config/site.ts` gives each page its own title, description and the JSON
  it is drawn from. `seo-model.ts` turns that into the head (canonical
  address, `<link rel="alternate" type="application/json">` per resource,
  Open Graph), the structured data (the organisation and site on every page,
  a `Dataset` on pages that are a body of data, a `Report` on a report's
  page), and the three text files. A route that only sends its reader on
  (`/evacuations/`, `/history/`) and Search are `noindex`, and the first two
  give the address they land on as canonical. No licence is stated in the
  structured data because none has been chosen for the data.
- `build/snapshot.ts` makes the build's reads, once, shared by every page:
  about 250 requests, a few at a time. `prerender-model.ts` turns them into
  what each page says (`staticSections`) and into a report's page
  (`recordPage`), reusing the models the live views use (`roadRecord`,
  `sourceRecord`, `fires`, `evacuationEpisodes`, `readingCalls`,
  `reportProfile`'s timeline, `reportChanges`). The same guards apply: a list
  read up to a cap says "at least" and "not read", an empty record is "none
  on record", never "nothing happened", and a change is listed only when the
  revision before it was read.
- `StaticRecord.astro` renders that inside `#content` with a note naming the
  page's JSON. It is the page with scripting off (`@media (scripting:
  none)`); with scripting on it is not displayed, the page shows its loading
  state, and `page.ts` removes it when the live view mounts, so the two are
  never on screen together.

**Reports with a page of their own** are the ones `NOTABLE` names: every
wildfire, evacuation, weather alert and chain requirement, a power
interruption rated moderate or above, a road incident rated severe or above
(moderate is every planned lane closure). The page has the report's details,
its timeline and what changed at each saved revision, all dated, and links
to the live report (`/events/?status=all&record=<id>`, the link the explorer
itself writes) and the JSON. Its address is the id as a slug
(`cc:hwy4:r2` → `/events/cc-hwy4-r2/`); two ids that would share a slug fail
the build. A report that has not ended has its page, so it can be linked
from the start, but the page is `noindex`, is left out of the sitemap, and
says only that the report had not ended at its last saved revision.

A report keeps its page once it has one. An outage's severity falls as
customers come back, and a page that vanished when it dropped under the
threshold would break every link to it. Every build writes the ids of its
report pages to `/events/pages.json`; the next build reads that from the
published site and builds a page for any id the lists no longer return
(reading the report by id), dropping one only when the API no longer has
the report. A development server does not read the published list.

When a report began is the source's own time (`effective`) once that time
had come by the last saved revision, else when Grid first saved it, else
not said (`beganAt`). It is never the report's `observedAt`, which is its
newest revision's time: for an ended report, when it ended. The evacuation
list counts a zone at the highest level any saved revision gave it. Entries
the record models word for a live page ("now restricted", "R2 in effect")
are put in the past (`inPastTense`), and the source record leaves out each
feed's reason, which is upstream error text. A chain
requirement or an evacuation zone is a slot that can be issued again, which
is why even "ended" is worded as of a revision. The profile's tiles are not
used on these pages: they are written for a page rendered now.

**A build that cannot read a list fails**, and the site already published
stays up with its own dated record; publishing without the record would
delete every report's page. So does one whose lists answer but hold fewer
than half the reports already published (`plausible`), and one where more
than a tenth of the reports' revisions could not be read: both are the
service at fault, not news. One report's revisions failing is not that: its
page says they could not be read. A development server renders without the
record instead, so it starts offline. `.github/workflows/rebuild.yml` asks
Deploy to run every hour so the record stays current. It asks only when the
checks passed on the commit `main` is at (a dispatched Deploy runs no checks
of its own) and no Deploy run is queued or in progress (Deploy cancels a run
under way for a newer one, and a cancelled upload can leave pages pointing
at assets already removed). It is green once Deploy is asked, so it warns
when the last Deploy run failed. It is a file of its own because
`deploy.yml` is kept identical to sierra-website's.

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
- Chain control is shown as a stretch between Caltrans's checkpoints, and it
  never changes a road's status: an open section under chain control is open,
  in the open colour, with the requirement said beside it (the route's
  summary, the section's label, and a band beside the strip). On the map the
  stretch is a glacier casing under the route's line, cut from the monitored
  route's own geometry between the first and last checkpoint on it
  (`routeSlice`); nothing is drawn where there is no monitored line. A stretch
  whose next checkpoint lies past an end of the route runs to that end.
- Which stretch is on which section is the API's to say (`road.chains` on the
  road layer: a list, an empty list for none, absent for not known). A
  section's words come from that list; only when it is absent are they read
  from where the checkpoints lie. The band's extent is always the
  checkpoints': the API gives no distances along a road.
- A requirement a road lists that the chain-control layer gives no stretch
  for (the layer could not be read, or the two were read minutes apart) is
  still the page's answer: the title (in the API's headline for the
  stretch), the "Chain controls" figure, the section and the route's summary
  all say it (`chainsOnRoute`, `chainFigure`), and no band or casing is
  drawn, there being no checkpoints to place.
- A section's text is chosen to fit (`sectionLabels`, `fitLabel`,
  `labelRoom`): the strips' width is measured, and where a text with chains
  in it does not fit, the minutes go, then the status word, so the level is
  not what the component's ellipsis cuts. Across the page the room is the
  section's share of the strip; for the vertical strip it is an estimate of
  the corridor's label column.
- The band beside a route's strip is Grid's composition on the strip's scale;
  the design system's `corridor()` has no band of its own. Where the strip
  turns vertical (narrow screens) there is no shared axis, so no band is
  drawn there: the summary and the section's label carry the requirement.
- "No chains" is said only of a chain-control layer that was read and is
  current (`chainRead`). When the request failed or the source is behind, the
  strip draws what was last read and marks it, or draws nothing and says
  chain control is unavailable.
- Which gateway reached which mesh repeater is not published by the API.
- Camera coverage is supplemental; there is no Highway 4 camera in the catalogue.

## Checks

`make verify` runs the unit tests (`node --test tests/*.test.mjs`), `astro
check` and a production build. The build reads the live API (see "Without
JavaScript"), so it needs the network and fails when the API cannot be read.
`pnpm test:browser` serves the build on port 8190 with Python and runs
Playwright against the live API, including axe accessibility checks and
phone-width overflow checks; `seo.spec.ts` reads pages with JavaScript off.
