import { createExplorerContext } from './client';
import { heardAt, isRecent, samplePoints, gapCount } from './analysis';
import { paginate, type V1Event, type MeshLink, type V1MeshTelemetryArchive, type V1EventRevision } from '@sierragridteam/sdk';
import type { TimeSeriesChartElement } from '@sierragridteam/design-system/lib/time-series';
const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const date = (at: string | null | undefined) => at ? new Date(at).toISOString().replace('T',' ').replace('.000Z',' UTC') : 'Unknown';
const shortKey = (key:string) => key.replace('meshcore:','').slice(0,10)+'…';
const safeUrl = (url:string) => { try { const u=new URL(url); return ['https:','http:'].includes(u.protocol)?esc(u.href):'#'; } catch { return '#'; } };
document.querySelector('.logo')?.removeAttribute('aria-label');
let ctx = createExplorerContext(location.search);
let params = new URLSearchParams(location.search);
let nodes: V1Event[] = [], links: MeshLink[] = [], linksError = '', listError = '', incomplete=false;
let epoch=0, detailEpoch=0;
let linkGeneratedAt: string | null = null;
let placeNames = new Map<string,string>();
const area = (n:V1Event) => n.areaLabel || n.placeIds.map(id=>placeNames.get(id)||id).join(', ') || 'Place not reported';
let archives = new Map<string,V1MeshTelemetryArchive>();
let archiveErrors = new Map<string,string>();
const get = (key:string, fallback='') => params.get(key) || fallback;
const hours = () => ['6','24','72'].includes(get('window')) ? Number(get('window')) : 24;
const bounds = () => { const requested=Date.parse(get('to')); const end=Number.isFinite(requested)?Math.min(requested,ctx.now.getTime()):ctx.now.getTime(); return {from:new Date(end-hours()*3600000).toISOString(),to:new Date(end).toISOString()}; };
const selected = () => nodes.find(n=>n.id===get('node'));
function setState(values:Record<string,string>, replace=false) {
  for(const [key,value] of Object.entries(values)) value ? params.set(key,value) : params.delete(key);
  history[replace?'replaceState':'pushState']({},'',`${location.pathname}?${params}`);
}
function applyControls() {
  $<HTMLInputElement>('search').value=get('q');
  $<HTMLSelectElement>('place').value=get('place');
  $<HTMLSelectElement>('evidence').value=get('evidence','all');
  $<HTMLSelectElement>('window').value=String(hours());
  $<HTMLSelectElement>('metric').value=get('metric','batteryPercent');
}
function visibleNodes() {
  const q=get('q').toLowerCase(), place=get('place'), evidence=get('evidence','all');
  return nodes.filter(n=>(!q || `${n.mesh?.name} ${n.mesh?.publicKey} ${n.headline}`.toLowerCase().includes(q)) && (!place || n.placeIds.includes(place)) && (evidence==='all' || evidence==='recent'&&isRecent(n,ctx.now.getTime()) || evidence==='quiet'&&!isRecent(n,ctx.now.getTime()) || evidence==='unmonitored'&&!n.mesh?.telemetry?.admin));
}
function nodeName(key:string) { return nodes.find(n=>n.mesh?.publicKey===key || n.id===key)?.mesh?.name || `Outside endpoint ${shortKey(key)}`; }
function selectNode(id:string, focus=true) {
  setState({node:id,compare:get('compare')===id?'':get('compare')});
  renderLedger(); renderNetwork(); void loadDetail(focus);
}
function renderLedger() {
  const visible=visibleNodes();
  $('node-count').textContent=`${visible.length}${incomplete?'+':''}`;
  $('list-status').textContent=listError ? `Node observations unavailable. ${listError}` : `${visible.length} matching of ${nodes.length}${incomplete?' loaded; result incomplete':' loaded nodes'}.`;
  $('nodes').innerHTML=visible.length ? visible.map(n=>{
    const recent=isRecent(n,ctx.now.getTime()), battery=n.mesh?.telemetry?.admin?.batteryPercent;
    return `<button class="node" data-node="${esc(n.id)}" aria-pressed="${get('node')===n.id}"><strong>${esc(n.mesh?.name || n.headline)}</strong><span class="state ${recent?'':'older'}">${recent?'HEARD ≤24H':heardAt(n)?'OLDER >24H':'UNKNOWN'}</span><span class="sub">${esc(area(n))} · ${esc(n.mesh?.nodeType.replace('_',' '))}</span><span class="battery">${battery==null?'— unknown':`${battery}%`}</span></button>`;
  }).join('') : `<p class="empty">${listError?'The node ledger cannot be read. Retry using Refresh.':nodes.length?'No nodes match these filters. Adjust the search, place or evidence filter.':'No node observations returned. An empty collection does not establish network health.'}</p>`;
  $('nodes').querySelectorAll<HTMLButtonElement>('[data-node]').forEach(b=>b.onclick=()=>selectNode(b.dataset.node!));
}
function renderNetwork() {
  const visible=visibleNodes();
  const keys=new Set(visible.map(n=>n.mesh!.publicKey));
  const relevant=links.filter(l=>keys.has(l.a)||keys.has(l.b));
  const allEndpoints=[...new Set([...keys,...relevant.flatMap(l=>[l.a,l.b])])];
  const selectedKey=selected()?.mesh?.publicKey;
  const connected=new Set(relevant.filter(l=>l.a===selectedKey||l.b===selectedKey).flatMap(l=>[l.a,l.b]));
  const degree=new Map<string,number>();for(const l of relevant){degree.set(l.a,(degree.get(l.a)||0)+1);degree.set(l.b,(degree.get(l.b)||0)+1);}
  const endpoints=allEndpoints.length>20?[...allEndpoints].sort((a,b)=>(a===selectedKey?-1:b===selectedKey?1:0)||Number(connected.has(b))-Number(connected.has(a))||(degree.get(b)||0)-(degree.get(a)||0)).slice(0,20):allEndpoints;
  const positions=new Map(endpoints.map((key,i)=>[key,{x:300+Math.cos(-Math.PI/2+i*2*Math.PI/endpoints.length)*215,y:157+Math.sin(-Math.PI/2+i*2*Math.PI/endpoints.length)*112}]));
  $('link-count').textContent=linksError?'Unavailable':`${relevant.length} observed links · ${hours()}h`;
  $('link-status').textContent=linksError || `Link window: last ${hours()}h ending ${date(linkGeneratedAt)}. Diagram is schematic; distance has no meaning.${allEndpoints.length>20?` Showing 20 of ${allEndpoints.length} endpoints, prioritizing the selected node and its neighbors, then observed degree. Use filters to narrow.`:''}`;
  $('network').innerHTML=endpoints.length ? `<svg viewBox="0 0 600 330" aria-label="Observed connection diagram" role="group">${relevant.filter(l=>positions.has(l.a)&&positions.has(l.b)).map(l=>{const a=positions.get(l.a)!,b=positions.get(l.b)!;return `<line class="net-link ${l.a===selectedKey||l.b===selectedKey?'active':''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;}).join('')}${endpoints.map(key=>{const p=positions.get(key)!,node=nodes.find(n=>n.mesh?.publicKey===key);return `<g class="net-node ${selectedKey===key?'selected':''}" ${node?`role="button" tabindex="0" data-node="${esc(node.id)}" aria-label="Investigate ${esc(nodeName(key))}"`:''}><circle cx="${p.x}" cy="${p.y}" r="${selectedKey===key?11:8}"/><text text-anchor="${p.x<140?'start':p.x>460?'end':'middle'}" x="${p.x}" y="${p.y+25}">${esc(nodeName(key))}</text>${!keys.has(key)?`<text text-anchor="middle" x="${p.x}" y="${p.y+40}">outside filter</text>`:''}</g>`;}).join('')}</svg>` : `<p class="small">${linksError?'Connection observations unavailable.':'No endpoints to draw for this selection.'}</p>`;
  $('network').querySelectorAll<SVGGElement>('[data-node]').forEach(el=>{el.onclick=()=>selectNode(el.dataset.node!);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectNode(el.dataset.node!);}};});
}
function renderMap() {
  const old=$('map-holder').querySelector('sierra-geo-map')!;
  const map=old.cloneNode(true) as HTMLElement;
  map.querySelector('.ds-map-canvas')!.replaceChildren();
  map.dataset.features=JSON.stringify({type:'FeatureCollection',features:visibleNodes().map(n=>({type:'Feature',geometry:n.geometry?.object || null,properties:{label:n.mesh?.name,description:area(n),id:n.id}}))});
  old.replaceWith(map);
  map.addEventListener('feature-select',(event)=>{const id=(event as CustomEvent).detail.feature.properties.id;if(id)selectNode(id);});
}
function renderNeighbors(node:V1Event) {
  const connected=links.filter(l=>l.a===node.mesh?.publicKey||l.b===node.mesh?.publicKey);
  $('neighbors').innerHTML=linksError?`<p class="error-note">Links unavailable: ${esc(linksError)}</p>`:connected.length?connected.map(l=>{
    const key=l.a===node.mesh!.publicKey?l.b:l.a,n=nodes.find(n=>n.mesh?.publicKey===key);
    return `<div class="evidence-item neighbor"><div>${n?`<button data-node="${esc(n.id)}">${esc(nodeName(key))} →</button>`:`<strong>${esc(nodeName(key))}</strong>`}<p title="${esc(key)}">${esc(shortKey(key))} · ${l.observations} observations · best SNR ${l.bestSnr} dB<br/>Last seen ${date(l.lastSeen)}</p><details class="endpoint-key"><summary>Endpoint identity</summary><code>${esc(key)}</code></details></div></div>`;
  }).join(''):'<p class="small">No links returned for this node in this window. This does not prove isolation.</p>';
  $('neighbors').querySelectorAll<HTMLButtonElement>('[data-node]').forEach(b=>b.onclick=()=>selectNode(b.dataset.node!));
}
function renderChart() {
  const metric=get('metric','batteryPercent');
  const labels:Record<string,[string,string]>={batteryPercent:['Battery','%'],lastSnrDb:['Signal-to-noise','dB'],lastRssiDbm:['Received signal','dBm'],packets:['Received packets','packets/min'],temperatureC:['Temperature','°C']};
  const [label,unit]=labels[metric] || labels.batteryPercent;
  const selectedIds=[...new Set([get('node'),get('compare')].filter(Boolean))];
  const cadences=selectedIds.map(id=>Number(archives.get(id)?.cadenceSeconds)*1000).filter(n=>n>0);
  const chart=$<TimeSeriesChartElement>('history-chart');
  chart.options={label:`${label} · sampled history`,unit,timeDomain:[Date.parse(bounds().from),Date.parse(bounds().to)],maxGapMs:cadences.length?Math.min(...cadences)*1.5:1,series:selectedIds.flatMap(id=>{const a=archives.get(id),n=nodes.find(n=>n.id===id);return a?[{id,label:n?.mesh?.name||id,points:samplePoints(a,metric)}]:[];})};
  $('archive-status').innerHTML=selectedIds.map(id=>{const a=archives.get(id),name=nodes.find(n=>n.id===id)?.mesh?.name || id;if(archiveErrors.has(id))return `<div class="error-note">${esc(name)}: telemetry unavailable. ${esc(archiveErrors.get(id))} Use Refresh to retry.</div>`;return a?`<div class="${a.truncated?'warning-note':''}"><strong>${esc(name)}:</strong> ${a.samples.length} returned samples${a.truncated?' · PARTIAL / TRUNCATED — not a complete record':''}. Coverage reports ${a.coverage.samples} samples, ${date(a.coverage.from)} → ${date(a.coverage.to)}. ${a.samples.length?'':'No numeric evidence of availability.'}</div>`:'';}).join('');
  $('findings').innerHTML=selectedIds.map(id=>{const a=archives.get(id);if(!a)return '';const gaps=gapCount(a),name=nodes.find(n=>n.id===id)?.mesh?.name;return `<div class="evidence-item"><strong>${esc(name)} · ${a.cadenceSeconds?`${a.cadenceSeconds}s sampling cadence`:'cadence unknown'}</strong><p>${gaps===null?'Gap detection unavailable without cadence.':`${gaps} interior collection gap${gaps===1?'':'s'} above 1.5× cadence.`} ${a.reboots.length} reported reboot${a.reboots.length===1?'':'s'}${a.reboots.length?`: ${a.reboots.map(date).join(', ')}`:'.'}<br/>Null readings remain unknown. ${metric==='packets'?'Packet rates exclude counter resets, reboot boundaries and collection gaps.':'Lines break over missing readings and cadence gaps.'} Coverage outside returned samples is not inferred.</p></div>`;}).join('');
}
async function loadDetail(focus=false) {
  const token=++detailEpoch,node=selected();
  $('detail').hidden=!node;
  if(!node)return;
  $('detail-title').textContent=node.mesh?.name || node.headline;
  if(focus){$('detail').scrollIntoView({behavior:'smooth',block:'start'});$('detail-title').focus({preventScroll:true});}
  $('identity').innerHTML=`<div><strong>${esc(area(node))} · ${esc(node.mesh?.nodeType)}</strong><br/><span class="key">${esc(node.mesh?.publicKey)}</span></div><div>Last relayed / heard<br/><strong>${date(heardAt(node))}</strong></div><div>Admin measured<br/><strong>${date(node.mesh?.telemetry?.admin?.reportedAt)}</strong></div><div><a href="${safeUrl(node.provenance.sourceUrl)}" target="_blank" rel="noreferrer">${esc(node.provenance.sourceName)} ↗</a><br/>${esc(node.provenance.attribution)}${node.enhancement?' · Contains AI-enhanced text':''}</div>`;
  $<HTMLSelectElement>('compare').innerHTML='<option value="">No comparison</option>'+nodes.filter(n=>n.id!==node.id).map(n=>`<option value="${esc(n.id)}">${esc(n.mesh?.name)}</option>`).join('');
  $<HTMLSelectElement>('compare').value=get('compare');
  $<HTMLInputElement>('archive-end').value=bounds().to.slice(0,16);
  $<HTMLInputElement>('archive-end').max=ctx.now.toISOString().slice(0,16);
  $('bounds').textContent=`[ ${date(bounds().from)} , ${date(bounds().to)} ) · explicit ${hours()}h archive window. Links use the latest rolling window.`;
  renderNeighbors(node);
  archives=new Map();archiveErrors=new Map();
  $('archive-status').textContent='Loading bounded telemetry…';
  $<TimeSeriesChartElement>('history-chart').series=[];
  $('findings').textContent='Awaiting sampled evidence.';
  const ids=[...new Set([node.id,get('compare')].filter(id=>nodes.some(n=>n.id===id)))];
  void loadRevisions(node,token);
  await Promise.all(ids.map(async id=>{try{const n=nodes.find(n=>n.id===id)!;const r=await ctx.client.getMeshTelemetry({node:n.mesh!.publicKey,...bounds()});if(token===detailEpoch&&r.data)archives.set(id,r.data);}catch(e){if(token===detailEpoch)archiveErrors.set(id,e instanceof Error?e.message:'Request failed');}}));
  if(token===detailEpoch)renderChart();
}
async function loadRevisions(node:V1Event,token:number) {
  $('revision-status').textContent='Loading event revisions…';$('revision-count').textContent='';
  const body=$('revisions').querySelector('tbody')!;body.replaceChildren();
  const revisions:V1EventRevision[]=[];let pending=false;
  try {
    for await(const page of paginate(pageToken=>ctx.client.getEventHistory(node.id,{...bounds(),pageToken,pageSize:100}),10)) {revisions.push(...page.revisions);pending=!!page.nextPageToken;}
    if(token!==detailEpoch)return;
    $('revision-count').textContent=`(${revisions.length}${pending?'+':''})`;
    $('revision-status').textContent=pending?'Partial revision trail: stopped at 10 pages.':revisions.length?'All returned pages read for this bounded window.':'No revisions in this window.';
    body.innerHTML=revisions.map(r=>`<tr><td>${date(r.observedAt)}</td><td>${r.revision}</td><td>${esc(r.event.status)}</td><td>${esc(r.event.provenance.sourceName)}</td></tr>`).join('');
  }catch(e){if(token===detailEpoch)$('revision-status').textContent=`Revision history unavailable. ${e instanceof Error?e.message:''}`;}
}
async function load() {
  const token=++epoch;++detailEpoch;ctx=createExplorerContext(location.search);
  nodes=[];links=[];listError='';linksError='';incomplete=false;
  $('detail').hidden=true;$('list-status').textContent='Loading node observations…';$('nodes').replaceChildren();$('network').innerHTML='<p>Reading observed connections…</p>';
  const home=new URLSearchParams(params);home.delete('node');home.delete('compare');
  document.querySelector<HTMLAnchorElement>('.logo')!.href=`?${home}`;
  const demo=ctx.mode==='demo';document.querySelector('.modebar')!.classList.toggle('demo',demo);
  $('mode-label').textContent=demo?`SYNTHETIC DEMO · ${ctx.scenario} · not current conditions`:'LIVE · public observations';
  $('clock').textContent=`Reference ${date(ctx.now.toISOString())}`;
  const other=new URLSearchParams(params);other.set('mode',demo?'live':'demo');other.delete('node');other.delete('compare');
  $<HTMLAnchorElement>('mode-switch').href=`?${other}`;$('mode-switch').textContent=demo?'Switch to live ↗':'Explore synthetic demo ↗';
  const results=await Promise.allSettled([
    (async()=>{const records:V1Event[]=[];for await(const page of paginate(pageToken=>ctx.client.listEvents({layer:['MESH'],pageSize:100,pageToken}),20)){records.push(...page.events);incomplete=!!page.nextPageToken;}return records;})(),
    ctx.client.listMeshLinks({window:`${hours()}h`}),ctx.client.listSources(),ctx.client.listPlaces()
  ]);
  if(token!==epoch)return;
  const [events,connections,sources,places]=results;
  if(events.status==='fulfilled')nodes=events.value;else listError=events.reason?.message || 'Request failed';
  if(connections.status==='fulfilled'){links=connections.value.data?.links || [];linkGeneratedAt=connections.value.data?.generatedAt || null;}else linksError=`Observed links unavailable. ${connections.reason?.message || 'Request failed'}`;
  if(sources.status==='fulfilled'&&sources.value.data){const mesh=sources.value.data.sources.filter(s=>s.id.includes('mesh')||s.name.toLowerCase().includes('mesh'));$('health').classList.toggle('warning',mesh.some(s=>s.status!=='OK'));$('health').textContent=mesh.length?mesh.map(s=>`${s.name}: ${s.status} · last successful collection ${date(s.lastSuccessAt)}${s.lastError?` · ${s.lastError}`:''}`).join(' | '):'Mesh source health not reported. Observation freshness must be judged independently.';}else{$('health').classList.add('warning');$('health').textContent='Source diagnostics unavailable. Freshness cannot be confirmed.';}
  if(places.status==='fulfilled'&&places.value.data){placeNames=new Map(places.value.data.places.map(p=>[p.id,p.name]));$<HTMLSelectElement>('place').innerHTML='<option value="">All places</option>'+places.value.data.places.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');}
  applyControls();renderLedger();renderNetwork();renderMap();await loadDetail();
}
$('filters').onsubmit=e=>e.preventDefault();
$<HTMLInputElement>('search').oninput=()=>{setState({q:$<HTMLInputElement>('search').value},true);renderLedger();renderNetwork();renderMap();};
for(const id of ['place','evidence'])$<HTMLSelectElement>(id).onchange=()=>{setState({[id]:$<HTMLSelectElement>(id).value});renderLedger();renderNetwork();renderMap();};
$<HTMLSelectElement>('window').onchange=()=>{setState({window:$<HTMLSelectElement>('window').value});void load();};
$<HTMLSelectElement>('metric').onchange=()=>{setState({metric:$<HTMLSelectElement>('metric').value});renderChart();};
$<HTMLSelectElement>('compare').onchange=()=>{setState({compare:$<HTMLSelectElement>('compare').value});void loadDetail();};
$<HTMLInputElement>('archive-end').onchange=()=>{const value=$<HTMLInputElement>('archive-end').value;const at=Date.parse(value+'Z');if(!Number.isFinite(at))return;setState({to:new Date(Math.min(at,ctx.now.getTime())).toISOString()});void loadDetail();};
$('refresh').onclick=()=>void load();
$('close').onclick=()=>{setState({node:'',compare:''});++detailEpoch;$('detail').hidden=true;renderLedger();renderNetwork();$('ledger-title').scrollIntoView({behavior:'smooth'});$('nodes').querySelector<HTMLButtonElement>('.node')?.focus({preventScroll:true});};
$('copy').onclick=async()=>{setState({to:bounds().to});try{await navigator.clipboard.writeText(location.href);$('copy-status').textContent='Investigation link copied.';}catch{$('copy-status').textContent='Copy the current address from your browser.';}};
window.addEventListener('popstate',()=>{params=new URLSearchParams(location.search);applyControls();void load();});
await customElements.whenDefined('sierra-time-series');
applyControls();void load();
