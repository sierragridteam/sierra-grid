import { createExplorerContext } from './client';
import { SierraApiError } from '@sierragridteam/sdk';
import type { TimeSeriesChartElement, TimeSeries } from '@sierragridteam/design-system/lib/time-series';
import { lastActivity, seriesPoints, gapCount, type Body, type NodeEvent, type Metric } from './analysis';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const stamp = (value: string | null | undefined) => value ? new Date(value).toISOString().replace('T', ' ').replace(/:00\.000Z$|:00Z$/, ' UTC').replace('.000Z', ' UTC').replace('Z', ' UTC') : 'Not reported';
const urlSafe = (value: string) => { try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) ? esc(u.href) : '';
}
catch {
    return '';
} };
const errorText = (error: unknown) => error instanceof SierraApiError ? `Unavailable · ${error.status}. ${error.retryAfter ? `Retry after ${error.retryAfter} seconds.` : 'Try refreshing.'}` : 'Unavailable · request failed or response could not be validated. Try refreshing.';
const context = createExplorerContext(location.search), { client, mode, now } = context;
let params = new URLSearchParams(location.search), nodes: NodeEvent[] = [], links: Body<'listMeshLinks'> | undefined, epoch = 0, detailEpoch = 0, archiveEpoch = 0, archiveToken = '', archiveCount = 0;
const knownHours = ['24', '72', '168'];
let hours = knownHours.includes(params.get('hours') || '') ? Number(params.get('hours')) : 24;
let end = params.get('until') && Number.isFinite(Date.parse(params.get('until')!)) ? new Date(params.get('until')!) : now;
let selected = params.get('node') || '', compare = params.get('compare') || '';
let metric: Metric = ['battery', 'temperature', 'packets', 'snr'].includes(params.get('metric') || '') ? params.get('metric') as Metric : 'battery';
const windowBounds = () => ({ from: new Date(end.getTime() - hours * 3600000).toISOString(), to: end.toISOString() });
const name = (key: string) => nodes.find(n => n.mesh?.publicKey === key)?.mesh?.name || `${key.slice(0, 12)}… (outside index)`;
const nodeFor = (key: string) => nodes.find(n => n.mesh?.publicKey === key);
function syncURL(push = true) {
    params.set('hours', String(hours));
    params.set('until', end.toISOString());
    for (const [key, value] of Object.entries({ node: selected, compare, metric, q: $<HTMLInputElement>('search').value, filter: $<HTMLSelectElement>('filter').value }))
        value ? params.set(key, value) : params.delete(key);
    history[push ? 'pushState' : 'replaceState']({}, '', `${location.pathname}?${params}`);
}
function setControls() {
    $<HTMLSelectElement>('window').value = String(hours);
    $<HTMLInputElement>('until').value = end.toISOString().slice(0, 16);
    $<HTMLSelectElement>('metric').value = metric;
    $<HTMLInputElement>('search').value = params.get('q') || '';
    $<HTMLSelectElement>('filter').value = params.get('filter') || 'all';
    const b = windowBounds();
    $('bounds').textContent = `Archive: [${stamp(b.from)}, ${stamp(b.to)})`;
}
$('mode-label').textContent = mode === 'demo' ? `SYNTHETIC DEMO · ${context.scenario} scenario · not current conditions` : 'LIVE · public observations';
$('clock').textContent = `Reference ${stamp(now.toISOString())}`;
$('mode-switch').textContent = mode === 'demo' ? 'Switch to live' : 'Explore synthetic demo';
$('mode-switch').onclick = () => { const p = new URLSearchParams(location.search); p.set('mode', mode === 'demo' ? 'live' : 'demo'); for (const k of ['until', 'node', 'compare'])
    p.delete(k); location.search = p.toString(); };
