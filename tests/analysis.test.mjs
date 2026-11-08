import test from 'node:test';
import assert from 'node:assert/strict';
import { createSierraClient } from '@sierragridteam/sdk';
import { createFixtureFetch, fixtureNodes, FIXTURE_NOW } from '@sierragridteam/sdk/fixtures';
import { samplePoints, heardAt } from '../src/lib/analysis.ts';
const client=createSierraClient({fetch:createFixtureFetch()});
test('zero is retained; missing battery stays null',async()=>{
  const {data}=await client.getMeshTelemetry({node:fixtureNodes[3].publicKey,from:'2026-11-06T12:00:00Z',to:FIXTURE_NOW});
  const points=samplePoints(data,'batteryPercent');
  assert.ok(points.some(p=>p.value===0));
  const unknown=structuredClone(data);unknown.samples[0].reading.batteryPercent=null;
  assert.equal(samplePoints(unknown,'batteryPercent')[0].value,null);
});
test('counter resets and cadence gaps cannot produce throughput',async()=>{
  const {data}=await client.getMeshTelemetry({node:fixtureNodes[3].publicKey,from:'2026-11-06T12:00:00Z',to:FIXTURE_NOW});
  const points=samplePoints(data,'packets');
  assert.ok(points.every(p=>p.value===null||p.value>=0));
  assert.ok(points.filter(p=>p.value===null).length>=2);
});
test('last relayed takes precedence over snapshot and last heard',()=>{
  assert.equal(heardAt({observedAt:'2030-01-01',mesh:{telemetry:{lastRelayedAt:'2026-11-01',lastHeardAt:'2026-11-02'}}}),'2026-11-01');
});
