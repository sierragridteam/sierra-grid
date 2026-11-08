# Public evidence coverage

All routes use runtime SDK 0.1.1 GET requests to `https://data.sierragridteam.org`. Open with `?place=ebbetts-pass`; `place=` deliberately means all available places. The compass exposes six inquiries, and `?view=index` exposes every collection without a question sequence. References below are query routes on the local preview origin.

| Public category | Entry and depth | Meaningful fields available |
| --- | --- | --- |
| Current weather | `?view=weather`, select a location | Condition/description, temperature and feels-like °C, humidity %, wind km/h and direction, visibility km, icon identifier, location ID/name, aggregate refresh time. |
| Hourly forecasts | `?view=weather&location=arnold` | Source/grid, issuance, horizon, peak gust/time, minimum humidity; five selectable DS chart quantities and accessible period tables. Full periods in structured disclosure. Metric and location are URL state. Forecast-only locations remain discoverable with an explicit missing-current-weather label. |
| Issued fire weather | Weather footer and `?view=fire_weather` | Region-wide issued state/headline/zones, separate from forecast; map metadata and every feature/property/geometry. |
| Wildfires | `?view=WILDFIRE` → observation | Acres, containment with zero/unknown caveat, county, cause, perimeter flag and geometry; all source-specific records remain separate. |
| Evacuations | `?view=EVACUATION` → observation | Zone ID, level, county/type, source instructions, geometry, lifecycle/effective times; Genasys reference link. |
| Weather alerts | `?view=WEATHER_ALERT` → observation | NWS severity/certainty/urgency, zones/area, original instructions verbatim, timing and source enhancement attribution. |
| Earthquakes | `?view=EARTHQUAKE` → observation | Magnitude, depth km, felt reports, source time/location/URL; magnitude distinguished from severity. |
| Road incidents and planned work | `?view=ROAD_INCIDENT` → observation | CHP log/impact/duration/metadata and Caltrans closure/window/district/log identifiers, route/direction/facility/work type, lane counts/delay/duration, planned/effective times, indefinite flag, setup, endpoints/coordinates. |
| Power and PSPS | `?view=POWER` → observation | Lifecycle, cause, customers (zero means no count supplied), crew/restoration estimate; PSPS stage/event/time period, medical baseline count, de-energization/all-clear estimates and footprint. |
| Burn status | `?view=BURN_STATUS` → observation | Two-authority evidence panel, county answer, CAL FIRE status/effective/observed times/land class, combined permission; every burn line and latest phone answer/transcript/confidence/call time in named nested disclosure. Same-answer refresh is not revision history. |
| Radio observations | `?view=MESH` → observation | Identity/key/name/role, admin reachability, location; all signal/activity/gateway/advert clocks and latest nullable admin measurements. Unmonitored does not mean offline. |
| Event common evidence | Every observation | Stable ID, category, headline/summary/description, severity/status, revision, effective/expires/observed/ingested times, source/fetched/attribution/URL, place attachments, geometry/bounds/centroid. DS geometry preview on intent. |
| Event revisions | Category “revision archive” or record “What changed?” | Bounded global observation-time archive (editable UTC bounds; seven-day default), per-event history with continuation tokens, full snapshot detail. Current vs snapshot labels. Paging state survives back navigation in a visit; previously read snapshots remain selectable. |
| Enhancement stored I/O | Record → Enhancement attribution → “Read stored enhancement prompt & response” | Explicit `enhancementIo: true` request with separate cache key; model/time/fields plus stored prompt/response if returned. Historical snapshot lookup requests historical I/O when selected. Never runs enrichment. |
| Road conditions | `?view=road_segment` | Route geometry, ID/headline/status, congestion, nullable delay/duration/distance, source metadata. |
| Chain controls | `?view=chain_control` | Caltrans levels/highway/direction, text/closures, checkpoint/segment geometry and health. |
| Message signs | `?view=message_sign` | District/sign/route/direction/service/category and exact page arrays/empty line positions in structured response; source and geometry. |
| Cameras | `?view=cameras` | Name/ID/place/county/route/direction, location/elevation/distance, image/stream URLs and refresh. Images load only on request; upstream image failures explicit. Directory health separate from unknown image capture time. |
| Scanners | `?view=scanners` | Every configured feed ID/label/agency/listening URL. No autoplay; no invented audio health. |
| Observed mesh links | `?view=links` | User-selectable 24h–400-day aggregate windows; endpoint search, both key-to-event routes, observations/days/first/last/best SNR. Display paging reports shown/returned count. Not RF coverage or historical topology. |
| Mesh measurement archive | Radio → “What did the monitor measure?” | Bounded UTC window, whole archive coverage/count, actual bounds, truncation, median cadence/reboots. Nine nullable gauge charts; every sample/counter/reporter/reported/storage field readable. Counters stay exact strings. No rates inferred. |
| Places | `?view=places` | Every ID/kind/name/slug/parent, geometry/bounds/centroid; set any lens; US address resolution results. No address persistence. |
| Summary | `?view=summary` | Mode and its exclusions, domains/counts/severity/health/headlines, top hazards, evacuation count/authority/health, generated time and source sidecar. All-place mode explicitly falls back to Ebbetts for this place-only surface. |
| Source registry | `?view=sources` | Feed/reporter kind, attribution/homepage, poll/stale/expiry policies, attempt/success/error/status. Event source fallback points into the ledger. |
| All 13 map projections | Index → geographic projections → `?view=map&layer=…` | road_incident, chain_control, road_segment, message_sign, weather_alert, fire_weather, earthquake, wildfire, evacuation, power, mesh_node, mesh_link, camera. Every feature/property, source metadata, exact geometry and on-demand shared DS preview. |

## Limits and deliberately absent data

Current weather, road conditions, forecasts and cameras have no public archive here. Raw radio receptions/packet paths, daily topology buckets, burn staging receive diagnostics, private relay records and operational credentials are unexposed. Reserved gauge/air-quality/announcement event enums are not datasets. No subscription backend is implied. A source-health snapshot is not uptime history.

Per-event revision paging can reach the retained archive. A fresh direct link to a revision requires a bounded lookup of at most 200 revisions; older snapshots already read during a visit remain selectable from memory. This direct-link limitation is explicit on failure. Global archive availability varies; broad queries can exceed the SDK 20-second deadline. Source failures remain unknown, not empty or safe.

Telemetry chart policy: break at nulls and gaps greater than 1.5 times the reported median cadence; when cadence is unavailable, use a 1 ms maximum gap to isolate distinct-time points. Reboot timestamps are separately exposed; counters are never charted as rates. Exact stored readings remain available regardless of chart omission of missing measurement times.
