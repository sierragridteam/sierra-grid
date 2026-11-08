import { createExplorerContext } from './client';
import { activity, samplePoints, collectPages } from './analysis';
import type { V1Event, MeshLink, V1MeshTelemetryArchive, V1EventRevision } from '@sierragridteam/sdk';
import type { TimeSeriesChartElement } from '@sierragridteam/design-system/lib/time-series';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const date = (s: string | null | undefined) => s ? new Date(s).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Not reported';
const short = (s: string) => s.slice(0, 8) + '…' + s.slice(-4);
const verdict = (s: string) => s === 'REACHABLE' ? 'Reachable' : s === 'UNREACHABLE' ? 'Unreachable' : 'Unmonitored';
let context = createExplorerContext(location.search), params = new URLSearchParams(location.search);
let nodes: V1Event[] = [], links: MeshLink[] = [], selected = '', generation = 0, archives: {
    event: V1Event;
    data: V1MeshTelemetryArchive;
}[] = [];
let listComplete = false, nodesAvailable = false, linksAvailable = false;
const value = (id: string) => $(id) as HTMLInputElement;
function url(changes: Record<string, string>) { const p = new URLSearchParams(location.search); for (const [k, v] of Object.entries(changes))
    v ? p.set(k, v) : p.delete(k); return '?' + p.toString(); }
