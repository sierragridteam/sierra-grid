export const scenarios = ['normal', 'empty', 'stale', 'partial', 'unavailable'] as const;
export type Scenario = typeof scenarios[number];
export function readExplorerMode(search: string) {
  const params = new URLSearchParams(search);
  const mode = params.get('mode') === 'demo' ? 'demo' : 'live';
  const requested = params.get('scenario');
  const scenario: Scenario = scenarios.includes(requested as Scenario) ? requested as Scenario : 'normal';
  return { mode: mode as 'live' | 'demo', scenario };
}