const logo = document.querySelector<HTMLAnchorElement>('.logo')!;
logo.href = `/?mode=${mode}&scenario=${context.scenario}`;
setControls();
function renderNodes() {
    const query = $<HTMLInputElement>('search').value.toLowerCase(), filter = $<HTMLSelectElement>('filter').value;
    const found = nodes.filter(n => `${n.mesh?.name} ${n.mesh?.publicKey}`.toLowerCase().includes(query)).filter(n => filter === 'unknown' ? n.mesh?.telemetry?.admin?.batteryPercent == null : filter === 'low' ? (n.mesh?.telemetry?.admin?.batteryPercent != null && n.mesh.telemetry.admin.batteryPercent <= 20) : filter === 'unmonitored' ? !n.mesh?.telemetry?.admin : true);
    $('count').textContent = `${found.length} / ${nodes.length}`;
    $('nodes').innerHTML = found.length ? found.map(n => { const t = n.mesh?.telemetry, b = t?.admin?.batteryPercent; return `<button class="node" data-node="${esc(n.mesh?.publicKey)}" aria-pressed="${selected === n.mesh?.publicKey}"><strong>${esc(n.mesh?.name)}</strong><span class="meta"><span>${esc(n.mesh?.nodeType.replace('_', ' '))}</span><span>${b == null ? 'Battery unknown' : `${b}% battery`}</span></span>${!t?.admin ? '<span class="flag">No admin reading</span>' : b != null && b <= 20 ? '<span class="flag">Low reported battery</span>' : ''}</button>`; }).join('') : '<p class="muted">No matching node observations. This does not establish network availability.</p>';
    $<HTMLSelectElement>('compare').innerHTML = '<option value="">No comparison</option>' + nodes.filter(n => n.mesh?.publicKey !== selected).map(n => `<option value="${esc(n.mesh?.publicKey)}">${esc(n.mesh?.name)}</option>`).join('');
    $<HTMLSelectElement>('compare').value = compare;
}
const mapTemplate = $('map-host').firstElementChild!.cloneNode(true) as HTMLElement;
function renderMap() {
    const features: unknown[] = nodes.filter(n => n.geometry?.object).map(n => ({ type: 'Feature', geometry: n.geometry!.object, properties: { label: n.mesh?.name, description: `${n.mesh?.nodeType} · last activity ${stamp(lastActivity(n))}`, key: n.mesh?.publicKey } }));
    for (const l of links?.links || []) {
        const a = nodeFor(l.a)?.geometry?.object, b = nodeFor(l.b)?.geometry?.object;
        if (a?.type === 'Point' && b?.type === 'Point')
            features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [a.coordinates, b.coordinates] }, properties: { label: `${name(l.a)} ↔ ${name(l.b)}`, description: `${l.observations} observations; not coverage`, tone: 'brass' } });
    }
    const map = mapTemplate.cloneNode(true) as HTMLElement;
    map.querySelector('.ds-map-canvas')!.replaceChildren();
    map.dataset.features = JSON.stringify({ type: 'FeatureCollection', features });
    map.dataset.selectable = 'true';
    map.querySelector('[data-selection]')?.removeAttribute('hidden');
    map.querySelector('ul')?.remove();
    $('map-host').replaceChildren(map);
}
function renderLinks() {
    if (!links)
        return;
    $('link-count').textContent = `${links.links.length} links returned`;
    $('links').innerHTML = `<p class="small">Rolling ${esc(links.window)} · generated ${stamp(links.generatedAt)}. Link window ends at the server's current time, independently of the archive end.</p>` + (links.links.length ? links.links.map(l => `<div class="link"><div class="ends"><button class="text-button" data-node="${esc(l.a)}">${esc(name(l.a))}</button><span aria-label="undirected connection">↔</span><button class="text-button" data-node="${esc(l.b)}">${esc(name(l.b))}</button></div><p class="small">${l.observations} observations · best SNR ${l.bestSnr ?? 'unknown'} dB<br>Last seen ${stamp(l.lastSeen)}</p><button class="text-button compare-link" data-pair="${esc(l.a)}" data-peer="${esc(l.b)}">Compare endpoints →</button></div>`).join('') : '<p>No links returned for this window. This is not proof of no connectivity.</p>');
}
async function refresh() {
    const version = ++epoch;
    nodes = [];
    links = undefined;
    $('nodes').innerHTML = '<p>Loading node observations…</p>';
    $('links').textContent = 'Loading connections…';
    $('health').textContent = 'Loading source diagnostics…';
    $('health').className = 'notice';
    $('count').textContent = '—';
    $('link-count').textContent = '';
    const sourceTask = client.listSources().then(r => { if (version !== epoch)
        return; const sources = r.data?.sources.filter(s => s.id === 'meshcore') || []; $('health').textContent = sources.length ? sources.map(s => `${s.name} · ${s.status} · last success ${stamp(s.lastSuccessAt)}${s.lastError ? ' · ' + s.lastError : ''}`).join(' / ') : 'Mesh source diagnostics absent. Freshness unknown.'; $('health').classList.toggle('bad', !sources.length || sources.some(s => s.status !== 'OK')); }).catch(e => { if (version === epoch) {
        $('health').textContent = `Source diagnostics ${errorText(e)} Freshness unknown.`;
        $('health').classList.add('bad');
    } });
    const nodeTask = (async () => { let token = '', pages = 0; try {
        do {
            const r = await client.listEvents({ layer: ['MESH'], pageSize: 100, pageToken: token, geometryFormat: 'OBJECT' });
            if (version !== epoch)
                return;
            if (r.notModified)
                throw Error('No body');
            nodes.push(...r.data.events);
            token = r.data.nextPageToken;
            pages++;
        } while (token && pages < 20);
        renderNodes();
        if (token)
            $('nodes').insertAdjacentHTML('beforeend', '<p class="notice">Partial index: 20-page safety limit reached. Counts are loaded records only.</p>');
    }
    catch (e) {
        if (version !== epoch)
            return;
        renderNodes();
        $('nodes').insertAdjacentHTML('beforeend', `<p class="notice bad">Node index ${errorText(e)} ${nodes.length ? 'Loaded records are partial.' : ''}</p>`);
    } })();
    const linkTask = client.listMeshLinks({ window: `${hours}h` }).then(r => { if (version === epoch)
        links = r.data; }).catch(e => { if (version === epoch)
        $('links').textContent = `Connections ${errorText(e)}`; });
    await Promise.allSettled([sourceTask, nodeTask, linkTask]);
    if (version !== epoch)
        return;
    renderLinks();
    renderMap();
    if (selected)
        await openDetail(false);
}
async function openDetail(focus = true) {
    const version = ++detailEpoch;
    $('detail').hidden = false;
    renderNodes();
    $('node-title').textContent = name(selected);
    if (focus) {
        $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('node-title').focus({ preventScroll: true });
    }
    let node = nodeFor(selected);
    if (!node) {
        try {
            const result = await client.getEvent(`meshcore:${selected}`);
            if (version !== detailEpoch)
                return;
            node = result.data;
        }
        catch { }
    }
    if (version !== detailEpoch)
        return;
    const telemetry = node?.mesh?.telemetry, admin = telemetry?.admin;
    const activity = node ? lastActivity(node) : null;
    $('node-title').textContent = node?.mesh?.name || name(selected);
    $('node-facts').innerHTML = `<div class="facts"><div class="fact"><span>LAST ACTIVITY</span><strong>${activity ? `${Math.max(0, Math.round((now.getTime() - Date.parse(activity)) / 60000))}m` : 'Unknown'}</strong><small>${stamp(activity)}<br>${telemetry?.lastRelayedAt ? 'Relay timestamp' : 'Heard timestamp fallback'}</small></div><div class="fact"><span>BATTERY</span><strong>${admin?.batteryPercent ?? '—'}${admin?.batteryPercent != null ? '%' : ''}</strong><small>${admin?.batteryPercent == null ? 'Not reported' : admin.batteryPercentSource || 'Source unspecified'}<br>${stamp(admin?.reportedAt)}</small></div><div class="fact"><span>LAST SNR</span><strong>${telemetry?.snr ?? '—'}${telemetry?.snr != null ? ' dB' : ''}</strong><small>Current event reading</small></div><div class="fact"><span>OBSERVED PEERS</span><strong>${links ? links.links.filter(l => l.a === selected || l.b === selected).length : '—'}</strong><small>Returned rolling ${hours}h links<br>Not a completeness claim</small></div></div>`;
    $('identity').innerHTML = `<p>Public key <code>${esc(selected)}</code></p><p>Event ${esc(node?.id || 'Not found')} · revision ${node?.revision ?? 'unknown'} · event observed ${stamp(node?.observedAt)}</p><p>${esc(node?.provenance.sourceName || 'Source unavailable')} · fetched ${stamp(node?.provenance.fetchedAt)}</p><p>${esc(node?.provenance.attribution || '')}</p>${node?.provenance.sourceUrl && urlSafe(node.provenance.sourceUrl) ? `<a href="${urlSafe(node.provenance.sourceUrl)}">Original source ↗</a>` : ''}`;
    await loadTelemetry(version);
}
async function loadTelemetry(version = ++detailEpoch) {
    $('coverage').innerHTML = '<p class="coverage">Loading sampled telemetry…</p>';
    $('findings').innerHTML = '';
    await customElements.whenDefined('sierra-time-series');
    const chart = $<TimeSeriesChartElement>('history-chart');
    chart.series = [];
    const keys = [selected, ...(compare && compare !== selected ? [compare] : [])];
    const results = await Promise.allSettled(keys.map(node => client.getMeshTelemetry({ node, ...windowBounds() })));
    if (version !== detailEpoch)
        return;
    const series: TimeSeries[] = [], coverage: string[] = [], findings: string[] = [];
    results.forEach((result, i) => {
        const key = keys[i]!, label = name(key);
        if (result.status === 'rejected' || result.value.notModified) {
            coverage.push(`<p class="coverage error">${esc(label)}: ${errorText(result.status === 'rejected' ? result.reason : null)} <button class="text-button" data-retry-telemetry>Retry telemetry</button></p>`);
            return;
        }
        const data = result.value.data;
        const gaps = gapCount(data), cadence = Number(data.cadenceSeconds);
        coverage.push(`<p class="coverage ${data.truncated || !data.samples.length ? 'warning' : ''}"><strong>${esc(label)} · ${data.truncated ? 'Partial / truncated archive' : data.samples.length ? 'Returned archive' : 'No samples returned'}</strong><br>${data.samples.length} samples · cadence ${cadence > 0 ? `${cadence}s` : 'unknown'} · archive coverage (source metadata) ${stamp(data.coverage.from)} → ${stamp(data.coverage.to)} (${data.coverage.samples} samples).<br>Returned sample span: ${stamp(data.samples[0]?.receivedAt)} → ${stamp(data.samples.at(-1)?.receivedAt)}. ${data.truncated ? 'Do not infer complete history.' : !data.samples.length ? 'Unmonitored or unsampled is not zero.' : 'Coverage does not imply every interval was sampled.'}</p>`);
        series.push({ id: key, label, points: seriesPoints(data, metric) });
        findings.push(`<div class="finding"><strong>${esc(label)}</strong>${gaps == null ? 'Sampling cadence unknown.' : `${gaps} internal collection gap${gaps === 1 ? '' : 's'} detected at > 1.5× source cadence.`}<br>${data.reboots.length} reported reboot${data.reboots.length === 1 ? '' : 's'}${data.reboots.length ? ` · ${data.reboots.map(stamp).join(', ')}` : ''}.<br>${metric === 'packets' ? 'Packet rates omit resets, first samples and missing intervals.' : 'Missing samples and unknown values stay disconnected.'}</div>`);
    });
    $('coverage').innerHTML = coverage.join('');
    $('findings').innerHTML = findings.join('');
    const names = { battery: ['Battery history', '%'], temperature: ['Temperature history', '°C'], packets: ['Packet transmission rate', 'packets/min'], snr: ['Last reported SNR', 'dB'] } as const;
    const b = windowBounds();
    chart.options = { label: names[metric][0], unit: names[metric][1], description: 'Sample receipt time, UTC. Blank intervals are unknown. Open the data table for exact values.', series, timeDomain: [Date.parse(b.from), Date.parse(b.to)] };
}
function resetArchive() { archiveEpoch++; archiveToken = ''; archiveCount = 0; $('archive-table').hidden = true; $('archive-table').querySelector('tbody')!.innerHTML = ''; $('more-history').hidden = true; $('archive-status').textContent = 'Load the archive when you need to examine changes.'; }
async function loadArchive(more = false) {
    if (!more)
        resetArchive();
    const version = archiveEpoch;
    $('archive-status').textContent = 'Loading bounded revisions…';
    $<HTMLButtonElement>('load-history').disabled = true;
    $<HTMLButtonElement>('more-history').disabled = true;
    try {
        const r = await client.listHistory({ ...windowBounds(), layer: ['MESH', 'ROAD_INCIDENT'], pageSize: 25, pageToken: more ? archiveToken : undefined, geometryFormat: 'OBJECT' });
        if (version !== archiveEpoch)
            return;
        if (r.notModified)
            throw Error('No body');
        archiveToken = r.data.nextPageToken;
        archiveCount += r.data.revisions.length;
        $('archive-table').hidden = false;
        $('archive-table').querySelector('tbody')!.insertAdjacentHTML('beforeend', r.data.revisions.map(rev => `<tr><td>${stamp(rev.observedAt)}</td><td>${rev.event.mesh ? `<button class="text-button" data-node="${esc(rev.event.mesh.publicKey)}">${esc(rev.event.mesh.name)}</button>` : esc(rev.event.headline)}<br><small>${esc(rev.event.status)}${rev.event.enhancement ? ' · AI-enhanced text' : ''}</small></td><td>${rev.revision}</td><td>${esc(rev.event.provenance.sourceName)}<br><small>Ingested ${stamp(rev.ingestedAt)}</small></td></tr>`).join(''));
        $('archive-status').textContent = `${archiveCount} revisions loaded. ${archiveToken ? 'Partial result — another page is available.' : 'End of returned pages for this bounded query.'}${archiveCount ? '' : ' No revisions returned; this says nothing about telemetry availability.'}`;
        $('more-history').hidden = !archiveToken;
    }
    catch (e) {
        if (version === archiveEpoch)
            $('archive-status').textContent = `History ${errorText(e)}${archiveCount ? ' Previously loaded revisions are incomplete.' : ''}`;
    }
    finally {
        $<HTMLButtonElement>('load-history').disabled = false;
        $<HTMLButtonElement>('more-history').disabled = false;
    }
}
$('query').onsubmit = e => { e.preventDefault(); const value = $<HTMLInputElement>('until').value; const proposed = new Date(`${value}Z`); if (!Number.isFinite(proposed.getTime()))
    return; end = proposed; hours = Number($<HTMLSelectElement>('window').value); syncURL(); setControls(); resetArchive(); void refresh(); };
