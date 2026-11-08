import { createExplorerContext } from './client';
import { escapeHtml as e, fieldLabel, displayValue, safeUrl } from './values';
import { renderTimeSeries } from '@sierragridteam/design-system/lib/time-series-render';
import type { ApiResult, V1Event, V1Layer, MapLayer, V1Conditions, V1Place, V1Source, EventQuery } from '@sierragridteam/sdk';
const { client } = createExplorerContext();
const content = document.querySelector<HTMLElement>('#content')!;
const placeSelect = document.querySelector<HTMLSelectElement>('#place')!;
const cache = new Map<string, Promise<unknown>>();
let generation = 0;
const snapshots = new Map<string, V1Event>();
let places: V1Place[] = [];
let sources: V1Source[] = [];
let params = new URLSearchParams(location.search);
const topics = [['weather', 'Weather & forecast'], ['WILDFIRE', 'Wildfire'], ['EVACUATION', 'Evacuation'], ['WEATHER_ALERT', 'Weather alerts'], ['EARTHQUAKE', 'Earthquakes'], ['ROAD_INCIDENT', 'Road events'], ['POWER', 'Power'], ['BURN_STATUS', 'Burn permissions'], ['MESH', 'Radio nodes'], ['roads', 'Road conditions'], ['cameras', 'Cameras'], ['scanners', 'Scanner references'], ['links', 'Observed radio links'], ['places', 'Places'], ['sources', 'Source health']] as const;
const titleOf = (topic: string) => topics.find(t => t[0] === topic)?.[1] || topic;
const tense = () => params.get('tense') || 'now';
const place = () => params.get('place') || undefined;
function url(changes: Record<string, string | undefined> = {}) { const q = new URLSearchParams(params); for (const [k, v] of Object.entries(changes)) {
    if (v === undefined)
        q.delete(k);
    else
        q.set(k, v);
} return `?${q}`; }
function nav(topic: string, t?: string) { return url({ topic, tense: t || tense(), id: undefined, revision: undefined, page: undefined, pages: undefined, historyPages: undefined, evidence: undefined, hours: undefined, measurementFrom: undefined, measurementTo: undefined }); }
function stamp(v: unknown) { return v ? e(String(v).replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC')) : 'Time not reported'; }
function notice(text: string) { return `<div class="notice">${e(text)}</div>`; }
function link(value: unknown, label = 'Open original source ↗') { const u = safeUrl(value); return u ? `<a href="${e(u)}" target="_blank" rel="noopener noreferrer">${e(label)}</a>` : ''; }
async function load<T>(key: string, fn: () => Promise<ApiResult<T>>): Promise<T> { if (!cache.has(key)) {
    cache.set(key, fn().then(r => { if (r.notModified)
        throw Error('No cached body for a not-modified response'); const body = r.data as {
        revisions?: Array<{
            event: V1Event;
            revision: number;
        }>;
    }; for (const item of body.revisions || [])
        snapshots.set(item.event.id + ':' + item.revision, item.event); return r.data; }).catch(err => { cache.delete(key); throw err; }));
} return cache.get(key) as Promise<T>; }
function ledger(value: unknown, depth = 0): string {
    if (value === null || typeof value !== 'object')
        return e(displayValue(value));
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i + 1), v] as const) : Object.entries(value);
    if (!entries.length)
        return '<p class="status">No entries reported.</p>';
    return `<div class="ledger"><dl>${entries.map(([k, v]) => {
        if (v !== null && typeof v === 'object')
            return `<div class="ledger-group"><dt>${e(fieldLabel(k))}</dt><dd><details${depth === 0 ? ' open' : ''}><summary>Read fields${Array.isArray(v) ? ` · ${v.length} entries` : ''}</summary>${ledger(v, depth + 1)}</details></dd></div>`;
        const u = safeUrl(v);
        return `<div class="field"><dt>${e(fieldLabel(k))}</dt><dd>${u ? link(u, String(v)) : e(displayValue(v))}</dd></div>`;
    }).join('')}</dl></div>`;
}
function head(kicker: string, title: string, intro: string) { return `<p class="kicker">${e(kicker)}</p><h1>${e(title)}</h1><p class="intro">${e(intro)}</p>`; }
function topicNav() { return `<nav class="topic-nav" aria-label="Subjects">${topics.map(([id, label]) => `<a href="${nav(id)}" ${params.get('topic') === id ? 'aria-current="page"' : ''}>${e(label)}</a>`).join('')}</nav>`; }
function timeRail() { return `<div class="time-rail" aria-label="Evidence time"><a href="${url({ tense: 'now', id: undefined, revision: undefined, pages: undefined, historyPages: undefined })}" ${tense() === 'now' ? 'aria-current="page"' : ''}><span>01 / OBSERVED</span><strong>Now</strong></a><a href="${url({ tense: 'ahead', id: undefined, revision: undefined, pages: undefined, historyPages: undefined })}" ${tense() === 'ahead' ? 'aria-current="page"' : ''}><span>02 / EXPECTED</span><strong>Ahead</strong></a><a href="${url({ tense: 'recorded', id: undefined, revision: undefined, pages: undefined, historyPages: undefined })}" ${tense() === 'recorded' ? 'aria-current="page"' : ''}><span>03 / RETAINED</span><strong>Recorded</strong></a></div>`; }
function errorBlock(err: unknown) { return `<div role="alert" class="notice"><strong>This evidence could not be retrieved.</strong><p>${e(err instanceof Error ? err.message : 'Request failed')}. Unavailable does not mean clear.</p><button class="btn btn--outline" data-retry>Try this request again</button></div>`; }
function record(event: V1Event, i: number, revision?: number) { return `<a class="record" href="${url({ topic: event.layer, id: event.id, revision: revision ? String(revision) : undefined, historyPages: undefined, evidence: undefined })}"><span class="number">${String(i + 1).padStart(2, '0')}</span><div><h3>${e(event.headline)}</h3><p>${e(event.areaLabel || 'No place label')} · ${e(event.category)}${event.enhancement ? ' · AI-enhanced fields' : ''}</p><p>${e(event.summary || event.description).slice(0, 260)}</p></div><span class="stamp">${e(event.status)} / ${e(event.severity)}<br/>${revision ? `Revision ${revision}<br/>` : ''}${stamp(event.observedAt)}</span></a>`; }
function dateWindow() { const end = params.get('to') || new Date().toISOString().slice(0, 10); const start = params.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10); return { from: new Date(start).toISOString(), to: new Date(end + 'T23:59:59Z').toISOString() }; }
function windowForm() { const w = dateWindow(); return `<form id="window" class="actions"><label>From <input name="from" type="date" value="${w.from.slice(0, 10)}" required></label><label>Through <input name="to" type="date" value="${w.to.slice(0, 10)}" required></label><button class="btn btn--outline" type="submit">Read this interval</button></form>`; }
async function home() {
    const viewGeneration = generation;
    if (tense() === 'ahead') {
        if (viewGeneration !== generation)
            return;
        content.innerHTML = head('Expected / not guaranteed', 'What comes next?', 'Explore the forecast hour by hour, then follow planned events. Expected timing is not proof of an outcome.') + timeRail() + `<div class="chapter-grid"><a class="chapter-link" href="${nav('weather')}"><p class="kicker">THE NEXT HOURS</p><h2>Follow the sky →</h2><p>Hourly temperature, humidity, wind and gusts from NWS. Each forecast has an issue time.</p></a><a class="chapter-link" href="${nav('ROAD_INCIDENT')}"><p class="kicker">THE PLANNED WINDOWS</p><h2>Before you set out →</h2><p>Scheduled road work and closures. Plans may change or overrun their end.</p></a></div>` + topicNav();
        await tenseEvidence('ahead');
        return;
    }
    if (tense() === 'recorded') {
        if (viewGeneration !== generation)
            return;
        content.innerHTML = head('Retained / not a replay', 'What left a record?', 'A revision marks changed content. A measurement marks a report. Some kinds of evidence have no public history.') + timeRail() + `<div class="chapter-grid">${[['WILDFIRE', 'Changing ground'], ['ROAD_INCIDENT', 'Passage over time'], ['WEATHER_ALERT', 'Warnings that passed'], ['POWER', 'An outage’s revisions'], ['BURN_STATUS', 'Permission changes'], ['MESH', 'Identity & measurements']].map(([id, label]) => `<a class="chapter-link" href="${nav(id)}"><h2>${label} →</h2><p>Open a bounded archive, then inspect individual snapshots and their sources.</p></a>`).join('')}</div>` + topicNav();
        await tenseEvidence('recorded');
        return;
    }
    const [conditions, summary] = await Promise.allSettled([load('conditions:' + place(), () => client.getConditions({ place: place() })), load('summary:' + (place() || 'ebbetts-pass'), () => client.getPlaceSummary(place() || 'ebbetts-pass'))]);
    let html = head('A live reading of the Sierra', 'The region,<br>in the present.', 'Different observations keep different clocks. Start with what is being reported, then move forward to expectations or back to the retained record.').replace('&lt;br&gt;', '<br>') + timeRail();
    if (conditions.status === 'fulfilled') {
        const c = conditions.value, w = c.weather[0];
        html += `<div class="lead-spread">${w ? `<a class="weather-lead" href="${nav('weather')}"><p class="kicker">${e(w.locationName)} / CURRENT WEATHER</p><div class="big-value">${e(w.temperatureCelsius)}<span>°C</span></div><h2>${e(w.weatherDescription)}</h2><p>Open the observation, then its forecast →</p></a>` : notice('No weather locations returned for this scope.')}<div class="weather-lines"><p class="kicker">OTHER READINGS / SAME COLLECTION</p>${c.weather.slice(1, 5).map(w => `<a href="${url({ topic: 'weather', location: w.locationId })}"><span>${e(w.locationName)}<small>${e(w.weatherDescription)}</small></span><strong>${e(w.temperatureCelsius)} °C</strong></a>`).join('')}<p class="status">Aggregate refresh ${stamp(c.lastUpdated)}. Zero may mean upstream data was missing.</p></div></div>`;
    }
    else
        html += errorBlock(conditions.reason);
    if (summary.status === 'fulfilled') {
        const s = summary.value;
        html += `<div class="rule"></div><p class="kicker">REGIONAL READING / ${e(place() || 'EBBETTS PASS')}</p><h2>One place, several signals.</h2><p class="intro">Summary mode ${e(s.mode)} is not an all-clear. Road conditions can be more severe than this mode; burn and communications are ambient.</p><p class="status">Generated ${stamp(s.generatedAt)} · ${e(s.placeName)}</p><div class="domain-reading">${s.domains.map(d => `<section><div class="domain-heading"><h3>${e(d.domain)}</h3><span class="stamp">${e(d.status)} / ${e(d.highestSeverity)}</span></div><p class="status">${d.activeCount} counted items · source health ${e(d.status)}</p>${d.headlines.length ? d.headlines.map(h => `<a href="${h.kind === 'EVENT' ? url({ topic: h.layer, id: h.id }) : url({ topic: 'roads', layer: h.layer.toLowerCase(), place: s.place })}">${e(h.headline)} →</a>`).join('') : '<p>No headline returned. This is not an all-clear.</p>'}</section>`).join('')}</div><a href="${nav('places')}">Inspect the place, rollup and source sidecar →</a>`;
    }
    else
        html += errorBlock(summary.reason);
    if (viewGeneration !== generation)
        return;
    content.innerHTML = html + `<div class="rule"></div><h2>Keep following the evidence.</h2>` + topicNav();
}
async function tenseEvidence(mode: string) {
    const own = generation;
    const root = document.createElement('section');
    root.className = 'temporal-lead';
    root.innerHTML = '<p class="status">Reading the live time lens…</p>';
    content.querySelector('.time-rail')?.after(root);
    try {
        if (mode === 'ahead') {
            const c = await load('conditions:' + place(), () => client.getConditions({ place: place() }));
            if (own !== generation)
                return;
            const forecasts = c.forecast.flatMap(f => { const remaining = f.periods.filter(p => p.time && Date.parse(p.time) >= Date.now() && p.windGustKmh > 0).sort((a, b) => b.windGustKmh - a.windGustKmh); return remaining[0] ? [{ ...f, peakWindGustKmh: remaining[0].windGustKmh, peakWindGustAt: remaining[0].time }] : []; }).sort((a, b) => b.peakWindGustKmh - a.peakWindGustKmh);
            const f = forecasts[0];
            root.innerHTML = f ? `<p class="kicker">A FORECAST TO FOLLOW</p><h2>${e(f.peakWindGustKmh)} km/h gusts in the ${e(c.weather.find(w => w.locationId === f.locationId)?.locationName || f.locationId)} forecast.</h2><p>This is the largest reported peak among the ${forecasts.length} locations with nonzero gusts in remaining forecast periods for this scope. It is not an issued warning.</p><p>Peak forecast time ${stamp(f.peakWindGustAt)} · Issued ${stamp(f.issuedAt)} · ${e(f.source)}</p><a href="${url({ topic: 'weather', location: f.locationId })}">Follow the hourly evidence →</a>` : notice('No nonzero gusts in future forecast periods were returned. This is not a prediction of calm conditions.');
        }
        else {
            const from = new Date(Date.now() - 7 * 86400000).toISOString(), to = new Date().toISOString();
            const r = await load('recent:' + place(), () => client.listHistory({ from, to, place: place(), layer: ['WILDFIRE', 'EVACUATION', 'WEATHER_ALERT', 'EARTHQUAKE', 'ROAD_INCIDENT', 'POWER', 'BURN_STATUS'], pageSize: 5 }));
            if (own !== generation)
                return;
            root.innerHTML = `<p class="kicker">RECENT TRACES / SEVEN-DAY WINDOW</p><h2>Stories leave revisions.</h2><p>Up to five recent non-radio snapshots. ${r.nextPageToken ? 'More records exist; this selection is incomplete.' : 'No continuation token for this query.'} Content-observation window ${stamp(from)} → ${stamp(to)}.</p><div class="records">${r.revisions.map((r, i) => record(r.event, i, r.revision)).join('')}</div>${r.revisions.length ? '' : notice('No revisions returned in this window. Choose a subject and broaden the interval below.')}`;
        }
    }
    catch (err) {
        if (own === generation)
            root.innerHTML = errorBlock(err);
    }
}
async function weather() {
    const viewGeneration = generation;
    const c = await load('conditions:' + place(), () => client.getConditions({ place: place() }));
    let html = head('Sky / ' + tense(), tense() === 'ahead' ? 'The hours ahead.' : 'A reading of the sky.', 'Current weather is OpenWeatherMap; forecasts are NWS grid cells. The fire-weather state is region-wide and escalates only from issued NWS products.') + timeRail();
    if (tense() === 'recorded')
        html += notice('There is no public archive of weather measurements or forecast vintages. The evidence below is the currently available response, not a historical replay. Weather-alert revision history is available separately.');
    html += `<p class="status">Aggregate weather refresh: ${stamp(c.lastUpdated)} · Retrieved in this visit. Zero scalars can represent missing upstream values.</p><div class="actions"><a href="${nav('WEATHER_ALERT')}">Inspect issued weather alerts →</a><a href="${nav('roads')}&layer=fire_weather">Inspect fire-weather geographic projection →</a></div><details class="notice"><summary>Issued fire-weather evidence</summary>${ledger(c.fireWeather)}</details>`;
    const selected = params.get('location');
    for (const w of c.weather) {
        const f = c.forecast.find(f => f.locationId === w.locationId);
        html += `<section class="forecast" id="${e(w.locationId)}"><p class="kicker">${e(w.locationName)}</p><h2>${e(w.temperatureCelsius)} °C · ${e(w.weatherDescription)}</h2><p>Feels like ${e(w.feelsLikeCelsius)} °C · Wind ${e(w.windSpeedKmh)} km/h from ${e(w.windDirectionDegrees)}° · Humidity ${e(w.humidityPercent)}%</p><details${selected === w.locationId ? ' open' : ''}><summary>Read current observation & identifiers</summary>${ledger(w)}</details>${f ? `<h3>${f.horizonHours} hours of possibilities</h3><p class="status">Issued ${stamp(f.issuedAt)} · ${e(f.source)}. Forecast, not issued warning.</p><div data-forecast="${e(w.locationId)}"></div><details><summary>All forecast quantities & hourly periods</summary>${ledger(f)}</details>` : notice('No forecast returned for this location; this does not imply stable weather.')}</section>`;
    }
    for (const f of c.forecast.filter(f => !c.weather.some(w => w.locationId === f.locationId)))
        html += `<section class="forecast"><h2>${e(f.locationId)}</h2><p>No corresponding current observation returned.</p><div data-forecast="${e(f.locationId)}"></div>${ledger(f)}</section>`;
    if (!c.weather.length && !c.forecast.length)
        html += notice('No weather or forecast records returned for this scope.');
    if (viewGeneration !== generation)
        return;
    content.innerHTML = html + topicNav();
    chartForecasts(c);
}
function chartForecasts(c: V1Conditions) { document.querySelectorAll<HTMLElement>('[data-forecast]').forEach(root => { const f = c.forecast.find(x => x.locationId === root.dataset.forecast); if (!f)
    return; renderTimeSeries(root, { label: 'Hourly forecast temperature', description: 'NWS forecast periods; UTC clock. Zero may be an upstream missing-value sentinel.', unit: '°C', maxGapMs: 90 * 60 * 1000, series: [{ id: 'temperature', label: 'Forecast temperature', points: f.periods.map(p => ({ time: Date.parse(p.time || ''), value: p.temperatureCelsius })) }] }); }); }
