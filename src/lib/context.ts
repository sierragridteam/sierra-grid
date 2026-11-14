import { createExplorerContext } from "./client";
import type { State } from "./state";
import { regionTimeZone } from "./time";
import type {
  LineSeries as TimeSeries,
} from "@sierragridteam/design-system/lib/chart-model";
import type { LineChartElement } from "@sierragridteam/design-system/lib/charts";
export type Context = {
  root: HTMLElement;
  signal: AbortSignal;
  state: State;
  client: ReturnType<typeof createExplorerContext>["client"];
  $: (id: string) => HTMLElement;
  chart: (
    label: string,
    unit: string,
    series: TimeSeries[],
    bounds?: [number, number],
    gap?: number,
  ) => void;
};
export async function data<T>(
  p: Promise<
    { notModified: false; data: T } | { notModified: true; data: undefined }
  >,
): Promise<T> {
  const r = await p;
  if (r.notModified) throw new Error("No response body returned");
  return r.data;
}
export function makeContext(
  root: HTMLElement,
  state: State,
  signal: AbortSignal,
): Context {
  const $ = (id: string) => {
    const el = root.querySelector<HTMLElement>("#" + id);
    if (!el) throw new Error("Missing view element: " + id);
    return el;
  };
  const { client } = createExplorerContext(undefined, signal);
  return {
    root,
    state,
    signal,
    client,
    $,
    chart(label, unit, series, bounds, gap) {
      if (signal.aborted) return;
      $("chart-wrap").hidden = false;
      const options = {
        label,
        timeZone: regionTimeZone,
        decimals: unit === "V" ? 2 : 1,
        unit,
        series,
        timeDomain: bounds,
        maxGapMs: gap,
      };
      ($("chart") as LineChartElement).options = options;
    },
  };
}