function setState(changes: Record<string, string>) { history.pushState({}, '', url(changes)); params = new URLSearchParams(location.search); }
function name(key: string) { return nodes.find(n => n.mesh?.publicKey === key)?.mesh?.name || short(key); }
function nodeLink(key: string, label = name(key)) { return `<a class="btn btn--outline btn--sm" href="${esc(url({ node: key }))}" data-node="${esc(key)}">${esc(label)}</a>`; }
function restore() { params = new URLSearchParams(location.search); value('search').value = params.get('q') || ''; value('verdict').value = params.get('verdict') || ''; value('window').value = ['24', '72', '168'].includes(params.get('hours') || '') ? params.get('hours')! : '24'; value('metric').value = ['batteryPercent', 'temperatureC', 'lastSnrDb', 'packetsReceived'].includes(params.get('metric') || '') ? params.get('metric')! : 'batteryPercent'; value('scenario').value = context.scenario; value('place').value = params.get('place') || ''; selected = params.get('node') || ''; }
function filtered() { const q = value('search').value.toLowerCase(); return nodes.filter(n => (!value('place').value || n.placeIds.includes(value('place').value)) && (!value('verdict').value || n.mesh?.reachability === value('verdict').value) && (!q || `${n.mesh?.name} ${n.mesh?.publicKey}`.toLowerCase().includes(q))); }
function renderRoster() { const list = filtered(); $('count').textContent = nodesAvailable ? `${list.length} shown` : 'Unavailable'; $('nodes').innerHTML = list.length ? list.map(n => { const m = n.mesh!; return `<button class="node ${verdict(m.reachability).toLowerCase()}" data-node="${esc(m.publicKey)}" aria-pressed="${selected === m.publicKey}"><strong>${esc(m.name)}</strong><span class="node-meta"><span><i class="dot"></i>${verdict(m.reachability)}</span><span>${esc(m.nodeType.replace('_', ' '))}</span></span><span class="activity">${activity(m) ? 'Activity ' + date(activity(m)).slice(5, 16) + ' UTC' : 'Activity not reported'}</span></button>`; }).join('') : '<p class="empty">No matching node observations. This does not establish an empty or healthy network.</p>'; renderNetwork(); }
function renderNetwork() {
    const visible = new Set(filtered().map(n => n.mesh!.publicKey));
    const relevant = links.filter(l => visible.has(l.a) || visible.has(l.b));
    const keys = [...new Set([...visible, ...relevant.flatMap(l => [l.a, l.b])])];
    const shown = keys.slice(0, 40);
    const positions = new Map(shown.map((k, i) => { const angle = 2 * Math.PI * i / shown.length - Math.PI / 2; return [k, { x: 360 + Math.cos(angle) * 235, y: 150 + Math.sin(angle) * 108 }]; }));
    $('network').innerHTML = shown.length ? `<svg viewBox="0 0 720 300" role="group" aria-label="Schematic observed topology; use node index or connection evidence for all details">${relevant.map(l => { const a = positions.get(l.a), b = positions.get(l.b); return a && b ? `<line class="network-line" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${Math.min(4, 1 + Math.log10(Math.max(1, l.observations)))}"/>` : ''; }).join('')}${shown.map(k => { const p = positions.get(k)!; const label = name(k); return `<a href="${esc(url({ node: k }))}" data-node="${esc(k)}" aria-label="Inspect ${esc(label)}"><circle class="network-point ${k === selected ? 'selected' : ''}" cx="${p.x}" cy="${p.y}" r="8"/><text class="network-label" x="${p.x}" y="${p.y + 24}" text-anchor="middle">${esc(label.length > 25 ? label.slice(0, 22) + '…' : label)}</text><text class="network-key" x="${p.x}" y="${p.y + 38}" text-anchor="middle">${visible.has(k) ? '' : 'OUTSIDE FILTER · '}${esc(k.slice(0, 6))}</text></a>`; }).join('')}</svg>` : '<p class="empty">No connections to draw for this selection.</p>';
    $('link-count').textContent = linksAvailable ? `${relevant.length} observed links` : 'Unavailable';
    const tbody = document.querySelector('#overview tbody')!;
    tbody.innerHTML = !linksAvailable ? '<tr><td colspan="4">Connection evidence unavailable; no count can be established.</td></tr>' : relevant.length ? relevant.map(l => `<tr><td>${nodeLink(l.a)} ↔ ${nodeLink(l.b)}</td><td>${l.observations}</td><td>${l.daysActive}</td><td>${date(l.lastSeen)}</td></tr>`).join('') : '<tr><td colspan="4">No observed links in this selection; not evidence of no connectivity.</td></tr>';
    if (keys.length > 40)
        $('network').insertAdjacentHTML('beforeend', '<p class="fine">Schematic limited to 40 endpoints. Connection table retains all returned links.</p>');
}
async function load() {
    const run = ++generation;
    context = createExplorerContext(location.search);
    restore();
    $('clock').textContent = date(context.now.toISOString());
    $('mode-label').textContent = context.mode === 'demo' ? `DEMO / Synthetic observations · ${context.scenario}` : 'LIVE / Public SIERRA observations';
    $('mode-switch').textContent = context.mode === 'demo' ? 'Switch to live' : 'Switch to demo';
    value('scenario').disabled = context.mode !== 'demo';
    $('nodes').textContent = 'Loading node observations…';
    $('health').textContent = 'Loading source diagnostics…';
    $('detail').hidden = true;
    nodes = [];
    links = [];
    listComplete = false;
    nodesAvailable = linksAvailable = false;
    const results = await Promise.allSettled([context.client.listSources(), context.client.listPlaces(), context.client.listMeshLinks({ window: value('window').value + 'h' }), collectPages<V1Event>(async token => {
        const r = await context.client.listEvents({ layer: ['MESH'], pageSize: 100, pageToken: token });
        if(r.notModified) throw Error('Unexpected empty cache response');
        return {items:r.data.events,nextPageToken:r.data.nextPageToken};
    })]);
    if (run !== generation)
        return;
    const [sources, places, topology, events] = results;
    if (sources.status === 'fulfilled' && !sources.value.notModified) {
        const s = sources.value.data.sources.filter(s => s.id === 'meshcore' || s.kind === 'REPORTER');
        $('health').innerHTML = s.length ? s.map(s => { const stale = s.staleAfterSeconds > 0 && (!s.lastAttemptAt || context.now.getTime() - Date.parse(s.lastAttemptAt) > s.staleAfterSeconds * 1000); return `<strong>${esc(s.name)} · ${stale ? 'STALE' : esc(s.status)}</strong> — last successful check ${date(s.lastSuccessAt)}${s.lastError ? ' · ' + esc(s.lastError) : ''}`; }).join('<br>') : 'Source health is unknown: no mesh source diagnostics returned.';
    }
    else
        $('health').textContent = 'Source diagnostics unavailable. Freshness cannot be established.';
    if (places.status === 'fulfilled' && !places.value.notModified) {
        value('place').innerHTML = '<option value="">All places</option>' + places.value.data.places.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
        value('place').value = params.get('place') || '';
    }
    if (topology.status === 'fulfilled' && !topology.value.notModified) {
        links = topology.value.data.links;
        linksAvailable = true;
        $('link-status').textContent = `Applied link window ${topology.value.data.window} · generated ${date(topology.value.data.generatedAt)}. Link counts describe observed paths only.`;
    }
    else
        $('link-status').textContent = 'Connection evidence unavailable. Retry with Refresh observations; no topology conclusion is possible.';
    if (events.status === 'fulfilled') {
        nodesAvailable = events.value.pages > 0;
        nodes = events.value.items.filter(n => n.mesh);
        listComplete = events.value.complete;
        $('list-note').textContent = listComplete ? 'Node pagination exhausted. Filters apply to current place attachments.' : events.value.failed ? 'Node pagination failed. Returned observations are incomplete; refresh to retry.' : 'Partial node index: 20-page safety cap reached. Counts are lower bounds.';
    }
    else {
        $('list-note').textContent = 'Node observations unavailable. Refresh observations to retry.';
    }
    renderRoster();
    if (!nodesAvailable)
        $('nodes').innerHTML = '<p class="empty">Node observations unavailable. No availability conclusion can be drawn.</p>';
    value('compare').innerHTML = '<option value="">No comparison</option>' + nodes.map(n => `<option value="${esc(n.mesh!.publicKey)}">${esc(n.mesh!.name)}</option>`).join('');
    value('compare').value = params.get('compare') || '';
    if (selected)
        await inspect(selected, false);
}
async function findNode(key: string) { const known = nodes.find(n => n.mesh?.publicKey === key); if (known)
    return known; const r = await context.client.getEvent('meshcore:' + key); if (r.notModified || !r.data.mesh)
    throw Error('No mesh node detail returned'); return r.data; }
