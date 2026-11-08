# Public evidence coverage

All runtime data calls use published SDK 0.1.1 with the explicit live origin `https://data.sierragridteam.org`. No dataset is copied into the application. A route below starts from the root URL; subjects are also linked from each collection. The selected time lens and place remain in query parameters.

## Event families

Every event family supports `?topic=FAMILY&tense=now` (ACTIVE + SCHEDULED), `tense=ahead` (SCHEDULED), and `tense=recorded` (explicit date-window revisions). Select a row for full evidence. Empty results retain a path to other lenses and source health.

| Family | Context and meaningful fields |
| --- | --- |
| WILDFIRE | Acres, containment percent, county, cause, perimeter flag, geometry and source namespace. Independent source records are not merged. |
| EVACUATION | Zone id, level, event type, county, verbatim original text, effective time, geometry and authoritative source link. Reference-only context; missing is not all-clear. |
| WEATHER_ALERT | Original NWS event, severity, certainty, urgency, zones, area, instructions verbatim, timing; source-provided summary and enhancement labels. |
| EARTHQUAKE | Magnitude, depth km, felt reports, location, source time and USGS link. Magnitude is distinguished from response severity. |
| ROAD_INCIDENT | CHP log and metadata; Caltrans window/district/closure ids, route, direction, facility, closure/work type, lane counts, delays, duration, start/end labels and coordinates, planned and actual timing, indefinite flag. Planned ends are not outcomes. |
| POWER | Outage/PSPS identifiers, cause, affected customers, crew, restoration estimates; PSPS stage, medical-baseline count, de-energization interval and planned all-clear. Missing-count zero caveat. |
| BURN_STATUS | Daily air-district decision, CAL FIRE seasonal status, combined permission, effective/observed times and land class; all phone-line identifiers/names/phones, latest answer/message/transcript/confidence/call time. Same-answer updates need not create revisions. |
| MESH | Public key, name/role, location, reachability, RSSI/SNR/hops/gateway observers, advert/device clock, last-heard/relayed clocks, optional admin measurements. No RF-coverage claim. |

All event evidence sheets include id, category/layer, severity, lifecycle, headline/summary/description, area, canonical URL, geometry/bbox/centroid, attached place identifiers, effective/expires/observed/ingested clocks, revision and provenance. Structured nested ledgers preserve every returned field and decimal-string counter. Blank, null and zero are distinct.

`Read revision history` explicitly follows continuation tokens. Older successful pages remain when a later request fails. Event/archive collection depth (`pages`) and per-event history depth (`historyPages`) are URL-backed and restored on back/reload. Automatic restoration stops after ten pages with an explicit remaining-depth notice; manual next-page access continues. Direct `id=…&revision=…` links resolve the requested historical snapshot before rendering; lookup is bounded to five 100-row pages. An unresolved older snapshot is labeled incomplete, without substituting current evidence; the current record’s manual paged history remains available.

`Read stored AI audit trail` calls `getEvent` with `enhancementIo:true` only on intent. `Read stored historical AI audit trail`, and each loaded revision’s I/O button, call `getEventHistory` with `enhancementIo:true` and a separate cache key. Historical lookup is bounded to five pages. Model, enhancement time, fields, stored incident prompt and raw response are shown when supplied. Empty I/O is explicitly reported; no enrichment is run.

## Conditions, forecasts, reference and relations

| Public surface | Route | Field coverage / time boundary |
| --- | --- | --- |
| Current weather | `?topic=weather&tense=now` | Every returned location, id/name, condition/group/icon, °C temperature/feels-like, humidity %, wind km/h/direction, visibility km; aggregate refresh time. Zero may be upstream missing. |
| Forecast | `?topic=weather&tense=ahead` | Location join, source grid, issued time, horizon, all hourly times/temperature/humidity/wind/gust/direction, peak gust/time and minimum humidity. DS temperature chart plus accessible table and complete period ledger. No past forecast vintages. Ahead landing selects the highest positive gust only among remaining future hourly periods. |
| Issued fire weather | Weather evidence, or `?topic=roads&layer=fire_weather` | Region-wide state/headline/zones and geographic forecast points; forecast conditions do not become issued warnings. |
| Road segments | `?topic=roads&layer=road_segment` | Route geometry, road id, status, congestion/delay/duration/distance when present; response health and source metadata. |
| Chain controls | `?topic=roads&layer=chain_control` | Caltrans level, highway, direction, text/closures and geometry. Empty and unavailable remain distinct. |
| Message signs | `?topic=roads&layer=message_sign` | District/sign/route/direction, in-service state, blank/unknown/message class, both pages and empty lines, geometry. |
| All geographic layers | `?topic=roads&layer=…` | All 13 SDK layer choices: road_incident, chain_control, road_segment, message_sign, weather_alert, fire_weather, earthquake, wildfire, evacuation, power, mesh_node, mesh_link, camera. All feature envelope/detail/geometry and response metadata are disclosed. Stored-event projections link to full event evidence; condition ids are never sent to getEvent. Geometry is structured coordinates, not an interactive map. |
| Cameras | `?topic=cameras` | Name/id, route/direction/county/place, position/elevation, distance, description, refresh cadence, upstream image/HLS links, directory attribution and health. Explicit links only; no autoplay or footage archive. |
| Scanner references | `?topic=scanners` | Every returned configured feed id, agency, label and listening URL, directory fields. Not audio health, recordings or transcripts. |
| Places | `?topic=places` | Full directory, selected identity/kind/slug/parent/geometry, area selection and US-address resolution. Town/corridor/area distinctions and coverage limits are explained. Coordinate resolution is supported by the SDK but not separately exposed in this UI; addresses reach the same place records. |
| Place summary | Place page and Now landing | Generated time, mode, domain health/severity/count/headlines, complete hazard summary/top items/evacuation authority/count and sources sidecar. Condition links and event links are separate. Mode is not a proxy for road severity. |
| Source registry | `?topic=sources` | Feed/reporter identity, attribution/homepage, poll/stale/expire policy, attempt/success times, error and reported health. All fields disclosed. This is current registry state, not uptime history; the UI does not independently rewrite reported health from the local clock. |
| Observed mesh links | `?topic=links&window=72h` | Public-key endpoints with event links, observations, days active, best SNR dB, first/last seen, generated time and applied rolling window. 24/72/168-hour choices; no daily-series or historical-topology claim. |
| Admin measurement archive | Mesh event → `Read measurements` | Last 1/6/24/168-hour presets and explicit UTC from/to intervals up to 400 days, effective bounds, whole-archive coverage/count, median cadence, inferred reboots, truncation, reportedAt versus receivedAt, every sample and every exact gauge/counter. DS battery-voltage chart uses measurement time, null gaps and isolated points for unknown cadence. Other quantities remain in the structured sample ledger; no counter rates inferred. URL preserves evidence pane, presets and explicit bounds; older retained samples are reachable through the interval controls. |

## Public access limits

No public APIs expose historical current-weather series, road-condition history, sign history, camera footage, scanner recordings, prior forecast vintages, raw mesh reception/path-by-packet rows, per-day link buckets, burn staging diagnostics or every unchanged-answer daily call. Relay credentials/operations/private traffic, member information and subscription functionality are outside this public collection.

The UI does not infer these datasets from database tables. It does not promise global totals or archive coverage where the API provides none. All condition/reference surfaces explicitly remain current when entered from Recorded or Ahead. Historical node measurement coverage is shown from the dedicated archive response, not inferred from event revisions.
