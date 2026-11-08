import test from 'node:test';
import assert from 'node:assert/strict';
import {samplePoints,activity} from '../src/lib/analysis.ts';
const archive=(counters,times,reboots=[])=>({cadenceSeconds:'60',reboots,samples:counters.map((n,i)=>({reading:{packetsReceived:n,reportedAt:new Date(times[i]).toISOString(),batteryPercent:i===0?0:null}}))});
test('activity prefers relayed packets, never event snapshot timestamps',()=>{assert.equal(activity({telemetry:{lastRelayedAt:'relay',lastHeardAt:'advert'}}),'relay');assert.equal(activity({telemetry:null}),null);});
test('packet rate preserves gaps and resets and uses exact large counter subtraction',()=>{const a=archive(['900719925474099300','900719925474099360','2','12','20'],[0,60000,120000,240000,300000],[new Date(120000).toISOString()]);assert.deepEqual(samplePoints(a,'packetsReceived').map(p=>p.value),[null,1,null,null,8/60]);});
test('zero gauges remain zero and unknown gauges remain null',()=>{assert.deepEqual(samplePoints(archive(['0','1'],[0,60000]),'batteryPercent').map(p=>p.value),[0,null]);});
import {collectPages} from '../src/lib/analysis.ts';
test('short pages continue by token and late failures preserve partial evidence',async()=>{const tokens=[];const result=await collectPages(async token=>{tokens.push(token);if(token==='two')throw Error('offline');return{items:token?[]:[1],nextPageToken:token?'two':'one'};});assert.deepEqual(tokens,['','one','two']);assert.deepEqual(result.items,[1]);assert.equal(result.failed,true);assert.equal(result.complete,false);});