const semantics: Partial<Record<V1Layer, string>> = {
    WILDFIRE: 'Acreage and containment are source reports. CAL FIRE and FIRIS items are not automatically the same fire. Nearby place attachment can extend beyond a boundary.',
    EVACUATION: 'Reference only. Follow authoritative evacuation instructions. Missing or unavailable evidence is not an all-clear. There is no public household census or canonical fire relationship.',
    WEATHER_ALERT: 'Original NWS instructions remain authoritative. AI summaries, where present, are labeled. Severity, certainty and urgency are distinct quantities.',
    EARTHQUAKE: 'Magnitude is not the same as unified response severity. This is an event catalog, not a seismic waveform or continuous stream.',
    ROAD_INCIDENT: 'Scheduled and active windows can overrun planned ends. Lifecycle status remains authoritative. No traffic-speed archive is available.',
    POWER: 'Restoration and all-clear times are estimates. Zero affected customers can mean upstream gave no count. No household-level service lookup is exposed.',
    BURN_STATUS: 'Air-district permission and CAL FIRE restrictions must both permit burning. Unknown or stale never means allowed. Same-answer daily call refreshes may not create revisions.',
    MESH: 'Presence is not connectivity. Revision time is not radio activity. Most nodes are unmonitored; absent measurements are not zero. Observed links are not RF coverage.',
};
async function events(layer: V1Layer) {
    const archived = tense() === 'recorded';
    const requestedPages = Math.max(1, Number(params.get('pages')) || 1);
    const restorePages = Math.min(10, requestedPages);
    let depth = 0;
    let token: string | undefined;
    let count = 0;
    const w = archived ? dateWindow() : null;
    content.innerHTML = head(titleOf(layer) + ' / ' + tense(), archived ? 'What changed in the record?' : tense() === 'ahead' ? 'What is planned?' : 'What is being reported?', semantics[layer] || 'Read the evidence in context.') + timeRail() + (archived ? windowForm() : '') + `<div class="notice">${archived ? `Window ${stamp(w!.from)} → ${stamp(w!.to)}. Half-open bounds on content-observation time. Snapshots are not periodic measurements; current place attachments filter the archive.` : tense() === 'ahead' ? 'Only SCHEDULED events. Plans are not outcomes.' : 'ACTIVE and SCHEDULED events. This is a paged collection, not a regional hazard census.'} Lists use source/API ordering; no complete chronological ordering is claimed across unloaded pages.</div><div id="records" class="records"></div><div id="page-status"></div>` + topicNav();
    const current = generation;
    const target = document.querySelector('#records')!;
    const status = document.querySelector('#page-status')!;
    async function next() {
        status.innerHTML = '<p class="status">Reading a bounded page…</p>';
        try {
            const query = { layer: [layer] as EventQuery['layer'], place: place(), pageSize: 40, pageToken: token };
            const r = archived ? await load('archive:' + JSON.stringify({ ...query, ...w }), () => client.listHistory({ ...query, ...w! })) : await load('events:' + JSON.stringify({ ...query, tense: tense() }), () => client.listEvents({ ...query, status: tense() === 'ahead' ? ['SCHEDULED'] : ['ACTIVE', 'SCHEDULED'] }));
            if (current !== generation)
                return;
            const rows = 'events' in r ? r.events.map(event => ({ event, revision: undefined })) : r.revisions;
            target.insertAdjacentHTML('beforeend', rows.map(row => record(row.event, count++, row.revision)).join(''));
            token = r.nextPageToken || undefined;
            depth++;
            preserveDepth('pages', depth);
            status.innerHTML = `<p class="status">${count} ${archived ? 'revisions' : 'events'} loaded. ${token ? 'Partial collection — more evidence is available.' : 'No continuation token; this query is complete.'}</p>${!count ? '<div class="empty"><h2>No matching records returned.</h2><p>This is not proof that the region is clear. Try another time lens or check source health.</p></div>' : ''}${token ? '<button class="btn btn--outline" id="more">Read the next page</button>' : ''}`;
            document.querySelector('#more')?.addEventListener('click', next);
            return true;
        }
        catch (err) {
            if (current === generation) {
                status.innerHTML = errorBlock(err) + `<p class="status">${count} earlier records retained. Collection remains incomplete.</p>`;
                status.querySelector('[data-retry]')?.addEventListener('click', next);
            }
            return false;
        }
    }
    if (await next()) {
        while (depth < restorePages && token) {
            if (!await next())
                break;
        }
    }
    if (requestedPages > 10 && current === generation)
        status.insertAdjacentHTML('beforeend', notice('Restored the first ten pages. The previous URL requested ' + requestedPages + ' pages; continue manually with Read the next page.'));
}
async function eventDetail(id: string) {
    const viewGeneration = generation;
    const revision = params.get('revision');
    let event: V1Event;
    if (revision) {
        let selected = snapshots.get(id + ':' + revision);
        let token: string | undefined;
        let exhausted = false;
        let inspected = 0;
        for (let page = 0; page < 5 && !selected; page++) {
            const r = await load('snapshot-lookup:' + id + ':' + token, () => client.getEventHistory(id, { pageSize: 100, pageToken: token }));
            if (viewGeneration !== generation)
                return;
            inspected += r.revisions.length;
            selected = snapshots.get(id + ':' + revision);
            token = r.nextPageToken || undefined;
            if (!token) {
                exhausted = true;
                break;
            }
        }
        if (!selected) {
            if (viewGeneration !== generation)
                return;
            content.innerHTML = head('Historical snapshot / unresolved', 'This revision is not available yet.', `Requested revision ${revision}. Inspected ${inspected} revisions in at most five pages. ${exhausted ? 'The available history ended without this revision.' : 'The lookup reached its bound; more history remains.'}`) + notice('No current record is substituted for the requested historical snapshot.') + `<a href="${url({ revision: undefined })}">Open the current record and continue through its paged revision history →</a>`;
            return;
        }
        event = selected;
    }
    else
        event = await load('event:' + id, () => client.getEvent(id));
    if (!event.canonicalUrl && !event.provenance.sourceUrl && !sources.length) {
        try {
            sources = (await load('sources', () => client.listSources())).sources;
        }
        catch { /* The event evidence remains usable when registry retrieval fails. */ }
    }
    if (viewGeneration !== generation)
        return;
    content.innerHTML = head(`${titleOf(event.layer)} / evidence`, event.headline, event.areaLabel || 'Location not labeled by source') + `<div class="actions"><a href="${url({ id: undefined, revision: undefined, evidence: undefined, historyPages: undefined })}">← Return to this collection</a>${link(event.canonicalUrl || event.provenance.sourceUrl || sources.find(s => s.id === event.provenance.sourceId)?.homepageUrl)}</div>` + notice(semantics[event.layer] || 'Inspect source evidence.') + `<p class="stamp">${e(event.status)} / ${e(event.severity)} · Revision ${event.revision} · Content observed ${stamp(event.observedAt)}</p>${revision ? notice(`Historical snapshot: revision ${revision}. This is retained evidence, not the current state.`) : ''}${event.enhancement ? notice(`AI enhancement declared. Fields: ${event.enhancement.fields.join(', ')}. Model and time are in the attribution ledger. Stored prompt/response is withheld by default; request the audit trail explicitly.`) : ''}${event.summary ? `<h2>Source-provided summary</h2><p class="source-text">${e(event.summary)}</p>` : ''}${event.description ? `<h2>Original source text</h2><p class="source-text">${e(event.description)}</p>` : ''}${event.weatherAlert?.instruction ? `<h2>NWS instructions · verbatim</h2><p class="source-text">${e(event.weatherAlert.instruction)}</p>` : ''}<h2>The evidence sheet</h2><p class="status">All supplied fields, including geometry, units, source attribution and timestamps. Empty values stay distinct from zero.</p>${ledger(event)}<div class="actions"><button id="history" class="btn btn--outline">Read revision history</button><button id="enhancement" class="btn btn--outline">Read stored AI audit trail</button>${revision ? '<button id="historical-enhancement" class="btn btn--outline">Read stored historical AI audit trail</button>' : ''}${event.mesh ? '<button id="telemetry" class="btn btn--outline">Read measurements · last 24 hours</button>' : ''}</div><div id="deep"></div>`;
    document.querySelector('#history')?.addEventListener('click', () => navigate(url({ evidence: 'history' })));
    document.querySelector('#enhancement')?.addEventListener('click', () => enhancement(id));
    document.querySelector('#historical-enhancement')?.addEventListener('click', () => enhancement(id, revision!));
    document.querySelector('#telemetry')?.addEventListener('click', () => navigate(url({ evidence: 'telemetry' })));
    if (params.get('evidence') === 'history')
        await history(id);
    if (params.get('evidence') === 'telemetry' && event.mesh)
        await telemetry(event.mesh.publicKey);
}
async function enhancement(id: string, revision?: string) {
    const root = document.querySelector('#deep')!;
    const own = generation;
    root.innerHTML = '<p>Reading stored attribution I/O…</p>';
    try {
        let event: V1Event | undefined;
        if (revision) {
            let token: string | undefined;
            let complete = false;
            for (let page = 0; page < 5 && !event; page++) {
                const r = await load('history-enhancement-io:' + id + ':' + token, () => client.getEventHistory(id, { enhancementIo: true, pageSize: 100, pageToken: token }));
                if (own !== generation)
                    return;
                event = r.revisions.find(r => String(r.revision) === revision)?.event;
                token = r.nextPageToken || undefined;
                if (!token) {
                    complete = true;
                    break;
                }
            }
            if (!event) {
                root.innerHTML = notice(`Historical I/O lookup did not locate revision ${revision}. ${complete ? 'History ended.' : 'Five-page lookup bound reached; further history remains.'} No current attribution is substituted.`);
                return;
            }
        }
        else
            event = await load('event-enhancement-io:' + id, () => client.getEvent(id, { enhancementIo: true }));
        if (own !== generation)
            return;
        root.innerHTML = '<h2>Stored AI audit trail</h2>' + notice(`This reads stored prompt/response for ${revision ? 'historical revision ' + revision : 'the current event only'}. It does not run a model or request new enrichment. The static system prompt is not exposed.`) + (event.enhancement ? ledger(event.enhancement) : notice('No enhancement metadata or stored I/O is reported for this record.'));
        if (event.enhancement && !event.enhancement.request && !event.enhancement.response)
            root.insertAdjacentHTML('beforeend', notice('The server returned no stored prompt or response text.'));
    }
    catch (err) {
        if (own === generation) {
            root.innerHTML = errorBlock(err);
            root.querySelector('button')?.addEventListener('click', () => enhancement(id, revision));
        }
    }
}
async function history(id: string) {
    const requestedPages = Math.max(1, Number(params.get('historyPages')) || 1);
    const restorePages = Math.min(10, requestedPages);
    let depth = 0;
    const root = document.querySelector('#deep')!;
    root.innerHTML = '<h2>Retained revisions</h2>' + notice('Newest first. These are content changes, not every poll. No date bounds are sent to per-event history.') + '<div id="revisions"></div><div id="revision-status"></div>';
    let token: string | undefined;
    let count = 0;
    const gen = generation;
    const target = root.querySelector('#revisions')!, status = root.querySelector('#revision-status')!;
    async function next() { try {
        status.innerHTML = '<p>Reading revisions…</p>';
        const r = await load('revisions:' + id + ':' + token, () => client.getEventHistory(id, { pageSize: 20, pageToken: token }));
        if (gen !== generation)
            return;
        target.insertAdjacentHTML('beforeend', r.revisions.map(r => `<details class="notice" ${params.get('revision') === String(r.revision) ? 'open' : ''}><summary>Revision ${r.revision} · ${stamp(r.observedAt)} · ${e(r.event.status)}</summary><p>Stored ${stamp(r.ingestedAt)}</p>${ledger(r.event)}<button class="btn btn--outline" data-history-io="${r.revision}">Read stored I/O for revision ${r.revision}</button></details>`).join(''));
        target.querySelectorAll<HTMLButtonElement>('[data-history-io]').forEach(button => { button.onclick = () => enhancement(id, button.dataset.historyIo); });
        count += r.revisions.length;
        token = r.nextPageToken || undefined;
        depth++;
        preserveDepth('historyPages', depth);
        status.innerHTML = `<p class="status">${count} revisions loaded. ${token ? 'Partial history.' : 'Query complete.'}</p>${token ? '<button class="btn btn--outline">More revisions</button>' : ''}`;
        status.querySelector('button')?.addEventListener('click', next);
        return true;
    }
    catch (err) {
        status.innerHTML = errorBlock(err) + notice('Earlier revisions retained; history remains incomplete.');
        status.querySelector('button')?.addEventListener('click', next);
        return false;
    } }
    if (await next()) {
        while (depth < restorePages && token) {
            if (!await next())
                break;
        }
    }
    if (requestedPages > 10 && gen === generation)
        status.insertAdjacentHTML('beforeend', notice('Restored the first ten history pages. Continue manually to restore the remaining ' + (requestedPages - 10) + ' requested pages.'));
}
async function telemetry(node: string) { const own = generation; const hours = [1, 6, 24, 168].includes(Number(params.get('hours'))) ? Number(params.get('hours')) : 24; const root = document.querySelector('#deep')!; root.innerHTML = `<p>Reading last ${hours} hours of measurements…</p>`; try {
    const to = params.get('measurementTo') || new Date().toISOString(), from = params.get('measurementFrom') || new Date(Date.now() - hours * 3600000).toISOString();
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to) || Date.parse(to) - Date.parse(from) > 400 * 86400000)
        throw Error('Choose valid UTC bounds with from before to and no more than 400 days');
    const r = await load('telemetry:' + node + ':' + (params.get('measurementFrom') ? from + ':' + to : hours), () => client.getMeshTelemetry({ node, from, to }));
    if (own !== generation)
        return;
    root.innerHTML = '<h2>Measurements, not revisions.</h2>' + `<nav class="topic-nav" aria-label="Measurement window">${[1, 6, 24, 168].map(h => `<a href="${url({ hours: String(h), evidence: 'telemetry', measurementFrom: undefined, measurementTo: undefined })}" ${h === hours ? 'aria-current="page"' : ''}>Last ${h} hours</a>`).join('')}</nav><form id="measurement-window" class="actions"><label>From (UTC) <input name="from" type="datetime-local" value="${from.slice(0, 16)}" required></label><label>To (UTC, exclusive) <input name="to" type="datetime-local" value="${to.slice(0, 16)}" required></label><button class="btn btn--outline">Read measurement interval</button></form><p class="status">Choose at most 400 days per request. Narrow this interval if the response is truncated. Archive coverage below describes available retention.</p>` + notice(`Measurement clock: reading.reportedAt. Storage clock: receivedAt. ${r.truncated ? 'TRUNCATED: this window exceeded the response limit. Do not interpret this as a complete series.' : 'This requested window is not truncated.'} No rates are inferred from counters.`) + `<div id="measurement-chart"></div>${ledger({ ...r, samples: undefined })}<details><summary>Every returned sample & exact counters (${r.samples.length})</summary>${ledger(r.samples)}</details>`;
    root.querySelector('#measurement-window')?.addEventListener('submit', ev => { ev.preventDefault(); const d = new FormData(ev.target as HTMLFormElement); navigate(url({ evidence: 'telemetry', measurementFrom: new Date(String(d.get('from')) + 'Z').toISOString(), measurementTo: new Date(String(d.get('to')) + 'Z').toISOString() })); });
    renderTimeSeries(root.querySelector<HTMLElement>('#measurement-chart')!, { label: 'Reported battery voltage', unit: 'V', description: 'Null readings break the line; source cadence bounds gaps. When cadence is unknown, samples are isolated. Reboots and archive coverage are listed below.', maxGapMs: r.cadenceSeconds && Number(r.cadenceSeconds) < Number.MAX_SAFE_INTEGER / 2000 ? Number(r.cadenceSeconds) * 2000 : 1, series: [{ id: 'battery', label: 'Battery volts', points: r.samples.map(s => ({ time: Date.parse(s.reading.reportedAt || ''), value: s.reading.batteryVolts })) }] });
}
catch (err) {
    root.innerHTML = errorBlock(err);
    root.querySelector('button')?.addEventListener('click', () => telemetry(node));
} }
async function roads() { const viewGeneration = generation; const layers: MapLayer[] = ['road_segment', 'chain_control', 'message_sign', 'fire_weather', 'road_incident', 'weather_alert', 'earthquake', 'wildfire', 'evacuation', 'power', 'mesh_node', 'mesh_link', 'camera']; const layer = layers.includes(params.get('layer') as MapLayer) ? params.get('layer') as MapLayer : 'road_segment'; const scoped = place() || 'ebbetts-pass'; const r = await load('map:' + scoped + ':' + layer, () => client.getMapLayer(scoped, layer)); if (viewGeneration !== generation)
    return; content.innerHTML = head('Geographic projections / current', 'Along the way.', 'Road segments, chain controls and message signs are current condition features. They do not have event revision histories.') + timeRail() + notice(`Scope: ${scoped}. ${tense() !== 'now' ? 'This surface has no public historical or forecast archive; current projection shown. ' : ''}Empty features are not an all-clear: inspect response health. Coordinates use longitude, latitude.`) + `<nav class="topic-nav" aria-label="Geographic layers">${layers.map(l => `<a href="${url({ layer: l })}" ${l === layer ? 'aria-current="page"' : ''}>${e(fieldLabel(l.replaceAll('_', ' ')))}</a>`).join('')}</nav><h2>${e(fieldLabel(layer.replaceAll('_', ' ')))}</h2><div class="notice">${ledger(r.metadata)}</div>${r.features.map(f => `<section class="forecast"><p class="stamp">${e(f.properties.kind)} / ${e(f.properties.severity)}</p><h3>${e(f.properties.headline)}</h3><p class="source-text">${e(f.properties.description || f.properties.summary || '')}</p>${['WILDFIRE', 'EVACUATION', 'WEATHER_ALERT', 'EARTHQUAKE', 'ROAD_INCIDENT', 'POWER', 'MESH_NODE'].includes(f.properties.layer) ? `<a href="${url({ topic: f.properties.layer === 'MESH_NODE' ? 'MESH' : f.properties.layer, id: f.properties.id })}">Open full event and history →</a>` : ''}<details><summary>Location, source & all condition quantities</summary>${ledger(f)}</details></section>`).join('')}${!r.features.length ? notice('No features returned. Interpret this together with the layer source status above.') : ''}` + topicNav(); }
