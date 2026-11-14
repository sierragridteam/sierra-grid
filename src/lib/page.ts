import { upgradeSelects } from "./select";
import { definePage, installNavigation, navigate, type PageContext } from "@sierragridteam/design-system/lib/app";
import { changeView, parseState, stateUrl, type State } from "./state";
import { viewFor } from "../config/views";
import { makeContext } from "./context";
import { esc, fmt } from "./render";
import { installDrawer } from "./drawer";
import { mountPeriod } from "./period";
import type { Context } from "./context";

const modules = import.meta.glob<{ mount: (ctx: Context) => Promise<void> }>(
  "./views/*.ts",
);
let installed = false;
export function mountExplorer() {
  if (installed) return;
  installed = true;
  installNavigation();
  document.addEventListener("astro:before-preparation", () => {
    document.querySelector("#content")?.setAttribute("aria-busy", "true");
  });
  definePage(() => true, run);
}
async function run({ root: next, signal }: PageContext) {
  // The 404 page is static: it has the shell (so the drawer works) but no view to mount,
  // and its address must stay as typed rather than be normalised to a real route.
  if (next.dataset.view === "not-found") {
    installDrawer(signal);
    next.querySelector("#content")?.setAttribute("aria-busy", "false");
    return;
  }
  const referenceNow = Date.now();
  let state = parseState(new URL(location.href));
  // Legacy B links remain usable, but all newly shared links use real route paths.
  if (state.topic !== next.dataset.view) {
    void navigate(stateUrl(state), { replace: true });
    return;
  }
  history.replaceState(history.state, "", stateUrl(state));
  const ctx = makeContext(next, state, signal),
    { $ } = ctx;
  // Keep local period controls outside regions until the mounted domain places them.
  $("content").before($("view-period"));
  $("content").setAttribute("aria-busy", "true");
  const chartHost = next.querySelector<HTMLElement>("#chart-wrap");
  if (chartHost) chartHost.hidden = true;
  $("after-chart").innerHTML = "";
  $("status").textContent = "Loading evidence…";
  installDrawer(signal);
  const go = (patch: Partial<State>) => {
    const topic = patch.topic ?? state.topic;
    const base =
      topic !== state.topic
        ? changeView(state, topic, referenceNow)
        : { ...state, record: "" };
    state = { ...base, ...patch };
    sync();
    $("content").setAttribute("aria-busy", "true");
    void navigate(stateUrl(state));
  };
  const sync = () => {
    document
      .querySelectorAll<HTMLAnchorElement>("a[data-view]")
      .forEach((link) => {
        const id = viewFor(link.dataset.view!).id;
        link.href = stateUrl({
          ...changeView({ ...state, timeExplicit: false }, id, referenceNow),
          ...(id === "mesh" ? { node: "", compare: "" } : {}),
        });
        if (link.closest(".grid-sidebar")) {
          const parent =
            state.topic === "cameras"
              ? "roads"
              : state.topic === "WEATHER_ALERT"
                ? "weather"
                : state.topic;
          link.classList.toggle("is-active", id === parent);
          if (id === parent) link.setAttribute("aria-current", "page");
          else link.removeAttribute("aria-current");
        }
      });
  };
  if (signal.aborted) return;
  upgradeSelects();
  sync();
  mountPeriod($("view-period"), state, go, signal);
  next.addEventListener("grid:state-sync", sync, { signal });
  const url = location.pathname + location.search;
  const renderTrail = () => {
    const trail = $("trail");
    const detail = state.topic === "mesh" && !!state.node;
    trail.innerHTML = detail
      ? `<a href="${esc(stateUrl({ ...state, record: "", ...(state.topic === "mesh" ? { node: "", compare: "" } : {}) }))}">${esc(viewFor(state.topic).label)}</a><span aria-hidden="true"> / </span><span aria-current="page">${esc($("content").querySelector("h1")?.textContent || "Detail")}</span>`
      : "";
    try {
      const context = JSON.parse(
        sessionStorage.getItem("grid:investigation-return") || "null",
      );
      if (
        typeof context?.url === "string" &&
        context.url.startsWith("/") &&
        !context.url.startsWith("//") &&
        state.timeExplicit &&
        context.url !== url &&
        context.place === state.place &&
        context.from === state.from &&
        context.to === state.to
      ) {
        trail.insertAdjacentHTML(
          "beforeend",
          `<span class="investigation-context"><a class="investigation-return" href="${esc(context.url)}">← Back to ${esc(context.label)}</a><span>Same investigation period</span></span>`,
        );
      }
    } catch {
      /* A return trail is optional; deep links work independently. */
    }
    trail.hidden = !trail.childNodes.length;
  };
  renderTrail();
  next.addEventListener(
    "click",
    (event) => {
      const investigation = (
        event.target as HTMLElement
      ).closest<HTMLAnchorElement>("a[data-investigation-return]");
      if (investigation) {
        const url = investigation.dataset.investigationReturn || "";
        if (url.startsWith("/") && !url.startsWith("//"))
          sessionStorage.setItem(
            "grid:investigation-return",
            JSON.stringify({
              url,
              place: state.place,
              from: new URL(investigation.href).searchParams.get("from"),
              to: new URL(investigation.href).searchParams.get("to"),
              label:
                investigation.dataset.investigationLabel || "Original report",
            }),
          );
      }
      const el = (event.target as HTMLElement).closest<HTMLElement>("button");
      if (!el) return;
      if (el.dataset.topic) go({ topic: viewFor(el.dataset.topic).id });
      else if (el.dataset.record) go({ record: el.dataset.record });
      else if (el.dataset.current) {
        const topic = viewFor(el.dataset.current).id;
        const now = Date.now();
        go({
          topic,
          mode: "now",
          from: new Date(now - 86400000).toISOString(),
          to: new Date(now).toISOString(),
          timeExplicit: true,
        });
      } else if (el.hasAttribute("data-retry")) {
        void navigate(location.pathname + location.search, { replace: true });
      }
    },
    { signal },
  );
  next.addEventListener(
    "change",
    (event) => {
      const el = event.target as HTMLSelectElement;
      if (
        [
          "node",
          "compare",
          "metric",
          "layer",
          "weatherLocation",
          "weatherCompare",
        ].includes(el.id)
      )
        go({
          [el.id]: el.value,
          ...(el.id === "layer"
            ? { archiveSource: "", archiveSearch: "" }
            : {}),
        });
    },
    { signal },
  );
  next.addEventListener(
    "error",
    (event) => {
      if (
        event.target instanceof HTMLImageElement &&
        event.target.classList.contains("camera")
      )
        event.target.alt = "Camera image unavailable. Try its source link.";
    },
    { signal, capture: true },
  );
  try {
    const name = state.record ? "events" : viewFor(state.topic).module;
    const module = await modules[`./views/${name}.ts`]();
    if (signal.aborted) return;
    if (next.querySelector("sierra-line-chart"))
      await customElements.whenDefined("sierra-line-chart");
    if (next.querySelector("sierra-bar-chart"))
      await customElements.whenDefined("sierra-bar-chart");
    if (signal.aborted) return;
    await module.mount(ctx);
    if (!signal.aborted) {
      if (state.topic === "mesh" && !state.record) {
        const period = $("view-period");
        const fleet = next.querySelector(".mesh-fleet-heading");
        if (fleet) fleet.after(period);
        else next.querySelector(".measurement-controls")?.before(period);
      }
      const insight = $("view-insight");
      insight.replaceChildren();
      insight.hidden = true;
      if (state.topic === "mesh") {
        const highlights = $("after-chart").querySelector(".measurement-grid");
        if (highlights) {
          insight.append(highlights);
          insight.hidden = false;
        }
      }
      upgradeSelects(next);
      sync();
      renderTrail();
      $("content").setAttribute("aria-busy", "false");
      // A page that refreshes itself says when it was updated in its own footnote.
      $("status").textContent = next.querySelector("[data-page-updated]") ? "" : "Loaded " + fmt(Date.now());
    }
  } catch (error) {
    if (signal.aborted) return;
    $("content").setAttribute("aria-busy", "false");
    $("status").textContent = "This view could not finish loading.";
    $("content").insertAdjacentHTML(
      "beforeend",
      '<div class="callout"><h2>This page could not load</h2><p>Your selection is retained. This does not mean there are no reports.</p><button class="btn btn--outline" data-retry>Retry this view</button></div>',
    );
    console.warn(
      "Grid view load failed",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}
