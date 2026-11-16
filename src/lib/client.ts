import { createSierraClient } from "@sierragridteam/sdk";

const PUBLIC_API = "https://data.sierragridteam.org";
/**
 * The API the pages read. Always the public one in a production build. A
 * development server may point at another (PUBLIC_GRID_API_ORIGIN, for a
 * sierra-data change that is not deployed yet); the condition is a build-time
 * constant, so a production bundle carries no switch.
 */
const devOrigin = (import.meta.env?.DEV && import.meta.env.PUBLIC_GRID_API_ORIGIN?.replace(/\/$/, "")) || "";
/** "//host" takes the page's own scheme, for a proxy that serves both. */
export const GRID_API_ORIGIN: string = !devOrigin ? PUBLIC_API
  : devOrigin.startsWith("//") && typeof location !== "undefined" ? location.protocol + devOrigin : devOrigin;
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