async function cameras() { const viewGeneration = generation; const r = await load('cameras:' + place(), () => client.listCameras({ place: place() })); if (viewGeneration !== generation)
    return; content.innerHTML = head('Media / current directory', 'A window onto the road.', 'Images belong to the upstream camera provider. Open a camera deliberately; no video autoplays and no footage archive is exposed.') + timeRail() + notice(`Directory source health: ${r.sourceStatus}. ${r.attribution}. ${tense() !== 'now' ? 'Only the current directory is available.' : ''}`) + r.cameras.map(c => `<section class="forecast"><h2>${e(c.name)}</h2><p>${e(c.description)}</p><div class="actions">${link(c.imageUrl, 'Open upstream image ↗')}${link(c.streamUrl, 'Open upstream stream ↗')}</div><details><summary>Camera location, refresh cadence & provenance</summary>${ledger(c)}</details></section>`).join('') + (!r.cameras.length ? notice('No camera entries returned. Out-of-service cameras may be omitted.') : '') + `<details><summary>Directory response metadata</summary>${ledger({ ...r, cameras: undefined })}</details>` + topicNav(); }
async function scanners() { const viewGeneration = generation; const r = await load('scanners:' + place(), () => client.listScanners({ place: place() })); if (viewGeneration !== generation)
    return; content.innerHTML = head('Listening / reference', 'Listen at the source.', 'These are configured scanner references, not recordings, transcripts, or a claim that a stream is healthy.') + timeRail() + ledger(r) + topicNav(); }