$('search').oninput = () => { renderNodes(); syncURL(false); };
$('filter').onchange = () => { renderNodes(); syncURL(); };
$('compare').onchange = () => { compare = $<HTMLSelectElement>('compare').value; syncURL(); void loadTelemetry(); };
$('metric').onchange = () => { metric = $<HTMLSelectElement>('metric').value as Metric; syncURL(); void loadTelemetry(); };
$('retry').onclick = () => void refresh();
$('load-history').onclick = () => void loadArchive();
$('more-history').onclick = () => void loadArchive(true);
$('close').onclick = () => { selected = ''; compare = ''; detailEpoch++; $('detail').hidden = true; renderNodes(); syncURL(); $('overview').scrollIntoView({ behavior: 'smooth' }); };
$('copy').onclick = async () => { try {
    await navigator.clipboard.writeText(location.href);
    $('copy').textContent = 'Link copied';
}
catch {
    $('copy').textContent = 'Copy address from browser';
} setTimeout(() => $('copy').textContent = 'Copy investigation link', 2500); };
function select(key: string) { if (compare === key)
    compare = ''; selected = key; syncURL(); void openDetail(); }
document.addEventListener('click', e => { const target = (e.target as Element).closest<HTMLElement>('[data-node],[data-retry-telemetry],[data-pair]'); if (target?.dataset.pair) {
    selected = target.dataset.pair;
    compare = target.dataset.peer || '';
    syncURL();
    void openDetail();
}
else if (target?.dataset.node)
    select(target.dataset.node);
else if (target?.hasAttribute('data-retry-telemetry'))
    void loadTelemetry(); });
document.addEventListener('feature-select', e => { const key = (e as CustomEvent).detail.feature.properties?.key; if (key)
    select(key); });
window.addEventListener('popstate', () => { params = new URLSearchParams(location.search); selected = params.get('node') || ''; compare = params.get('compare') || ''; metric = (params.get('metric') || 'battery') as Metric; hours = knownHours.includes(params.get('hours') || '') ? Number(params.get('hours')) : 24; end = new Date(params.get('until') || now.toISOString()); setControls(); resetArchive(); if (!selected) {
    detailEpoch++;
    $('detail').hidden = true;
} void refresh(); });
void refresh();