async function inspect(key: string, scroll = true) {
    selected = key;
    const run = ++generation;
    renderRoster();
    $('detail').hidden = false;
    $('node-title').textContent = 'Loading node evidence…';
    $('identity').innerHTML = '';
    $('connections').innerHTML = '';
    $('archive-status').textContent = 'Loading bounded telemetry and revisions…';
    $('archive-notes').innerHTML = '';
    $('history-status').textContent = 'Loading revision ledger…';
    document.querySelector('#revisions tbody')!.innerHTML = '';
    await customElements.whenDefined('sierra-time-series');
    $('telemetry-chart').hidden = true;
    archives = [];
    if (scroll)
        $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    let event: V1Event;
    try {
        event = await findNode(key);
    }
    catch {
        if (run !== generation)
            return;
        $('node-title').textContent = 'Node detail unavailable';
        $('history-status').textContent = 'Revision history unavailable without node detail.';
        $('revision-count').textContent = ''; 
        $('archive-status').textContent = 'This endpoint identity is preserved, but its event detail could not be loaded. Refresh to retry.';
        return;
    }
    if (run !== generation)
        return;
    const m = event.mesh!;
    const clock = activity(m);
    $('node-title').textContent = m.name;
    $('identity').innerHTML = `<p class="key">${esc(m.publicKey)}</p><div class="identity-grid"><div><small>Latest radio activity</small><strong>${date(clock)}</strong><p class="fine">${m.telemetry?.lastRelayedAt ? 'Relayed packet' : m.telemetry?.lastHeardAt ? 'Advert received' : 'No activity clock'} · not event revision time</p></div><div><small>Operator monitor</small><strong>${verdict(m.reachability)}</strong><p class="fine">Admin interface reachability</p></div><div><small>Latest battery reading</small><strong>${m.telemetry?.admin?.batteryPercent ?? 'Unknown'}${m.telemetry?.admin?.batteryPercent != null ? ' %' : ''}</strong><p class="fine">Measured ${date(m.telemetry?.admin?.reportedAt)}</p></div></div><p class="fine">Source: ${esc(event.provenance.sourceName)} · ${esc(event.provenance.attribution)} · fetched ${date(event.provenance.fetchedAt)}${/^https?:\/\//.test(event.provenance.sourceUrl) ? ` · <a href="${esc(event.provenance.sourceUrl)}" target="_blank" rel="noreferrer">Source ↗</a>` : ''}</p>`;
    const neighbors = [...new Set(links.filter(l => l.a === key || l.b === key).map(l => l.a === key ? l.b : l.a))];
    $('connections').innerHTML = `<p class="fine">Follow an observed neighbor · ${esc(value('window').value)}h link window</p><div class="connections">${neighbors.length ? neighbors.map(k => nodeLink(k)).join('') : 'No neighbor observations returned.'}</div>`;
    const to = context.now.toISOString(), from = new Date(context.now.getTime() - Number(value('window').value) * 3600000).toISOString();
    $('window-label').textContent = `Requested archive [${date(from)}, ${date(to)}) · end excluded`;
    const compare = params.get('compare');
    const events = [event];
    let comparisonFailed = false;
    if (compare && compare !== key) {
        try {
            events.push(await findNode(compare));
        }
        catch {
            comparisonFailed = true;
        }
    }
    if (run !== generation)
        return;
    const outcomes = await Promise.allSettled(events.map(async (e) => { const r = await context.client.getMeshTelemetry({ node: e.mesh!.publicKey, from, to }); if (r.notModified)
        throw Error('No response'); return { event: e, data: r.data }; }));
    if (run !== generation)
        return;
    const failed: string[] = comparisonFailed ? ['comparison node'] : [];
    outcomes.forEach((r, i) => r.status === 'fulfilled' ? archives.push(r.value) : failed.push(events[i].mesh!.name));
    $('archive-status').textContent = failed.length ? `Telemetry unavailable for ${failed.join(', ')}. Other returned evidence remains usable. Refresh to retry.` : 'Telemetry responses received. Read coverage below before drawing conclusions.';
    renderCharts();
    const ids = new Set(events.map(e => e.id));
    // The bounded archive supports layer filtering, not node IDs: fetch once, then select.
    const ledger = await collectPages<V1EventRevision>(async token => {
        const r = await context.client.listHistory({ layer:['MESH'],from,to,pageToken:token,pageSize:100 });
        if(r.notModified) throw Error('Unexpected empty cache response');
        return {items:r.data.revisions,nextPageToken:r.data.nextPageToken};
    });
    if(run!==generation) return;
    const rows=ledger.items.filter(r=>ids.has(r.event.id)).sort((a,b)=>b.observedAt.localeCompare(a.observedAt));
    $('revision-count').textContent = ledger.pages ? `· ${rows.length} loaded` : '· unavailable';
    $('history-status').textContent = ledger.failed ? 'Some revision history unavailable. Returned rows are incomplete; refresh to retry.' : !ledger.complete ? 'Partial history: 20-page cap reached. Narrow the window.' : 'All continuation tokens exhausted for this bounded query.';
    document.querySelector('#revisions tbody')!.innerHTML = rows.length ? rows.map(r => `<tr><td>${date(r.observedAt)}</td><td>${esc(r.event.mesh?.name || r.event.headline)}</td><td>${r.revision}</td><td>${r.event.mesh ? verdict(r.event.mesh.reachability) : 'Unknown'}</td></tr>`).join('') : '<tr><td colspan="4">No revisions returned in this window. This is not evidence of uninterrupted availability.</td></tr>';
}
function renderCharts() { const metric = value('metric').value; const chart = $<TimeSeriesChartElement>('telemetry-chart'); chart.hidden = false; const units: Record<string, string> = { batteryPercent: '%', temperatureC: '°C', lastSnrDb: 'dB', packetsReceived: 'packets/s' }; const cadences = archives.map(a => Number(a.data.cadenceSeconds) * 1000).filter(n => n > 0); const to = context.now.getTime(), from = to - Number(value('window').value) * 3600000; chart.options = { label: ($('metric') as HTMLSelectElement).selectedOptions?.[0]?.textContent || 'Sampled node telemetry', unit: units[metric], series: archives.map(a => ({ id: a.data.node, label: a.event.mesh!.name, points: samplePoints(a.data, metric) })), timeDomain: [from, to], ...(cadences.length ? { maxGapMs: Math.min(...cadences) * 1.5 } : {}) }; $('archive-notes').innerHTML = archives.map(a => { const d = a.data; const cadence = Number(d.cadenceSeconds) * 1000; const gaps = d.samples.slice(1).filter((sample, i) => sample.reading.reportedAt && d.samples[i].reading.reportedAt && cadence > 0 && Date.parse(sample.reading.reportedAt) - Date.parse(d.samples[i].reading.reportedAt!) > cadence * 1.5).length; return `<div class="archive-note"><strong>${esc(a.event.mesh!.name)} · ${d.truncated ? 'PARTIAL / TRUNCATED' : 'Returned archive'}</strong><br>${gaps ? `<br><strong>${gaps} collection gap${gaps === 1 ? '' : 's'} detected</strong> · intervals exceed 1.5× median cadence<br>` : ''}${d.samples.length} samples returned · ${d.coverage.samples} archived overall · median cadence ${d.cadenceSeconds ?? 'unknown'} seconds<br>Applied [${date(d.from)}, ${date(d.to)})<br>Archive coverage ${date(d.coverage.from)} → ${date(d.coverage.to)}${d.reboots.length ? `<br>Reboot boundaries: ${d.reboots.map(date).join(', ')}` : ''}${!d.samples.length ? '<br>No sampled evidence in this window; this does not mean zero activity.' : ''}${d.truncated ? '<br>Server cap reached; the series ends early. Narrow the lookback.' : ''}</div>`; }).join('') + '<p class="fine">Lines break at missing values and gaps greater than 1.5× returned median cadence. Paired charts use the smaller cadence, conservatively breaking both series. Packet rates use exact counter differences; first samples, reboots, counter decreases, unsafe integer deltas and collection gaps remain unknown.</p>'; }
$('filters').addEventListener('submit', e => e.preventDefault());
value('search').addEventListener('input', () => { setState({ q: value('search').value }); renderRoster(); });
for (const id of ['place', 'verdict'])
    value(id).addEventListener('change', () => { setState({ [id]: value(id).value }); renderRoster(); });