async function links() { const viewGeneration = generation; const window = params.get('window') || '72h'; const r = await load('links:' + window, () => client.listMeshLinks({ window })); if (viewGeneration !== generation)
    return; content.innerHTML = head('Radio / rolling observations', 'Who was heard together?', 'Observed edges describe receptions in a rolling window. They do not prove RF coverage, a complete topology, or a historical network replay.') + timeRail() + `<nav class="topic-nav" aria-label="Link window">${['24h', '72h', '168h'].map(w => `<a href="${url({ window: w })}" ${w === window ? 'aria-current="page"' : ''}>${w}</a>`).join('')}</nav>` + notice('Endpoints are public keys. Follow a radio node’s evidence for identity and measurements; many nodes have no position or monitor samples.') + `<a href="${nav('MESH', 'now')}">Explore radio identities →</a>` + `<p class="status">Applied window ${e(r.window)} · Generated ${stamp(r.generatedAt)} · ${r.links.length} observed edges</p>${r.links.map(l => `<details class="notice"><summary>${e(l.a.slice(0, 8))} ↔ ${e(l.b.slice(0, 8))} · ${l.observations} observations · ${l.daysActive} days</summary><p>Best SNR ${e(l.bestSnr)} dB (zero may mean unmeasured). Last seen ${stamp(l.lastSeen)}.</p><div class="actions"><a href="${url({ topic: 'MESH', id: 'meshcore:' + l.a })}">Read endpoint ${e(l.a.slice(0, 8))} →</a><a href="${url({ topic: 'MESH', id: 'meshcore:' + l.b })}">Read endpoint ${e(l.b.slice(0, 8))} →</a></div>${ledger(l)}</details>`).join('')}` + topicNav(); }
