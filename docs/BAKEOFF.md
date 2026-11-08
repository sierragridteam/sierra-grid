# Sierra Grid — live data storytelling competition

You are one of three agents in a clean-room design competition. Build an original
product concept, not a conventional dashboard assembled from familiar widgets.
Work only in your assigned worktree/branch. Do not inspect other entrants or previous
rounds: no candidate branches, PRs, screenshots, private evaluation notes or code.
All entrants receive this identical brief, inventory, package versions and starter.

## The experience

Build Sierra Grid, a standalone website for exploring and understanding everything
SIERRA observes across Calaveras and the surrounding region. Its eventual home is
`grid.sierragridteam.org`.

Make the data tell a story about this place: what is happening, what has changed,
how observations connect, and what deserves closer attention. Visitors should
discover interesting things before they know what to search for. From those
discoveries, they should be able to follow their curiosity all the way down to
individual observations, measurements, history and provenance.

It should feel like exploring a living place—not reading a spreadsheet, navigating
a database, or studying an API. Tables and maps can support the experience, but
must not determine its structure. Choose your own organizing concept, navigation,
visual hierarchy and interactions. No prescribed homepage layout, node list, map,
cards or dashboard structure. Aim for a distinctive, compelling experience.

Serve deeply curious, technically capable people without requiring knowledge of our
storage schema. Provide compelling entry points and deep exploration. A story must
lead somewhere: users should be able to inspect its evidence and pursue a question.

## Scope: every kind of data

Explore the full breadth of data stored by sierra-data. Mesh is one part of that
world, not the organizing principle for the entire site. Read DATA_INVENTORY.md,
the SDK contract and real API responses before designing. Inventory every data
category, meaningful field, relationship and historical depth. Identify stored data
not exposed by the public API; report those gaps rather than inventing access.

Every publicly accessible datum should have a discoverable route into the
experience. Use progressive disclosure so breadth does not overwhelm visitors.
Technical detail belongs where it explains evidence, not in the primary navigation.
A generic JSON viewer alone does not satisfy deep exploration. Explain quantities,
units, time and provenance in context; structured raw detail may supplement that.
No token non-mesh card attached to an otherwise mesh-only product.

## Real evidence only

**The live API origin is https://data.sierragridteam.org. Use it explicitly.**
Use the published `@sierragridteam/sdk` for all data API requests. The shared
`src/lib/client.ts` creates that live client. No localhost backend, fixture transport,
demo mode, synthetic observations, fabricated trends, hardcoded observations, cached
showcase datasets, or fallback-to-fake behavior. Fetch live data at runtime, not build
time. Public camera imagery and official source links may use returned upstream URLs.
Do not autoplay scanner streams or make paid/enrichment/write requests.

Headlines, comparisons and conclusions must be supported by observations. Show
relevant time, source and uncertainty. Distinguish missing data from zero, stale
observations from current conditions, and correlation from causation. Sparse history,
an unavailable feed or an empty category must remain understandable and explorable.
Data telling a story means revealing evidence through thoughtful selection,
sequencing and interaction—not inventing confident explanations. Do not call an LLM
or invent narrative observations. Preserve source-provided AI labels and verbatim
life-safety directives; evacuation information is reference-only with official links.

## Shared foundations and correct semantics

Use pnpm 12.18.0, Node 26.13.0+, Astro, TypeScript and the committed lockfile.
Use `@sierragridteam/design-system` for typography, tokens, logos, controls, maps,
tables and time-series charts. Read package exports and docs. Do not vendor or fork
shared packages or privately upgrade dependencies. Report blocking SDK/DS needs to
root so necessary fixes reach everyone; record optional shared needs in your report.
Generic reusable components belong in DS in the eventual consolidation; product-
specific story composition belongs in Grid. Do not copy existing website layouts.

- Use endpoint-supported parameters only. Per-event revision history does not accept
  date bounds; bounded global history does. Snapshots are not periodic measurements.
- Measurement time (`reading.reportedAt`) and storage time (`receivedAt`) differ.
  Derive measurement rates using the measurement clock and declared reboot/cadence
  metadata; preserve nulls, resets and gaps. Avoid unsafe int64 numeric conversion.
- Follow continuation tokens, not page length. Bound request volume; retain earlier
  successful pages on later failure and keep completeness visible through navigation.
- Never turn unavailable, empty, stale, unmonitored or truncated into an all-clear.
  Keep authoritative source health separate from local retrieval age.
- Observed mesh links are not RF coverage or complete topology. Current rolling links
  are not historical topology. Radio activity is not event revision time.
- Avoid eager full-history crawls, unlimited parallel fan-out or automatic polling.
  Load detail on intent, share/cache bounded requests within a visit, expose truncation.
- No credentials or private member information. Do not commit copied live API datasets.

## Working evidence and evaluation

Support narrow and desktop screens, keyboard use, legible units/times, loading,
retry and failed/partial states. Visualizations need accessible alternatives. Preserve
useful exploration context in URLs and back navigation. No production deployment.

Run `make verify`. Add browser tests that exercise actual discovery-to-evidence
interactions and URL restoration, not just page loading. Live tests use real API data,
assert structural behavior rather than fixed counts/headlines and report time/availability.
Separate them from deterministic CI so live outages are not mistaken for code failures.
Fault injection may block a request to test honest failures but must not fabricate
observations. Pure helper tests need not access the network. No synthetic dataset
or test transport may appear in the application. Include axe WCAG 2/2.1 A/AA tags,
including `wcag21a`, and narrow layout/keyboard checks.

Deliver BAKEOFF_REPORT.md explaining your organizing concept and strongest features,
what works, tests/results, reproducible review URLs, and honest limitations. Include
COVERAGE.md mapping each public category and meaningful field group to a user route,
with unexposed/missing data clearly marked. Include real runtime screenshots in
artifacts/ (desktop, narrow, deep exploration); never fabricate populated states.
Commit on your assigned branch; do not merge/deploy. Root compares all three.

| Evaluation dimension | Weight |
| --- | ---: |
| Breadth and discoverability of available data | 25 |
| Originality and coherence of the organizing concept | 20 |
| Evidence-backed storytelling and depth of exploration | 25 |
| Time, provenance, uncertainty and completeness | 10 |
| Visual craft, accessibility and responsiveness | 15 |
| Technical quality and shared-library reuse | 5 |

Coverage without a compelling experience is not enough. A beautiful concept that
hides most of the data is not enough. Evaluate working behavior, not promised features.
