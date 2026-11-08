import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExplorerMode } from '../src/lib/mode.ts';

test('synthetic data is an explicit opt-in; default and unknown modes stay live', () => {
  for (const query of ['', '?scenario=normal', '?mode=typo']) {
    assert.equal(readExplorerMode(query).mode, 'live');
  }
  assert.deepEqual(readExplorerMode('?mode=demo&scenario=partial'), { mode: 'demo', scenario: 'partial' });
});

test('all review scenarios are reachable without changing production query state', () => {
  for (const scenario of ['normal', 'empty', 'stale', 'partial', 'unavailable']) {
    assert.equal(readExplorerMode(`?mode=demo&scenario=${scenario}&node=test`).scenario, scenario);
  }
  assert.equal(readExplorerMode('?mode=demo&scenario=typo').scenario, 'normal');
});