async function placePage() { const viewGeneration = generation; const scoped = params.get('focus') || place() || 'ebbetts-pass'; const [p, s] = await Promise.all([load('place:' + scoped, () => client.getPlace(scoped)), load('summary:' + scoped, () => client.getPlaceSummary(scoped))]); if (viewGeneration !== generation)
    return; content.innerHTML = head('Place / relationships', 'Where the evidence belongs.', 'A town is a point, a corridor a line, a county an area. Proximity attachments and source coverage differ; the directory is not a promise of equivalent monitoring.') + timeRail() + `<form class="resolve" id="resolve"><label for="address">Resolve a US address to the public place directory</label><input id="address" name="address" placeholder="Street, city, state" required><button class="btn btn--outline">Resolve place</button></form><div id="resolved"></div><nav class="topic-nav" aria-label="Places">${places.map(p => `<a href="${url({ focus: p.slug })}" ${p.slug === scoped ? 'aria-current="page"' : ''}>${e(p.name)}</a>`).join('')}</nav><h2>${e(p.name)}</h2><p class="actions"><a href="${url({ place: p.slug, topic: undefined, focus: undefined })}">Read this place across the three tenses →</a></p>${ledger(p)}<h2>The regional summary</h2>` + notice('Hazard mode excludes ambient burn and mesh. Roads severity can be higher than mode. Nullable evacuation counts remain unknown. Top hazards are a maximum of five; counts are summary-specific.') + ledger(s) + topicNav(); document.querySelector('#resolve')?.addEventListener('submit', async (ev) => { ev.preventDefault(); const address = new FormData(ev.target as HTMLFormElement).get('address') as string; const root = document.querySelector('#resolved')!; root.innerHTML = '<p>Resolving with the public Census-backed service…</p>'; try {
    const r = await load('resolve:' + address, () => client.resolvePlace({ address }));
    root.innerHTML = ledger(r);
}
catch (err) {
    root.innerHTML = errorBlock(err);
} }); }
async function sourcePage() { const viewGeneration = generation; sources = (await load('sources', () => client.listSources())).sources; if (viewGeneration !== generation)
    return; content.innerHTML = head('Provenance / current registry', 'How do we know?', 'Retrieval success means this browser received a response. Source health describes the upstream feed. They are different kinds of confidence.') + timeRail() + notice('Source status is current, not an uptime history. Reporter rows are health-only; zero poll intervals are not failures. Other condition services may expose health only on their own response.') + sources.map(s => `<section class="forecast"><p class="kicker">${e(s.kind)} / ${e(s.status)}</p><h2>${e(s.name || s.id)}</h2>${link(s.homepageUrl)}<details><summary>Attribution, refresh policy, attempts & last error</summary>${ledger(s)}</details></section>`).join('') + `<h2>The edges of this collection</h2><p class="intro">No public archive is exposed for current weather, forecast vintages, road conditions, signs, cameras or scanner audio. Raw mesh receptions, per-day link buckets, relay operations and burn staging diagnostics are not public datasets here. No private data or API writes are used.</p>` + topicNav(); }
