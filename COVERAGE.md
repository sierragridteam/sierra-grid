# Crossing public coverage

All requests use SDK 0.1.1 against the live public origin. Routes below are query
strings on `/`; `place=all` is the regional/unlocated shelf. A place can instead
be any directory slug. No fixed observation ids are needed to discover evidence.

| Public category | Discovery route | Evidence and depth |
| --- | --- | --- |
| Current weather | `?chapter=sky&collection=weather` | Location, condition, temperature/feels-like °C, humidity %, wind speed/direction, visibility, aggregate refresh; each location opens a detail reading. Zero/missing caveat explicit. |
| Hourly forecasts | Weather → follow hours | Joined by location id; issued time, source/grid, horizon, peak gust/time, minimum humidity; DS charts with accessible tables for temperature, humidity, wind, gust; structured periods retain direction and every value. Complete response exposes unmatched forecast locations too. |
| Issued fire weather | Sky → Fire weather | Region-wide issued state/headline/zones distinct from forecast information; complete conditions and geographic features expose provenance. |
| Wildfires | `?chapter=ground&collection=WILDFIRE` | Acres, containment, cause, county, perimeter, geometry, all envelope fields; current/all lifecycles and date-bounded revision archive. Source namespaces remain separate records. |
| Evacuations | Ground → Evacuations | Zone, level, event type, county, footprint, timing, source text and links. Reference-only notice. Historical snapshot selection preserved in URL. |
| Earthquakes | Ground → Earthquakes | Magnitude, depth km, felt reports, location/time; severity remains urgency. Empty archive stays explicit. |
| Weather alerts | Sky → Issued alerts | Original description, verbatim instructions, certainty/urgency/severity/zones/times; AI attribution preserved; revisions. |
| CHP / Caltrans work | Passage → Incidents & work | Incident metadata and full closure window/district/route/direction/facility/lane/delay/planned/setup/coordinate fields in contextual detail groups; lifecycle and revision archive. |
| Road segments | Passage → Road readings | Health metadata, current geometry, congestion, delay/duration/distance/status. Not treated as event ids or archived speed readings. |
| Chain controls | Passage → Chain controls | Level, highway, direction, description and geometry; metadata exposed before empty-state interpretation. |
| Message signs | Passage → Message signs | Sign id, service state, route/direction, pages and blank lines preserved in structured fields; no invented history. |
| Cameras | Passage → Cameras | Source health, directory metadata, image on intent, returned image/HLS URLs as user-initiated links; place, coordinates, elevation, distance, refresh. No autoplay or footage archive. |
| Power / PSPS | `?chapter=power` | Outage cause/customers/crew/restoration and PSPS stage/time slice/medical-baseline/deenergization/all-clear/geometry; estimates clearly distinguished from status; revisions. |
| Burn decisions | `?chapter=burn` | Combined permission plus separate daily/seasonal authorities, timestamps, land class, every phone line/number/answer and latest machine transcript/confidence/call; historical revisions and same-answer limitations. |
| Radio nodes | `?chapter=signals&collection=MESH` | Identity/role/reachability, geometry, gateway observers, SNR/RSSI/hops, advert/heard/relay clocks, all nullable monitor gauges and exact string counters. |
| Monitor archive | Radio observation → Read monitor archive | Default 24h; editable UTC bounds up to 400 days. Coverage, cadence, reboot markers, truncation, measurement/storage clocks; DS battery chart with gaps and exact sample detail. No unsafe counter conversion or inferred rates. |
| Mesh links | Signals → Observed links | 72h/30d/400d regional windows; both endpoints link to node evidence; observations/days/first/last/best SNR retained. Not RF coverage or historical topology. |
| Scanner references | Signals → Scanner references | Configured agency/channel/feed id and user-initiated Broadcastify link; no asserted stream health. |
| Source registry | `?chapter=sources&collection=sources` | Kind, attribution, homepage, polling/stale/expiry policy, success/attempt/error/status. Reporter semantics explicit. |
| Places and resolution | Sources & scope → Place directory | All kinds, ids, slugs, parent ids, geometry; address resolver and structured results; select place from any record. |
| Place rollups | Sources & scope → Place rollup | Mode, counts/severity/top hazards, nullable evacuation count and authority, every domain/source sidecar. Main live connection contrasts hazard posture and roads severity. |
| All map projections | Sources & scope → Geographic evidence | All 13 API layers; nested geometry/property/metadata records, no omitted fields. Supports inspection, not a full interactive cartographic view. |
| Stored AI I/O | Event → Advanced attribution → Read stored AI input/output | Explicit on-demand `enhancementIo: true`, separate cache key, current-record revision and absent I/O labeled. No model call or write. Archived I/O is available via Read revisions with stored AI I/O, with explicit continuation. |
| Event provenance/relationships | Any event → evidence | Stable id, source attribution/URLs, place ids, geometry/bbox/centroid, effective/expiry/observation/storage/fetch clocks, revision, enhancement model/time/fields. Supplemental full structured record. |
| Global/per-event history | Every event collection → revision archive; event → revision history | Date bounds only on global history. Current attachments caveat. User-driven continuation tokens; 30 events/page or 20 per-event revisions/page, ten-page visit limit. Global archive URL retains selected snapshot and loaded-page count. |

## Public access limits

No public continuous gauge/air-quality/announcement dataset; reserved layer names
are not data. No weather/forecast-vintage/road/sign/camera archive. No raw mesh
receptions, packet paths, daily topology buckets, operational relay state/private
traffic, subscriptions, or separate burn staging/same-answer transcript archive.
These appear in Sources & scope → Access limits rather than invented interfaces.

## Presentation limits

Structured named field groups supplement domain narratives and dedicated forecast,
burn, event-clock and telemetry presentations. Geometry is inspectable, not plotted
on a map. No computed routes, cross-source entity merging, inferred causation,
traffic forecasts, counter rates, or automatic polling. History coverage before the
service existed is unknown. Pagination can stop at ten pages and states that bound.
