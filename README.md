# S.I.E.R.R.A Grid

The public data explorer for the Ebbetts Pass corridor: roads, weather, wildfires, power, the SIERRA mesh network and every report behind them. A static [Astro](https://astro.build) site that reads the public Grid API at https://data.sierragridteam.org through [`@sierragridteam/sdk`](https://www.npmjs.com/package/@sierragridteam/sdk) and is built from [`@sierragridteam/design-system`](https://www.npmjs.com/package/@sierragridteam/design-system). It is intended for grid.sierragridteam.org.

## Pages

| Page | What it answers |
| --- | --- |
| Overview | What is active in the corridor right now |
| Events | Every report, filterable, with its source text, map, timeline and saved versions |
| Mesh | The mesh network: nodes, links, fleet health, and the relay's gateways |
| Roads | What is open or closed, chain controls, work, signs and cameras |
| Weather | Alerts, the snow level against the Hwy 4 towns, 48 hours and the week ahead |
| Wildfires, Power | What is active now; the season's record when nothing is |
| Burn day | Today's burn status by county (an Events filter) |
| Scanner feeds, Source health | Radio feeds to listen to; whether each data source is current |

## Develop

Needs Node 26.13 or later and pnpm 12.

```sh
pnpm install --frozen-lockfile
pnpm dev            # http://localhost:8182
make verify         # unit tests, type check, production build
pnpm test:browser   # Playwright against the build; needs Python 3 and Playwright's Chromium
```

There are no credentials and no demo data: every page reads the live public API, and the browser tests do too, so a test can fail when a source is briefly unavailable.

`?preview=live` on Wildfires and Power shows the layout for an active fire, evacuation or shutoff using the most recent past records. It exists for testing, is marked "Test view, not live" on the page, and is only available in development builds or when the site is built with `PUBLIC_GRID_PREVIEW=1`.

See [docs/architecture.md](docs/architecture.md) for how the pages are put together.

## Third parties at run time

The browser talks to the Grid API, to `tiles.openfreemap.org` for the base map (OpenStreetMap data), and loads road camera stills from Caltrans. Scanner links open Broadcastify. Data comes from Caltrans, CHP, CAL FIRE, FIRIS, Cal OES, the National Weather Service, PG&E, county burn lines and the MeshCore community mesh; each page names its sources.

## License

All rights reserved. The source is public for transparency; that is not a license to reuse it.
