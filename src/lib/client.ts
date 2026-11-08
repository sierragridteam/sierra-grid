import { createSierraClient } from '@sierragridteam/sdk';
import { createFixtureFetch, FIXTURE_NOW } from '@sierragridteam/sdk/fixtures';
import { readExplorerMode } from './mode';

/** Call in the browser with location.search; never fetch production data at build time. */
export function createExplorerContext(search: string) {
  const { mode, scenario } = readExplorerMode(search);
  return {
    mode,
    scenario,
    now: mode === 'demo' ? new Date(FIXTURE_NOW) : new Date(),
    client: createSierraClient({
      timeoutMs: 12_000,
      ...(mode === 'demo' ? { fetch: createFixtureFetch({ scenario }) } : {}),
    }),
  };
}
