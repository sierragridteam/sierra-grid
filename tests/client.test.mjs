import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerContext } from '../src/lib/client.ts';

test('legacy demo query cannot replace the real Grid transport', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => { requests.push(String(url)); throw new Error('Blocked network for transport assertion'); };
  try {
    const context = createExplorerContext('?mode=demo&scenario=normal');
    await assert.rejects(context.client.listSources(), /Blocked network/);
    assert.deepEqual(requests, ['https://data.sierragridteam.org/api/v1/sources']);
    assert.equal('scenario' in context, false);
  } finally { globalThis.fetch = original; }
});
