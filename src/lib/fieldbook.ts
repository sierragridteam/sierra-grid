import { createExplorerContext } from './client';
import { renderTimeSeries } from '@sierragridteam/design-system/lib/time-series-render';
import type { ApiResult, EventQuery, MapLayer, V1Event, V1Place } from '@sierragridteam/sdk';
const { client, now: visitNow } = createExplorerContext();
const pagesRead = new Map<string, {
    html: string;
    count: number;
    token: string | undefined;
}>();
const content = document.querySelector<HTMLElement>('#content')!;
const placeSelect = document.querySelector<HTMLSelectElement>('#place')!;
const compass = document.querySelector<HTMLElement>('#chapters')!;
type Row = Record<string, unknown>;
const domains = [
    { id: 'sky', name: 'Sky', question: 'What is the sky telling us?', intro: 'Read present weather, follow the next hours, then distinguish a forecast from an issued warning.', views: ['weather', 'WEATHER_ALERT', 'fire_weather'] },
    { id: 'journey', name: 'Journeys', question: 'What could change the journey?', intro: 'Follow a route from road conditions to planned work, roadside messages and an actual camera view.', views: ['road_segment', 'ROAD_INCIDENT', 'chain_control', 'message_sign', 'cameras'] },
    { id: 'land', name: 'Land & fire', question: 'What is happening on the land?', intro: 'Explore fire footprints, evacuation source records and the two authorities behind a burn decision.', views: ['WILDFIRE', 'EVACUATION', 'BURN_STATUS'] },
    { id: 'earth', name: 'Earth', question: 'What moved beneath us?', intro: 'Explore reported earthquakes and their revisions. Magnitude and response severity answer different questions.', views: ['EARTHQUAKE'] },
    { id: 'power', name: 'Power', question: 'Where is power interrupted?', intro: 'Follow outages and public-safety shutoffs. Estimated restoration and all-clear times are not proof power has returned.', views: ['POWER'] },
    { id: 'signals', name: 'Signals', question: 'What connects this place?', intro: 'Follow public radio observations into actual measurements and observed links, or find a regional scanner reference.', views: ['MESH', 'links', 'scanners'] },
];
const titles: Record<string, string> = { weather: 'Weather & hourly outlook', WEATHER_ALERT: 'Issued weather alerts', fire_weather: 'Issued fire weather', road_segment: 'Road conditions', ROAD_INCIDENT: 'Incidents & planned work', chain_control: 'Chain controls', message_sign: 'Roadside messages', cameras: 'Camera views', WILDFIRE: 'Fire observations', EVACUATION: 'Evacuation records', BURN_STATUS: 'Burn decisions', EARTHQUAKE: 'Earthquake observations', POWER: 'Outages & shutoffs', MESH: 'Radio observations', links: 'Observed radio links', scanners: 'Scanner references', sources: 'Source ledger', places: 'Places & boundaries', summary: 'Regional context', index: 'Complete evidence index', history: 'Revision archive', telemetry: 'Reported measurements', event: 'Source record' };
const mapLayers: MapLayer[] = ['road_incident', 'chain_control', 'road_segment', 'message_sign', 'weather_alert', 'fire_weather', 'earthquake', 'wildfire', 'evacuation', 'power', 'mesh_node', 'mesh_link', 'camera'];
const cache = new Map<string, unknown>();
const snapshots = new Map<string, V1Event>();
let serial = 0;
let places: V1Place[] = [];
let params = new URLSearchParams(location.search);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const human = (v: string) => v.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, s => s.toUpperCase());
const stamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) + ' Pacific' : String(v ?? 'Not reported');
const currentPlace = () => params.has('place') ? params.get('place')! : 'ebbetts-pass';
const view = () => params.get('view') || 'start';
function url(v: string, extra: Record<string, string | undefined> = {}) {
    const p = new URLSearchParams();
    p.set('place', currentPlace());
    if (v !== 'start')
        p.set('view', v);
    for (const [k, x] of Object.entries(extra))
        if (x !== undefined)
            p.set(k, x);
    return '?' + p;
}
const link = (label: string, v: string, extra: Record<string, string | undefined> = {}, cls = 'btn') => `<a class="${cls}" href="${esc(url(v, extra))}">${esc(label)} <span aria-hidden="true">↗</span></a>`;
const note = (s: string) => `<p class="note">${s}</p>`;
function heading(k: string, title: string, intro = '') {
    return `<p class="eyebrow">${esc(k)}</p><h1>${esc(title)}</h1>${intro ? `<p class="intro">${esc(intro)}</p>` : ''}`;
}
function safeUrl(value: unknown) {
    try {
        const u = new URL(String(value));
        return /^https?:$/.test(u.protocol) ? u.href : null;
    }
    catch {
        return null;
    }
}
const units: Record<string, string> = { temperatureCelsius: '°C', feelsLikeCelsius: '°C', temperatureC: '°C', humidityPercent: '%', humidity: '%', minHumidityPercent: '%', windSpeedKmh: 'km/h', windGustKmh: 'km/h', peakWindGustKmh: 'km/h', windDirectionDegrees: '° from north', visibilityKm: 'km', acres: 'acres', containment: '%', containmentPercent: '%', depthKm: 'km', batteryVolts: 'V', batteryPercent: '%', noiseFloorDbm: 'dBm', lastRssiDbm: 'dBm', lastSnrDb: 'dB', bestSnr: 'dB', pressure: 'hPa', distanceMeters: 'm', distanceKm: 'km', elevationFeet: 'ft', delayMinutes: 'min', durationMinutes: 'min', uptimeSeconds: 'seconds', airtimeMs: 'ms', rxAirtimeMs: 'ms', cadenceSeconds: 'seconds', imageRefreshMinutes: 'min' };
function value(v: unknown, k = ''): string {
    if (v === null || v === undefined || v === '')
        return '<span class="muted">Not reported</span>';
    if (typeof v === 'boolean')
        return v ? 'Yes' : 'No';
    const u = safeUrl(v);
    if (u)
        return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(String(v))} ↗</a>`;
    return esc(stamp(v)) + (units[k] ? ' ' + units[k] : '');
}
function facts(data: unknown, depth = 0): string {
    if (data === null || typeof data !== 'object')
        return value(data);
    if (Array.isArray(data)) {
        if (!data.length)
            return '<p>No entries reported.</p>';
        return data.map((x, i) => typeof x === 'object' && x !== null ? `<details class="section"><summary>${esc((x as Row).headline || (x as Row).name || (x as Row).time || (x as Row).id || 'Entry ' + (i + 1))}</summary>${facts(x, depth + 1)}</details>` : `<p>${value(x)}</p>`).join('');
    }
    if ('coordinates' in data && 'type' in data)
        return `<p>${esc((data as Row).type)} geometry; coordinates are longitude, latitude.</p><details class="section"><summary>Exact coordinate geometry</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>`;
    const entries = Object.entries(data as Row);
    return `<dl class="facts">${entries.filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => `<div class="fact"><dt>${esc(human(k))}</dt><dd>${value(v, k)}</dd></div>`).join('')}</dl>${entries.filter(([, v]) => typeof v === 'object' && v !== null).map(([k, v]) => `<details class="section" ${depth === 0 && !['geometry', 'enhancement'].includes(k) ? 'open' : ''}><summary>${esc(human(k))}</summary>${facts(v, depth + 1)}</details>`).join('')}`;
}
function geometryButton() {
    return '<button id="show-geometry">Locate this evidence</button><div id="geometry-map"></div>';
}
function bindGeometry(features: unknown[]) {
    document.querySelector('#show-geometry')?.addEventListener('click', () => {
        const template = document.querySelector<HTMLTemplateElement>('#geometry-template')!;
        const fragment = template.content.cloneNode(true) as DocumentFragment;
        const map = fragment.querySelector<HTMLElement>('sierra-geo-map')!;
        map.dataset.features = JSON.stringify({ type: 'FeatureCollection', features });
        document.querySelector('#geometry-map')!.replaceChildren(fragment);
        (document.querySelector('#show-geometry') as HTMLButtonElement).hidden = true;
    });
}
function raw(x: unknown) {
    return `<details class="section"><summary>Original structured response</summary><pre>${esc(JSON.stringify(x, null, 2))}</pre></details>`;
}
async function get<T>(key: string, fn: () => Promise<ApiResult<T>>): Promise<T> {
    if (cache.has(key))
        return cache.get(key) as T;
    const requestSerial = serial;
    const r = await fn();
    if (key !== 'places' && requestSerial !== serial)
        throw new Error('Navigation changed while reading.');
    if (r.notModified)
        throw new Error('No cached response is available for this not-modified result.');
    cache.set(key, r.data);
    document.querySelector('#retrieval')!.textContent = 'Retrieved ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' · live API';
    return r.data;
}
function failure(error: unknown) {
    return `<div class="error" role="alert"><h2>This evidence could not be read.</h2><p>${esc(error instanceof Error ? error.message : error)}</p><p>Availability is unknown. Earlier evidence remains in your trail; a failed request does not mean there is nothing to report.</p><button data-retry>Try this request again</button> ${link('Check source health', 'sources')}</div>`;
}
function next(question: string, items: {
    label: string;
    v: string;
    extra?: Record<string, string>;
}[]) {
    return `<aside class="next"><p class="eyebrow">Follow the evidence</p><h2>${esc(question)}</h2><div class="tabs">${items.map(x => link(x.label, x.v, x.extra)).join('')}</div></aside>`;
}
function breadcrumb() {
    const list: {
        label: string;
        href: string;
    }[] = history.state?.trail || [];
    return `<nav class="trail" aria-label="Question trail"><a href="${url('start')}">Start here</a>${list.slice(-4).map(x => `<span aria-hidden="true">/</span><a href="${esc(x.href)}">${esc(x.label)}</a>`).join('')}<span aria-hidden="true">/</span><span>${esc(titles[view()] || domains.find(x => x.id === view())?.name || 'Your question')}</span></nav>`;
}
function redrawCompass() {
    compass.innerHTML = `<p class="eyebrow">The compass</p><a href="${url('start')}" ${view() === 'start' ? 'aria-current="page"' : ''}>Start a question</a>` + domains.map((d, i) => `<a href="${url(d.id)}" ${view() === d.id || d.views.includes(view()) ? 'aria-current="page"' : ''}><span class="number">0${i + 1}</span>${d.name}</a>`).join('') + `<a href="${url('index')}">All evidence ↗</a>`;
}
function entry(e: V1Event, label?: string, revision?: number) {
    if (revision !== undefined)
        snapshots.set(e.id + ':' + revision, e);
    return `<a class="entry" href="${url('event', { id: e.id, rev: revision === undefined ? undefined : String(revision) })}"><span class="meta">${esc(e.status)}<br/>${esc(e.severity)}${revision ? '<br/>Revision ' + revision : ''}</span><div><h3>${esc(label || e.headline || e.id)}</h3><p>${esc(e.summary || e.areaLabel || human(e.layer))}</p><span class="meta">${esc(e.provenance?.sourceName || 'Source not reported')} · ${esc(stamp(e.observedAt))}</span>${e.enhancement ? '<p class="tag">Includes source-provided AI enhancement</p>' : ''}</div><span class="arrow" aria-hidden="true">↗</span></a>`;
}
async function start() {
    const place = currentPlace();
    content.innerHTML = breadcrumb() + heading('A living inquiry / Sierra Grid', 'A place is more than a point on a map.', 'Pick a question. Follow a real observation. See what it leads to.') + `<div id="opening" class="opening-evidence"><div><p class="eyebrow">Begin with what is being reported</p><p role="status">Reading this place…</p></div></div><div class="questions">${domains.map((d, i) => `<a href="${url(d.id)}"><span class="number">0${i + 1}</span><h2>${d.question}</h2><span aria-hidden="true">↗</span></a>`).join('')}</div>`;
    const target = document.querySelector('#opening')!;
    try {
        if (!place) {
            target.innerHTML = `<div><h2>Where would you like to begin?</h2><p>All-place records include observations beyond the configured region. Choose a geographic lens for regional context.</p>${link('Explore the place directory', 'places')}</div>`;
            return;
        }
        const s = await get('summary:' + place, () => client.getPlaceSummary(place));
        if (view() !== 'start')
            return;
        const road = s.domains.find(x => x.domain === 'roads');
        const selected = s.summary.topEvents[0];
        target.innerHTML = `<div><p class="eyebrow">${esc(s.placeName)} · reported context</p><h2>${selected ? esc(selected.headline) : 'What does the regional picture include?'}</h2><p>${selected ? 'A source observation offers one place to begin. Read the record before drawing a conclusion.' : 'The summary is a limited rollup. Conditions, burn status and radio observations need their own evidence.'}</p>${selected ? link('What is the evidence?', 'event', { id: selected.id }) : link('Read the regional context', 'summary')}</div><div class="annotation"><p class="eyebrow">Another question</p><h3>Could the road tell a different story?</h3><p>Regional mode: <strong>${s.mode}</strong>. Roads: <strong>${road?.highestSeverity ?? 'unknown'}</strong>; source health <strong>${road?.status ?? 'unknown'}</strong>.</p><p>Road conditions can raise road severity without changing the regional mode.</p>${link('Follow the journey', 'journey')}<p class="meta">Generated ${esc(stamp(s.generatedAt))}</p></div>`;
    }
    catch (e) {
        target.innerHTML = failure(e);
    }
}
async function domain(id: string) {
    const d = domains.find(x => x.id === id)!;
    content.innerHTML = breadcrumb() + heading('Choose a line of inquiry', d.question, d.intro) + `<div class="questions">${d.views.map((v, i) => `<a href="${url(v)}"><span class="number">${String(i + 1).padStart(2, '0')}</span><h2>${titles[v]}<small>${questionFor(v)}</small></h2><span aria-hidden="true">↗</span></a>`).join('')}</div>` + next('How much of the picture can we see?', [{ label: 'Review source health', v: 'sources' }, { label: 'Change the geographic lens', v: 'places' }, { label: 'Browse every collection', v: 'index' }]);
}
function questionFor(v: string) {
    const q: Record<string, string> = { weather: 'What changes over the next hours?', ROAD_INCIDENT: 'What is active, and what is still planned?', BURN_STATUS: 'Do both authorities permit burning?', MESH: 'What was heard, and what was actually measured?', EVACUATION: 'What does the authoritative source say?', cameras: 'What does the road look like?', links: 'Which paths have actually been observed?', EARTHQUAKE: 'What has been reported, and when?' };
    return q[v] || 'Open the observations and their evidence';
}
async function weather() {
    const d = await get('weather:' + currentPlace(), () => client.getConditions({ place: currentPlace() || undefined }));
    const currentLocationIds = new Set(d.weather.map(reading => reading.locationId));
    const forecastOnly = d.forecast.filter(forecast => !currentLocationIds.has(forecast.locationId));
    content.innerHTML = breadcrumb() + heading('Sky / present and possible', 'What changes over the next hours?', 'Current readings and a forecast are different kinds of evidence. Choose a location to follow its hourly outlook.') + note(`Weather aggregate refreshed ${esc(stamp(d.lastUpdated))}. This is not an independent station time for each location. Some older upstream zero values can mean missing data. Forecasts are informational, not issued warnings.`) + `<div class="weather-locations">${d.weather.map(w => `<a class="weather-choice" href="${url('weather', { location: w.locationId })}"><span class="eyebrow">${esc(w.locationName)}</span><span class="big-number">${w.temperatureCelsius}°</span><p>${esc(w.weatherDescription)} · ${w.windSpeedKmh} km/h wind</p><span>Follow the next hours ↗</span></a>`).join('')}${forecastOnly.map(forecast => `<a class="weather-choice" href="${url('weather', { location: forecast.locationId })}"><span class="eyebrow">${esc(forecast.locationId)} · forecast only</span><h3>${forecast.horizonHours}-hour outlook</h3><p>No current weather was returned for this location.</p><p>Issued ${esc(stamp(forecast.issuedAt))} · ${esc(forecast.source)}</p><span>Follow the next hours ↗</span></a>`).join('')}</div><div id="forecast-detail"></div>`;
    const location = params.get('location');
    if (location) {
        const w = d.weather.find(x => x.locationId === location);
        const f = d.forecast.find(x => x.locationId === location);
        const el = document.querySelector('#forecast-detail')!;
        el.innerHTML = `<h2>${esc(w?.locationName || location)}</h2>${w ? facts(w) : '<p>No current weather returned for this location.</p>'}${f ? `<section class="forecast"><p class="eyebrow">${esc(f.source)} · issued ${esc(stamp(f.issuedAt))}</p><h3>${f.horizonHours} hours of possibilities</h3><p>Peak gust ${f.peakWindGustKmh} km/h at ${esc(stamp(f.peakWindGustAt))}; minimum humidity ${f.minHumidityPercent}%. These are forecast values.</p><label for="metric">Explore a forecast quantity</label> <select id="metric"><option value="temperatureCelsius">Temperature · °C</option><option value="windSpeedKmh">Wind speed · km/h</option><option value="windGustKmh">Wind gust · km/h</option><option value="humidityPercent">Relative humidity · %</option><option value="windDirectionDegrees">Wind from · degrees</option></select><div id="chart"></div>${raw(f)}</section>` : note('No forecast was returned for this location. It may be unavailable; this does not imply stable weather.')}`;
        if (f) {
            restoreMetric('metric', 'temperatureCelsius');
            const draw = () => {
                const key = (document.querySelector('#metric') as HTMLSelectElement).value as keyof typeof f.periods[number];
                renderTimeSeries(document.querySelector<HTMLElement>('#chart')!, { label: human(key), unit: units[key], description: 'Forecast periods, not measured history. Chart times are UTC; accessible values below.', maxGapMs: 90 * 60 * 1000, series: [{ id: key, label: human(key), points: f.periods.map(p => ({ time: p.time ? Date.parse(p.time) : NaN, value: typeof p[key] === 'number' ? p[key] as number : null })) }] });
            };
            draw();
            document.querySelector('#metric')!.addEventListener('change', draw);
        }
    }
    content.insertAdjacentHTML('beforeend', `<h2>Was a warning actually issued?</h2>${facts(d.fireWeather)}${next('Keep following the sky', [{ label: 'Issued weather products', v: 'WEATHER_ALERT' }, { label: 'Fire-weather features and source', v: 'fire_weather' }, { label: 'What is happening on the land?', v: 'land' }])}`);
}
function timeForm(defaultDays = 7) {
    const end = params.get('to') || visitNow.toISOString();
    const begin = params.get('from') || new Date(Date.parse(end) - defaultDays * 86400000).toISOString();
    return { from: begin, to: end, html: `<form id="time-form" class="form-row"><label>From (UTC)<input name="from" type="datetime-local" value="${begin.slice(0, 16)}" required/></label><label>To (UTC, exclusive)<input name="to" type="datetime-local" value="${end.slice(0, 16)}" required/></label><button>Read this window</button></form>` };
}
function bindTime() {
    document.querySelector('#time-form')?.addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.target as HTMLFormElement);
        const p = new URLSearchParams(params);
        p.set('from', new Date(String(f.get('from')) + 'Z').toISOString());
        p.set('to', new Date(String(f.get('to')) + 'Z').toISOString());
        navigate('?' + p);
    });
}
async function events(layer: NonNullable<EventQuery['layer']>[number]) {
    const archive = params.get('archive') === '1';
    const all = params.get('ended') === '1';
    const window = timeForm(7);
    content.innerHTML = breadcrumb() + heading('Evidence / ' + human(layer), archive ? 'What changed in the record?' : questionFor(layer), 'Read source records, then follow individual observations into their histories.') + `<div class="tabs">${link('Active & scheduled', layer)}${link('Include resolved & expired', layer, { ended: '1' })}${link('Explore revision archive', layer, { archive: '1' })}${link('Source health', 'sources')}</div>${archive ? window.html : ''}` + note(archive ? 'This archive is bounded by revision observation time, not activity time. Revisions are changed snapshots, not every poll. Place filtering uses current attachments.' : 'This collection is scoped by the geographic lens. Empty results are not an all-clear. Source health and geographic coverage are separate evidence.') + `<div id="records"></div><p id="complete" class="status"></p><button id="more">Read the first page</button>`;
    const stateKey = JSON.stringify({ layer, archive, all, place: currentPlace(), from: window.from, to: window.to });
    const saved = pagesRead.get(stateKey);
    let token: string | undefined = saved?.token;
    let count = saved?.count || 0;
    const records = document.querySelector('#records')!;
    if (saved)
        records.innerHTML = saved.html;
    const more = document.querySelector<HTMLButtonElement>('#more')!;
    const complete = document.querySelector('#complete')!;
    const load = async () => {
        more.disabled = true;
        more.textContent = 'Reading…';
        try {
            const key = JSON.stringify({ layer, archive, all, place: currentPlace(), from: window.from, to: window.to, token });
            if (archive) {
                const d = await get(key, () => client.listHistory({ layer: [layer], place: currentPlace() || undefined, from: window.from, to: window.to, pageSize: 25, pageToken: token }));
                records.insertAdjacentHTML('beforeend', d.revisions.map(r => entry(r.event, undefined, r.revision)).join(''));
                count += d.revisions.length;
                token = d.nextPageToken;
            }
            else {
                const d = await get(key, () => client.listEvents({ layer: [layer], place: currentPlace() || undefined, status: all ? ['ACTIVE', 'SCHEDULED', 'RESOLVED', 'EXPIRED'] : ['ACTIVE', 'SCHEDULED'], pageSize: 25, pageToken: token }));
                records.insertAdjacentHTML('beforeend', d.events.map(e => entry(e)).join(''));
                count += d.events.length;
                token = d.nextPageToken;
            }
            pagesRead.set(stateKey, { html: records.innerHTML, count, token });
            complete.textContent = `${count} ${archive ? 'revisions' : 'records'} read. ${token ? 'More evidence remains; this is a partial collection.' : 'The continuation token is empty: this query is complete.'}`;
            if (count === 0)
                records.innerHTML = note('No records returned for this query. Try another place, lifecycle or archive window; check sources before interpreting absence.');
            more.hidden = !token;
            more.textContent = 'Read the next page';
        }
        catch (e) {
            complete.innerHTML = failure(e);
            more.textContent = 'Retry next page';
        }
        finally {
            more.disabled = false;
        }
    };
    more.addEventListener('click', load);
    bindTime();
    if (saved) {
        complete.textContent = `${count} records restored. ${token ? 'Partial collection; more evidence remains.' : 'Query complete; no continuation token.'}`;
        more.hidden = !token;
        more.textContent = 'Read the next page';
    }
    else
        await load();
}
function insight(e: V1Event) {
    const facets: [
        string,
        unknown,
        string
    ][] = [];
    if (e.wildfire) {
        facets.push(['Reported footprint', e.wildfire.acres + ' acres', 'Source-specific area; sources are not automatically merged.'], ['Reported containment', e.wildfire.containment + '%', 'Zero can mean unknown for perimeter-only fires.'], ['Geometry', e.wildfire.hasPerimeter ? 'Perimeter available' : 'Origin point / no perimeter', 'A point is not the fire boundary.']);
    }
    if (e.evacuation) {
        facets.push(['Zone', e.evacuation.zoneId, e.evacuation.county], ['Official level', e.evacuation.level, 'Confirm with Genasys and follow official instructions.']);
    }
    if (e.earthquake) {
        facets.push(['Magnitude', e.earthquake.magnitude, 'Magnitude is not response severity.'], ['Depth', e.earthquake.depthKm + ' km', 'Reported hypocentre depth.'], ['Felt reports', e.earthquake.felt, 'USGS community reports, not a population census.']);
    }
    if (e.burnStatus) {
        facets.push(['Combined permission', human(e.burnStatus.permission.replace('BURN_PERMISSION_', '')), 'Requires both authorities to permit.'], ['County answer', human(e.burnStatus.burnDay.replace('BURN_DAY_', '')), 'Read each phone transcript below.'], ['CAL FIRE', human(e.burnStatus.calfireStatus.replace('CALFIRE_', '')), 'Observed ' + stamp(e.burnStatus.calfireObservedAt)]);
    }
    if (e.power) {
        facets.push(['Reported lifecycle', e.status, e.power.stage || e.power.crewStatus || 'No stage / crew status reported'], ['Affected customers', e.power.customersAffected === 0 ? 'Not supplied' : e.power.customersAffected, 'A zero upstream count means no count was supplied.'], ['Restoration estimate', stamp(e.power.estimatedRestoration), 'An estimate, not proof of restoration.']);
    }
    if (e.roadIncident) {
        facets.push(['Lifecycle', e.status, e.status === 'SCHEDULED' ? 'Planned work; not yet active.' : 'Use source status even if a planned end has passed.'], ['Source log', e.roadIncident.logNumber, 'The original closure / incident identifier.']);
    }
    if (e.weatherAlert) {
        facets.push(['Certainty', e.weatherAlert.certainty, 'As issued by NWS.'], ['Urgency', e.weatherAlert.urgency, 'Original instruction is preserved below.']);
    }
    if (e.mesh) {
        facets.push(['Role', e.mesh.nodeType, 'As advertised by the node.'], ['Admin reachability', e.mesh.reachability === 'MESH_REACHABILITY_UNSPECIFIED' ? 'Unmonitored / unspecified' : e.mesh.reachability, 'Monitor access is not a general connectivity verdict.']);
    }
    return `<div class="insight">${facets.map(([title, v, why]) => `<section><p class="eyebrow">${esc(title)}</p><h2>${esc(v)}</h2><p>${esc(why)}</p></section>`).join('')}</div>`;
}
function restoreMetric(id: string, fallback: string) {
    const select = document.querySelector<HTMLSelectElement>('#' + id)!;
    const desired = params.get('metric') || fallback;
    if ([...select.options].some(o => o.value === desired))
        select.value = desired;
    select.addEventListener('change', () => {
        params.set('metric', select.value);
        history.replaceState(history.state, '', '?' + params);
    });
}
async function event() {
    const id = params.get('id');
    if (!id)
        throw new Error('Choose an observation first.');
    let e = await get('event:' + id + ':io=' + params.get('io'), () => client.getEvent(id, { enhancementIo: params.get('io') === '1' }));
    const revision = params.get('rev');
    if (revision && snapshots.has(id + ':' + revision) && params.get('io') !== '1')
        e = snapshots.get(id + ':' + revision)!;
    else if (revision) {
        let token: string | undefined;
        let found = false;
        for (let i = 0; i < 4; i++) {
            const d = await get('eh:' + id + ':' + token + ':io=' + params.get('io'), () => client.getEventHistory(id, { pageSize: 50, pageToken: token, enhancementIo: params.get('io') === '1' }));
            const match = d.revisions.find(r => r.revision === Number(revision));
            if (match) {
                e = match.event;
                found = true;
                break;
            }
            token = d.nextPageToken;
            if (!token)
                break;
        }
        if (!found)
            throw new Error('That revision was not found within the bounded 200-revision lookup. Open the current record and page its history.');
    }
    content.innerHTML = breadcrumb() + heading(revision ? 'Historical snapshot / revision ' + revision : 'Source observation', e.headline || e.id, e.summary) + `<p class="tag">${esc(e.layer)} / ${esc(e.status)} / ${esc(e.severity)}</p>${insight(e)}${e.enhancement ? note('Source-provided AI enhancement is present. Attribution, model and affected fields are recorded below; source instructions remain authoritative.') : ''}<p class="source-text">${esc(e.description)}</p>` + (e.weatherAlert?.instruction ? `<h2>Official instruction — verbatim</h2><p class="source-text">${esc(e.weatherAlert.instruction)}</p>` : '') + (e.layer === 'EVACUATION' ? note('Reference only. Confirm evacuation status and follow official instructions. <a href="https://protect.genasys.com/">Open Genasys Protect ↗</a>') : '') + (e.layer === 'BURN_STATUS' ? note('Both air-district and CAL FIRE requirements must permit burning. Unknown or stale is not permission. Same-answer calls can refresh without a new revision.') : '') + (e.layer === 'MESH' ? note('Reachability describes a monitor’s admin-interface access, not general connectivity. Radio activity clocks are distinct from event revision time.') : '') + `<div class="tabs">${safeUrl(e.canonicalUrl || e.provenance?.sourceUrl) ? `<a class="btn" href="${esc(e.canonicalUrl || e.provenance?.sourceUrl)}" target="_blank" rel="noopener noreferrer">Read the official source ↗</a>` : link('Find the source homepage', 'sources', { id: e.provenance?.sourceId })}${link('What changed in this record?', 'history', { id })}${e.mesh ? link('What did the monitor measure?', 'telemetry', { node: e.mesh.publicKey }) : ''}</div><div class="details"><section><h2>What was reported?</h2>${facts(Object.fromEntries(Object.entries(e).filter(([k]) => !['geometry', 'provenance', 'enhancement', 'description', 'summary'].includes(k))))}</section><section><h2>Where does it come from?</h2>${facts(e.provenance)}${note('Observed time belongs to the source. Ingested time is when Grid stored the record; fetched time is retrieval by the source adapter. Empty timestamps are unknown.')}<details class="section"><summary>Place attachments & geometry</summary>${e.geometry?.object ? geometryButton() : 'No geometry reported.'}${facts(e.geometry)}<p>${e.placeIds.map(p => link(p, 'places', { id: p })).join(' ') || 'No named place attachments.'}</p></details><details class="section"><summary>Enhancement attribution</summary>${facts(e.enhancement)}${params.get('io') !== '1' ? link('Read stored enhancement prompt & response', 'event', { id, rev: revision || undefined, io: '1' }) : note('Stored I/O requested explicitly. Empty request/response fields mean no stored I/O was returned; no new enrichment has run.')}</details></section></div>${raw(e)}${next('Where does this evidence lead?', [{ label: 'Read this category', v: e.layer }, { label: 'Check the reporting source', v: 'sources' }, ...(e.mesh ? [{ label: 'Explore observed links', v: 'links' }] : [{ label: 'Compare the regional context', v: 'summary' }])])}`;
    bindGeometry(e.geometry?.object ? [{ type: 'Feature', geometry: e.geometry.object, properties: { label: e.headline, description: e.areaLabel } }] : []);
}
async function historyView() {
    const id = params.get('id');
    if (!id)
        throw new Error('Select an event to read its revision history.');
    content.innerHTML = breadcrumb() + heading('Changed snapshots', 'What changed in this record?', 'Every revision is a stored version, not a periodic measurement. Unchanged polls and volatile signal updates do not create revisions.') + link('Return to current record', 'event', { id }) + `<div id="records"></div><p id="complete" class="status"></p><button id="more">Read revisions</button>`;
    const historyKey = 'history:' + id + ':io=' + params.get('io');
    const savedHistory = pagesRead.get(historyKey);
    let token: string | undefined = savedHistory?.token;
    let count = savedHistory?.count || 0;
    if (savedHistory)
        document.querySelector('#records')!.innerHTML = savedHistory.html;
    const b = document.querySelector<HTMLButtonElement>('#more')!;
    const load = async () => {
        b.disabled = true;
        try {
            const d = await get('eh:' + id + ':' + token + ':io=' + params.get('io'), () => client.getEventHistory(id, { pageSize: 50, pageToken: token, enhancementIo: params.get('io') === '1' }));
            document.querySelector('#records')!.insertAdjacentHTML('beforeend', d.revisions.map(r => entry(r.event, undefined, r.revision)).join(''));
            count += d.revisions.length;
            token = d.nextPageToken;
            pagesRead.set(historyKey, { html: document.querySelector('#records')!.innerHTML, count, token });
            document.querySelector('#complete')!.textContent = `${count} revisions read. ${token ? 'Partial: more revisions remain.' : 'No continuation token; query complete.'}`;
            b.hidden = !token;
            b.textContent = 'Read earlier revisions';
        }
        catch (e) {
            document.querySelector('#complete')!.innerHTML = failure(e);
        }
        finally {
            b.disabled = false;
        }
    };
    b.onclick = load;
    if (savedHistory) {
        document.querySelector('#complete')!.textContent = `${count} revisions restored. ${token ? 'Partial: more remain.' : 'Query complete.'}`;
        b.hidden = !token;
        b.textContent = 'Read earlier revisions';
    }
    else
        await load();
}
async function mapView(layer: MapLayer) {
    const place = currentPlace() || 'ebbetts-pass';
    const d = await get('map:' + place + ':' + layer, () => client.getMapLayer(place, layer));
    content.innerHTML = breadcrumb() + heading('Place conditions / ' + place, titles[layer] || human(layer), 'Follow the features into their reported values, source health and geometry.') + note(`${currentPlace() ? '' : 'A map projection requires a place; showing Ebbetts Pass Corridor. '}Condition features have no event revision archive. Empty or unavailable does not mean clear.`) + `<details class="section" open><summary>Source health & retrieval evidence</summary>${facts(d.metadata)}</details>` + geometryButton() + d.features.map((f, i) => `<details class="section" ${params.get('id') === String(f.properties?.id) ? 'open' : ''}><summary>${esc(f.properties?.headline || f.properties?.id || 'Feature ' + (i + 1))}</summary>${facts(f.properties)}<details class="section"><summary>Geometry · longitude, latitude</summary>${facts(f.geometry)}</details></details>`).join('') + (d.features.length ? '' : note('No features returned. Interpret this alongside the source metadata above.')) + raw(d) + next('What would help interpret this?', [{ label: 'Read the regional context', v: 'summary' }, { label: 'Look through a camera', v: 'cameras' }, { label: 'Check source health', v: 'sources' }]);
    bindGeometry(d.features.map(f => ({ ...f, properties: { ...f.properties, label: f.properties?.headline } })));
}
async function cameras() {
    const d = await get('cameras:' + currentPlace(), () => client.listCameras({ place: currentPlace() || undefined }));
    content.innerHTML = breadcrumb() + heading('Journeys / a view from the roadside', 'What does the road look like?', 'Caltrans camera references offer another kind of evidence. Images load only when you ask; no footage archive is available.') + note(`Directory source health: ${d.sourceStatus}. ${esc(d.attribution)}. Last source update: ${esc(stamp(d.lastSourceUpdate))}. This is not the image capture time.`) + d.cameras.map(c => `<section class="camera"><h2>${esc(c.name)}</h2><p>${esc(c.route)} · ${esc(c.nearbyPlace)} · ${c.elevationFeet} ft</p><button data-image="${esc(safeUrl(c.imageUrl) || '')}" data-name="${esc(c.name)}">Show this live camera image</button><div class="image"></div><details class="section"><summary>Location, refresh & source links</summary>${facts(c)}</details></section>`).join('') + (d.cameras.length ? '' : note('No camera references returned for this place. Out-of-service cameras may be omitted.')) + next('What might the camera miss?', [{ label: 'Read active and planned work', v: 'ROAD_INCIDENT' }, { label: 'Check chain controls', v: 'chain_control' }]);
    document.querySelectorAll<HTMLButtonElement>('[data-image]').forEach(b => b.onclick = () => {
        const image = document.createElement('img');
        image.src = b.dataset.image!;
        image.alt = b.dataset.name + ' — latest upstream camera image, capture time unavailable';
        image.className = 'photo';
        image.onerror = () => {
            image.remove();
            b.nextElementSibling!.textContent = 'The upstream image could not be loaded. Use the source link below.';
        };
        b.nextElementSibling!.replaceChildren(image);
        b.disabled = true;
    });
}
async function scanners() {
    const d = await get('scanners:' + currentPlace(), () => client.listScanners({ place: currentPlace() || undefined }));
    content.innerHTML = breadcrumb() + heading('Signals / listening references', 'Where could you listen?', 'Configured scanner references, not a live-health indicator or a transcript archive. Listening opens the provider; nothing autoplays.') + facts(d);
}
async function sources() {
    const d = await get('sources', () => client.listSources());
    content.innerHTML = breadcrumb() + heading('Trust / the source ledger', 'How much of the picture can we see?', 'A recent page retrieval does not make an upstream source current. Read success time, attempt time and policy separately.') + d.sources.map(s => `<details class="section" ${params.get('id') === s.id ? 'open' : ''}><summary>${esc(s.name || s.id)} · ${esc(s.status)}</summary>${facts(s)}</details>`).join('') + note('Reporter rows are health-only; zero poll interval does not imply failure. This registry is not a historical uptime ledger.');
}
async function summary() {
    const place = currentPlace() || 'ebbetts-pass';
    const d = await get('summary:' + place, () => client.getPlaceSummary(place));
    content.innerHTML = breadcrumb() + heading('Regional context / ' + d.placeName, 'What does the summary leave out?', `Reported mode ${d.mode}, generated ${stamp(d.generatedAt)}.`) + note('The rollup excludes ambient mesh and burn records, planned roadwork and some small power outages. Road conditions can be severe without raising the overall mode. Read each domain separately.') + `<div class="questions">${d.domains.map(x => `<a href="${url(({ fire: 'land', evacuation: 'EVACUATION', weather: 'sky', roads: 'journey', seismic: 'earth', power: 'power', burn: 'BURN_STATUS', comms: 'signals' } as Record<string, string>)[x.domain])}"><span class="number">${esc(x.status)}</span><h2>${human(x.domain)}<small>${x.activeCount} reported in domain · ${x.highestSeverity}</small></h2><span aria-hidden="true">↗</span></a>`).join('')}</div><h2>Which observations shaped it?</h2>${d.summary.topEvents.map(e => link(e.headline, 'event', { id: e.id })).join(' ')}<details class="section"><summary>All summary facts, source health & counts</summary>${facts(d)}</details>`;
}
async function placesView() {
    const d = await get('places', () => client.listPlaces());
    content.innerHTML = breadcrumb() + heading('Geography / the meaning of place', 'Where does this observation belong?', 'Town points, county boundaries and travel corridors mean different things. Event attachment can include proximity; a town is not a complete hazard footprint.') + `<form id="resolve" class="form-row"><label>US address<input name="address" placeholder="Street, city, state" required/></label><button>Find matching places</button></form><div id="resolved"></div>` + d.places.map(p => `<details class="section" ${params.get('id') === p.id ? 'open' : ''}><summary>${esc(p.name)} · ${esc(p.kind)}</summary><a class="btn" href="?place=${encodeURIComponent(p.slug)}">Explore through this lens ↗</a>${facts(p)}</details>`).join('');
    document.querySelector('#resolve')!.addEventListener('submit', async (e) => {
        e.preventDefault();
        const address = String(new FormData(e.target as HTMLFormElement).get('address'));
        const dest = document.querySelector('#resolved')!;
        dest.textContent = 'Resolving this address…';
        try {
            const d = await get('resolve:' + address, () => client.resolvePlace({ address }));
            dest.innerHTML = facts(d);
        }
        catch (e) {
            dest.innerHTML = failure(e);
        }
    });
}
async function linksView() {
    const window = params.get('window') || '72h';
    const d = await get('links:' + window, () => client.listMeshLinks({ window }));
    content.innerHTML = breadcrumb() + heading('Signals / observed paths', 'Which paths have actually been observed?', 'These are aggregate observed links, not RF coverage or complete topology. Absence of a link is not evidence that a radio path cannot exist.') + `<div class="tabs">${['24h', '72h', '168h', '720h', '9600h'].map(w => link(w, 'links', { window: w })).join('')}</div><p class="status">Window ${esc(d.window)} · generated ${esc(stamp(d.generatedAt))} · ${d.links.length} links returned. These are current rolling windows, not historical topology.</p><label for="link-filter">Find a public-key endpoint</label> <input id="link-filter" placeholder="Public-key prefix"/><div id="link-list"></div><button id="link-more">Show more returned links</button>`;
    let shown = 0;
    const render = () => {
        const filter = (document.querySelector('#link-filter') as HTMLInputElement).value.toLowerCase();
        const rows = d.links.filter(x => x.a.includes(filter) || x.b.includes(filter));
        shown += 40;
        document.querySelector('#link-list')!.innerHTML = rows.slice(0, shown).map(l => `<details class="section"><summary>${l.observations} observations · ${l.daysActive} days active · best SNR ${l.bestSnr} dB</summary><div class="tabs">${link('Follow endpoint ' + l.a.slice(0, 8), 'event', { id: 'meshcore:' + l.a })}${link('Follow endpoint ' + l.b.slice(0, 8), 'event', { id: 'meshcore:' + l.b })}</div>${facts(l)}</details>`).join('') + `<p class="status">${Math.min(shown, rows.length)} of ${rows.length} returned matching links shown.</p>`;
        (document.querySelector('#link-more') as HTMLButtonElement).hidden = shown >= rows.length;
    };
    document.querySelector('#link-filter')!.addEventListener('input', () => {
        shown = 0;
        render();
    });
    document.querySelector('#link-more')!.addEventListener('click', render);
    render();
}
async function telemetry() {
    const node = params.get('node');
    if (!node)
        throw new Error('Open measurements from a radio observation.');
    const w = timeForm(1);
    const d = await get('telemetry:' + node + ':' + w.from + ':' + w.to, () => client.getMeshTelemetry({ node, from: w.from, to: w.to }));
    content.innerHTML = breadcrumb() + heading('Signals / measured evidence', 'What did the monitor actually measure?', 'The measurement clock is reportedAt. Storage receivedAt can differ. Null gauges are missing measurements; exact counters remain decimal strings.') + w.html + note(`Effective window ${esc(stamp(d.from))} to ${esc(stamp(d.to))}. ${d.samples.length} samples returned. ${d.truncated ? 'TRUNCATED: narrow the window; this is not a complete series.' : 'Server reports no truncation.'} Cadence ${esc(d.cadenceSeconds ?? 'unknown')} seconds. ${d.reboots.length} inferred reboots.`) + `<details class="section" open><summary>Whole retained archive coverage</summary>${facts(d.coverage)}</details><label for="telemetry-metric">Measurement</label> <select id="telemetry-metric"><option value="batteryVolts">Battery · V</option><option value="batteryPercent">Battery charge · %</option><option value="temperatureC">Temperature · °C</option><option value="humidity">Humidity · %</option><option value="pressure">Pressure · hPa</option><option value="noiseFloorDbm">Noise floor · dBm</option><option value="lastSnrDb">Last SNR · dB</option><option value="lastRssiDbm">Last RSSI · dBm</option><option value="txQueueLen">Transmit queue · packets</option></select><div id="chart"></div><details class="section"><summary>Reboot evidence</summary>${facts(d.reboots)}</details><h2>Individual measurements</h2><p>All returned sample fields, including exact counters and both clocks. No rates are inferred.</p><div id="samples"></div><button id="sample-more">Show more samples</button>`;
    restoreMetric('telemetry-metric', 'batteryVolts');
    const draw = () => {
        const key = (document.querySelector('#telemetry-metric') as HTMLSelectElement).value;
        renderTimeSeries(document.querySelector<HTMLElement>('#chart')!, { label: human(key), unit: units[key], description: 'Reported measurement time in UTC. Nulls and gaps over 1.5× median cadence break the line. With unknown cadence, points stand alone.', maxGapMs: d.cadenceSeconds ? Number(d.cadenceSeconds) * 1500 : 1, series: [{ id: key, label: human(key), points: d.samples.map(s => ({ time: s.reading.reportedAt ? Date.parse(s.reading.reportedAt) : NaN, value: (s.reading as unknown as Row)[key] as number | null })) }] });
    };
    draw();
    document.querySelector('#telemetry-metric')!.addEventListener('change', draw);
    let shown = 0;
    const more = document.querySelector<HTMLButtonElement>('#sample-more')!;
    const drawSamples = () => {
        const chunk = d.samples.slice(shown, shown + 50);
        document.querySelector('#samples')!.insertAdjacentHTML('beforeend', chunk.map(s => `<details class="section"><summary>${esc(stamp(s.reading.reportedAt))}</summary>${facts(s)}</details>`).join(''));
        shown += chunk.length;
        more.hidden = shown >= d.samples.length;
    };
    more.onclick = drawSamples;
    drawSamples();
    bindTime();
}
function index() {
    content.innerHTML = breadcrumb() + heading('The complete collection', 'Every question has a way in.', 'Jump directly to any public collection. Nothing depends on completing a trail first.') + domains.map(d => `<section><h2>${d.name}</h2><div class="tabs">${d.views.map(v => link(titles[v], v)).join('')}</div></section>`).join('') + `<h2>Context & trust</h2><div class="tabs">${['places', 'summary', 'sources'].map(v => link(titles[v], v)).join('')}</div><details class="section"><summary>All thirteen geographic projections</summary><div class="tabs">${mapLayers.map(v => link(human(v), 'map', { layer: v })).join('')}</div></details>` + note('Not publicly exposed: historical weather/road-condition/camera archives, raw mesh receptions and packet paths, daily topology buckets, internal burn diagnostics and private relay operations. Reserved gauge, air-quality and announcement categories do not provide datasets here. Event collections offer bounded revision archives; radio records offer measurement archives where monitored.');
}
async function render() {
    const run = ++serial;
    params = new URLSearchParams(location.search);
    placeSelect.value = currentPlace();
    redrawCompass();
    const v = view();
    content.innerHTML = breadcrumb() + `<p class="status" role="status">Following the live evidence…</p>`;
    try {
        if (v === 'start')
            await start();
        else if (domains.some(d => d.id === v))
            await domain(v);
        else if (v === 'index')
            index();
        else if (v === 'weather')
            await weather();
        else if (v === 'event')
            await event();
        else if (v === 'history')
            await historyView();
        else if (v === 'telemetry')
            await telemetry();
        else if (v === 'cameras')
            await cameras();
        else if (v === 'scanners')
            await scanners();
        else if (v === 'sources')
            await sources();
        else if (v === 'places')
            await placesView();
        else if (v === 'summary')
            await summary();
        else if (v === 'links')
            await linksView();
        else if (v === 'map')
            await mapView((params.get('layer') || 'road_segment') as MapLayer);
        else if (mapLayers.includes(v as MapLayer))
            await mapView(v as MapLayer);
        else if (['WILDFIRE', 'EVACUATION', 'WEATHER_ALERT', 'EARTHQUAKE', 'ROAD_INCIDENT', 'POWER', 'MESH', 'BURN_STATUS'].includes(v))
            await events(v as NonNullable<EventQuery['layer']>[number]);
        else
            index();
    }
    catch (e) {
        if (run === serial)
            content.innerHTML = breadcrumb() + failure(e);
    }
}
function navigate(href: string) {
    const label = titles[view()] || domains.find(d => d.id === view())?.name || 'Opening question';
    const trail = [...(history.state?.trail || []), { label, href: location.search || '?' }];
    history.pushState({ trail: trail.slice(-8) }, '', href);
    void render();
    document.querySelector<HTMLElement>('#reading')!.focus();
    window.scrollTo({ top: 0 });
}
document.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const a = t.closest<HTMLAnchorElement>('a');
    if (a && a.origin === location.origin && a.pathname === location.pathname && !a.hash && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        navigate(a.search || '?');
    }
    if (t.closest('[data-retry]'))
        void render();
});
placeSelect.addEventListener('change', () => {
    const p = new URLSearchParams(params);
    p.set('place', placeSelect.value);
    navigate('?' + p);
});
window.addEventListener('popstate', () => void render());
void get('places', () => client.listPlaces()).then(d => {
    places = d.places;
    placeSelect.innerHTML = '<option value="">All available places</option>' + places.map(p => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join('');
    placeSelect.value = currentPlace();
}).catch(() => {
    document.querySelector('#retrieval')!.textContent = 'Place directory unavailable; retry from Places.';
});
void render();
document.querySelector('#refresh')!.addEventListener('click', () => {
    cache.clear();
    pagesRead.clear();
    void render();
});
