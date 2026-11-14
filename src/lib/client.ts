import { createSierraClient } from "@sierragridteam/sdk";

export const GRID_API_ORIGIN = "https://data.sierragridteam.org";
/** Read-only live data only. Query strings cannot switch the transport to fixtures. */
export function createExplorerContext(_search?: string, signal?: AbortSignal) {
  return {
    now: new Date(),
    client: createSierraClient({
      baseUrl: GRID_API_ORIGIN,
      timeoutMs: 20_000,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: signal
            ? AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])])
            : init?.signal,
        }),
    }),
  };
}
