import type { State } from "./state";
import { esc, fmt } from "./render";
import { localInput, parseLocalInput } from "./time";

/** Time belongs to the evidence being inspected, never to global navigation. */
export function mountPeriod(
  host: HTMLElement,
  state: State,
  go: (patch: Partial<State>) => void,
  signal: AbortSignal,
) {
  if (state.topic !== "mesh" && state.topic !== "changes" && state.mode !== "history") return;
  if (state.topic === "mesh" && !state.node) return;
  const mesh = state.topic === "mesh";
  const presets = mesh
    ? ([
        ["6 hours", 0.25],
        ["24 hours", 1],
        ["7 days", 7],
      ] as const)
    : ([
        ["30 days", 30],
        ["90 days", 90],
        ["1 year", 365],
      ] as const);
  const duration = (Date.parse(state.to) - Date.parse(state.from)) / 86400000;
  host.hidden = false;
  host.innerHTML = `<div class="period-controls"><strong>${mesh ? "Telemetry" : "Report history"}</strong><div class="period-presets" role="group" aria-label="${mesh ? "Telemetry" : "History"} period">${presets.map(([label, days]) => `<button class="btn btn--ghost btn--sm" type="button" data-days="${days}" aria-pressed="${Math.abs(duration - days) < 0.001 && Date.now() - Date.parse(state.to) < 300000}">${label}</button>`).join("")}${!mesh ? '<button type="button" class="btn btn--ghost btn--sm" data-custom>Choose dates</button>' : ""}</div><span>${state.timeExplicit || mesh ? esc(fmt(state.from)) + " – " + esc(fmt(state.to)) : "Through the latest available reports"}</span></div>${!mesh ? `<form class="period-custom" hidden aria-label="History dates"><label class="field">From (Pacific)<input class="input" type="datetime-local" name="from" required value="${localInput(state.from)}"></label><label class="field">To (Pacific)<input class="input" type="datetime-local" name="to" required value="${localInput(state.to)}"></label><button class="btn btn--primary btn--sm" type="submit">Apply dates</button><p class="field__help" role="status">Up to one year. A newly entered repeated autumn hour uses its first occurrence.</p></form>` : ""}`;
  host.addEventListener(
    "click",
    (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button",
      );
      if (button?.dataset.days) {
        const to = Date.now();
        go({
          from: new Date(
            to - Number(button.dataset.days) * 86400000,
          ).toISOString(),
          to: new Date(to).toISOString(),
          mode: "history",
          timeExplicit: true,
          browserPages: 1,
        });
      } else if (button?.hasAttribute("data-custom")) {
        const form = host.querySelector<HTMLFormElement>("form")!;
        form.hidden = false;
        form.querySelector<HTMLInputElement>("input")?.focus();
      }
    },
    { signal },
  );
  host.querySelector("form")?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      const input = new FormData(form);
      const parse = (key: "from" | "to") =>
        String(input.get(key)) === localInput(state[key])
          ? Date.parse(state[key])
          : parseLocalInput(String(input.get(key)));
      const from = parse("from"),
        to = parse("to");
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from >= to ||
        to - from > 366 * 86400000
      ) {
        form.querySelector('[role="status"]')!.textContent =
          "Choose a valid interval up to 366 days, with From before To.";
        return;
      }
      go({
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        mode: "history",
        timeExplicit: true,
      });
    },
    { signal },
  );
}