value('window').addEventListener('change', () => { setState({ hours: value('window').value }); void load(); });
value('metric').addEventListener('change', () => { setState({ metric: value('metric').value }); renderCharts(); });
value('compare').addEventListener('change', () => { setState({ compare: value('compare').value }); if (selected)
    void inspect(selected, false); });
$('refresh').addEventListener('click', () => void load());
$('mode-switch').addEventListener('click', () => { location.search = url({ mode: context.mode === 'demo' ? 'live' : 'demo' }); });
value('scenario').addEventListener('change', () => { location.search = url({ scenario: value('scenario').value }); });
$('close-detail').addEventListener('click', () => { generation++; selected = ''; setState({ node: '', compare: '' }); $('detail').hidden = true; renderRoster(); $('overview').scrollIntoView({ behavior: 'smooth' }); });
$('share').addEventListener('click', async () => { try {
    await navigator.clipboard.writeText(location.href);
    $('share').textContent = 'Link copied';
}
catch {
    $('share').textContent = 'Copy the URL from your address bar';
} });
document.addEventListener('click', e => { const target = (e.target as Element).closest<HTMLElement>('[data-node]'); if (target) {
    e.preventDefault();
    setState({ node: target.dataset.node! });
    void inspect(target.dataset.node!);
} });
window.addEventListener('popstate', () => void load());
void load();