async function render() { generation++; const own = generation; params = new URLSearchParams(location.search); if (params.has('chapter') && !params.has('topic'))
    params.set('topic', params.get('chapter')!); placeSelect.value = place() || ''; document.querySelector('#chapters')!.innerHTML = [['now', 'Now', '01'], ['ahead', 'Ahead', '02'], ['recorded', 'Recorded', '03']].map(([id, label, n]) => `<a href="${url({ tense: id, topic: undefined, id: undefined, revision: undefined })}" ${tense() === id ? 'aria-current="page"' : ''}><span>${n}</span>${label}</a>`).join('') + `<a href="${nav('places')}"><span>↗</span>Place directory</a><a href="${nav('sources')}"><span>↗</span>Source notes</a>`; content.innerHTML = '<p class="kicker">Reading live evidence…</p><h1>Every clock<br>has a source.</h1>'; try {
    const topic = params.get('topic');
    if (params.get('id'))
        await eventDetail(params.get('id')!);
    else if (!topic)
        await home();
    else if (topic === 'weather')
        await weather();
    else if (topic === 'roads')
        await roads();
    else if (topic === 'cameras')
        await cameras();
    else if (topic === 'scanners')
        await scanners();
    else if (topic === 'links')
        await links();
    else if (topic === 'places')
        await placePage();
    else if (topic === 'sources')
        await sourcePage();
    else if (topics.some(t => t[0] === topic))
        await events(topic as V1Layer);
    else
        content.innerHTML = head('Not found', 'A missing page.', 'Choose a subject below.') + topicNav();
    if (own !== generation)
        return;
    document.querySelector('#window')?.addEventListener('submit', ev => { ev.preventDefault(); const d = new FormData(ev.target as HTMLFormElement); navigate(url({ from: String(d.get('from')), to: String(d.get('to')) })); });
    document.title = `${params.get('topic') ? titleOf(params.get('topic')!) : 'The region'} · ${tense()} · Sierra Grid`;
}
catch (err) {
    if (own === generation) {
        content.innerHTML = head('Evidence unavailable', 'A gap in the reading.', 'The live request failed. This does not describe conditions on the ground.') + errorBlock(err) + topicNav();
    }
} }
function navigate(href: string) { historyState(href); render(); document.querySelector<HTMLElement>('#reading')?.focus(); window.scrollTo(0, 0); }
function preserveDepth(key: string, depth: number) { const q = new URLSearchParams(location.search); q.set(key, String(depth)); window.history.replaceState({}, '', location.pathname + '?' + q); params = q; }
function historyState(href: string) { window.history.pushState({}, '', href); }
document.addEventListener('click', ev => { const target = (ev.target as Element).closest<HTMLAnchorElement>('a'); if (target && target.origin === location.origin && !target.hash && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
    ev.preventDefault();
    navigate(target.pathname + target.search);
} const retry = (ev.target as Element).closest('[data-retry]'); if (retry && retry.isConnected && !retry.closest('#page-status,#revision-status,#deep'))
    render(); });
placeSelect.addEventListener('change', () => navigate(url({ place: placeSelect.value || undefined, id: undefined, revision: undefined, focus: undefined })));
window.addEventListener('popstate', () => render());
load('places', () => client.listPlaces()).then(r => { places = r.places; placeSelect.innerHTML = '<option value="">Whole collection</option>' + places.map(p => `<option value="${e(p.slug)}">${e(p.name)}</option>`).join(''); placeSelect.value = place() || ''; }).catch(() => { placeSelect.insertAdjacentHTML('afterend', '<p>Place directory unavailable. Other evidence remains accessible.</p>'); });
void render();
