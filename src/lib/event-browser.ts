/** Grid query semantics; DS owns keyed rendering, controls and URL selection. */
import { navigate, urlState } from "@sierragridteam/design-system/lib/app";
import { param } from "@sierragridteam/design-system/lib/url-state";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { html, nothing, repeat } from "@sierragridteam/design-system/lib/template";
import { feedItem, moreLink, callout } from "@sierragridteam/design-system/lib/ui";
import { defineSelect, type SelectProps } from "@sierragridteam/design-system/lib/select";
import { defineLoadMore, type LoadMoreProps } from "@sierragridteam/design-system/lib/load-more";
import type { Context } from "./context";
import { data } from "./context";
import type { EventQuery } from "@sierragridteam/sdk";
import { stateUrl, defaults } from "./state";
import { eventTypes, newestFirst, reportFeedProps, type Report, type Revision } from "./event-model";
import { reportDetail } from "./event-detail";
import { viewFor } from "../config/views";

type Entry = { report: Report; revision?: Revision };
/** The URL restores at most this many pages (state.ts clamps `pages` to 20). */
const MAX_PAGES = 20;
const selectionSchema = { record: param.string(""), revision: param.string(""), selection: param.oneOf(["auto", "none"], "auto") };
type Selection = { record: string; revision: string; selection: "auto" | "none" };
export function reportLink(ctx: Context, report: Report, revision?: Revision) {
  return stateUrl({ ...ctx.state, record: report.id, autoSelect: true, revision: revision ? String(revision.revision) : "" });
}
export async function mount(ctx: Context) {
  defineSelect(); defineLoadMore();
  const { state, $, signal, client } = ctx;
  // History was folded into Events (its status filter covers past reports); old links land there.
  if (state.topic === "changes") return void navigate(stateUrl({ ...state, topic: "events", ...defaults("events"), mode: "now", eventStatus: state.record ? state.eventStatus : "all", timeExplicit: false }), { replace: true });
  const archive = state.mode === "history";
  const allTypes = state.topic === "events";
  const layer = allTypes ? state.layer : state.topic === "roads" ? "ROAD_INCIDENT" : state.topic;
  const title = viewFor(state.topic).label;
  const destination = (historical: boolean) => stateUrl({ ...state, ...defaults(state.topic), mode: historical ? "history" : "now", record: "", revision: "", timeExplicit: false, browserPages: 1 });
  const patch = (updates: Partial<typeof state>) => void navigate(stateUrl({ ...state, ...updates, record: "", revision: "", browserPages: 1, autoSelect: true }));
  const choice = (id: string, label: string, items: readonly (readonly string[])[], value: string, field: "layer" | "eventStatus" | "severity") => html`<div class="field"><label class="field__label" for=${id}>${label}</label><sierra-select .props=${{ id, value, options: items.map(([value, label]) => ({ value, label })) } satisfies SelectProps} @change=${(event: Event) => patch({ [field]: (event.currentTarget as { value?: string }).value })}></sierra-select></div>`;
  const store = createStore({ entries: [] as Entry[], token: "", pages: 0, record: state.record, revision: state.revision || "", loading: true, loadingMore: false, error: "", pageError: "" });
  const key = (entry: Entry) => entry.report.id + ":" + (entry.revision?.revision ?? "latest");
  const day = (entry: Entry) => new Date(entry.revision?.observedAt || entry.revision?.ingestedAt || entry.report.ingestedAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", year: "numeric" });
  region($("content"), store, s => html`
    <header class="page-header"><div class="page-header__text"><span class="kicker">Ebbetts Pass corridor</span><h1>${title}</h1><p class="lead">${archive ? "Follow reports through time, one saved update at a time." : "Browse source reports. Select one for its location, details and history."}</p></div></header>
    <div id="browser-period"></div>
    <div class=${`report-browser${s.record ? " has-selection" : ""}`}>
      <section class="browser-results" aria-label="Report results">
        <form class="browser-filters" aria-label="Filter reports" @submit=${(event: Event) => event.preventDefault()}>
          ${allTypes ? choice("browser-type", "Type", eventTypes, layer, "layer") : nothing}
          ${!archive ? html`${choice("browser-status", "Status", [["current", "Active & scheduled"], ["ACTIVE", "Active"], ["SCHEDULED", "Scheduled"], ["all", "All statuses"], ["RESOLVED", "Resolved"], ["EXPIRED", "Expired"]], state.eventStatus || "current", "eventStatus")}${choice("browser-severity", "Importance", [["", "All levels"], ["MODERATE", "Moderate or higher"], ["SEVERE", "Severe or higher"], ["EXTREME", "Extreme"]], state.severity || "", "severity")}` : nothing}
        </form>
        <h2 class="sr-only">${archive ? "Saved updates" : "Reports"}</h2><p id="browser-count" class="meta browser-count" role="status">${s.loading ? "Loading reports…" : s.error ? "Reports unavailable" : `${s.entries.length} ${archive ? "saved updates" : "reports"}${s.token ? " loaded · more available" : ""} · ${archive ? "newest reported first" : "newest received first"}`}</p>
        <div id="browser-list" class="feed">${repeat(s.entries, key, (entry, index) => html`
          ${archive && (index === 0 || day(entry) !== day(s.entries[index - 1])) ? html`<h3 class="browser-day">${day(entry)}</h3>` : nothing}
          ${feedItem({ ...reportFeedProps(entry.report, reportLink(ctx, entry.report, entry.revision), entry.revision), selected: entry.report.id === s.record && (!s.revision || String(entry.revision?.revision) === s.revision), onSelect: () => select({ record: entry.report.id, revision: entry.revision ? String(entry.revision.revision) : "", selection: "auto" }) })}
        `)}</div>
        ${s.error ? callout(html`${s.error}<button class="btn btn--outline" data-retry>Retry reports</button>`, { tone: "brass" }) : !s.loading && !s.entries.length ? html`<div class="browser-empty"><h2>No ${archive ? "saved updates" : "matching reports"} returned</h2><p>${archive ? "No updates returned for this type and period. This does not establish that nothing happened." : "Try all statuses or browse earlier reports. An empty result does not establish clear conditions."}</p>${archive ? moreLink(destination(false), "Check current reports") : state.eventStatus !== "all" ? moreLink(stateUrl({ ...state, eventStatus: "all", record: "", revision: "", browserPages: 1 }), "Include past reports") : nothing}</div>` : nothing}
        ${!s.loading && !s.error && s.entries.length ? html`<sierra-load-more class="browser-pagination" .props=${{
          // Pages are capped (the URL restores at most MAX_PAGES); past that, narrowing is the way in.
          hasMore: !!s.token && s.pages < MAX_PAGES,
          loading: s.loadingMore,
          error: s.pageError || undefined,
          label: archive ? "Load more updates" : "Load more reports",
          endLabel: s.token ? `Showing the first ${s.entries.length.toLocaleString()}. Narrow the filters to see others.` : "All matching results loaded.",
        } satisfies LoadMoreProps} @load-more=${loadMore}></sierra-load-more>` : nothing}
      </section>
      <section class="browser-selection" aria-label="Selected report" ?hidden=${!s.record}><div id="browser-detail"></div></section>
    </div>`, { signal });
  if (archive && !$("view-period").hidden) $("browser-period").append($("view-period"));
  const showDetail = reportDetail(ctx, $("browser-detail"), {
    href: () => stateUrl({ ...state, record: "", revision: "", autoSelect: false }),
    onClose: () => select({ record: "", revision: "", selection: "none" }),
  });
  let listScrollY = 0;
  let selection: ReturnType<typeof urlState<typeof selectionSchema>> | undefined;
  // Opening or closing a report is a step the reader took, so it gets its own
  // history entry: Back returns to the list (or the report before). The entry is
  // pushed here without a navigation, so a selection never reloads the list;
  // Back and Forward go through the router, which mounts the page again from
  // the URL (the router's popstate handler cannot be pre-empted).
  function select(next: Selection) {
    if (!selection) return void navigate(stateUrl({ ...state, record: next.record, revision: next.revision, autoSelect: next.selection !== "none" }));
    const now = selection.get();
    // The row already open: nothing to do (no refetch, no duplicate history entry).
    if (next.record === now.record && next.revision === now.revision && (next.record || next.selection === now.selection)) return;
    if (!state.record) listScrollY = scrollY;
    const url = selection.href(next);
    if (url !== location.pathname + location.search)
      history.pushState({ ...(history.state ?? {}), index: (Number(history.state?.index) || 0) + 1, scrollX, scrollY }, "", url);
    selection.set(next);
    if (!matchMedia("(min-width: 1100px)").matches) queueMicrotask(() => {
      if (next.record) $("browser-detail").closest("section")!.scrollIntoView({ block: "start" });
      else scrollTo({ top: listScrollY, behavior: "instant" });
    });
  }
  let entries: Entry[] = [], token = "", pages = 0;
  async function load() {
    const layers = layer === "ALL" ? undefined : [layer] as EventQuery["layer"];
    if (archive) {
      const response = await data(client.listHistory({ place: state.place, layer: layers, from: state.from, to: state.to, pageSize: 50, geometryFormat: "NONE", ...(token ? { pageToken: token } : {}) } as any));
      if (signal.aborted) return;
      entries.push(...response.revisions.map(revision => ({ report: revision.event, revision }))); token = response.nextPageToken;
    } else {
      const status = state.eventStatus === "all" ? ["ACTIVE", "SCHEDULED", "RESOLVED", "EXPIRED"] : state.eventStatus && state.eventStatus !== "current" ? [state.eventStatus] : undefined;
      const response = await data(client.listEvents({ place: state.place, layer: layers, status, ...(state.severity ? { severityMin: state.severity } : {}), pageSize: 50, geometryFormat: "NONE", ...(token ? { pageToken: token } : {}) } as EventQuery));
      if (signal.aborted) return;
      entries.push(...response.events.map(report => ({ report }))); token = response.nextPageToken;
    }
    pages++;
    entries = [...new Map(entries.map(entry => [key(entry), entry])).values()];
    entries.sort((a, b) => archive ? (Date.parse(b.revision?.observedAt || b.revision?.ingestedAt || "") || 0) - (Date.parse(a.revision?.observedAt || a.revision?.ingestedAt || "") || 0) || key(a).localeCompare(key(b)) : newestFirst(a.report, b.report));
    store.set({ entries, token, pages });
  }
  async function loadMore() {
    if (store.get().loadingMore) return;
    store.set({ loadingMore: true, pageError: "" });
    try { await load(); if (!signal.aborted) { state.browserPages = pages; history.replaceState(history.state, "", stateUrl(state)); } }
    catch { if (!signal.aborted) store.set({ pageError: "More reports could not load. Try again; existing results are retained." }); }
    finally { if (!signal.aborted) store.set({ loadingMore: false }); }
  }
  try {
    do { await load(); } while (!signal.aborted && token && pages < (state.browserPages || 1));
    if (signal.aborted) return;
    if (!state.record && state.autoSelect !== false && entries.length && matchMedia("(min-width: 1100px)").matches) {
      state.record = entries[0].report.id; state.revision = entries[0].revision ? String(entries[0].revision!.revision) : "";
      history.replaceState(history.state, "", stateUrl(state));
    }
  } catch { if (!signal.aborted) store.set({ error: "Reports could not be retrieved. Your filters are retained." }); }
  if (signal.aborted) return;
  store.set({ loading: false });
  // Back or Forward mounts the page afresh; the router restored the scroll before the list
  // existed, so put the reader back where the history entry says they were.
  const savedY = Number(history.state?.scrollY) || 0;
  if (savedY > 0 && scrollY < savedY - 4) requestAnimationFrame(() => { if (!signal.aborted) scrollTo({ top: savedY, behavior: "instant" }); });
  selection = urlState(selectionSchema, { signal });
  let selectionRun = 0;
  async function selected(s: Selection) {
    const run = ++selectionRun;
    Object.assign(state, { record: s.record, revision: s.revision, autoSelect: s.selection !== "none" });
    store.set({ record: s.record, revision: s.revision });
    $("content").setAttribute("aria-busy", "true");
    const seed = entries.find(e => e.report.id === s.record && (!s.revision || String(e.revision?.revision) === s.revision))?.report;
    await showDetail(s.record, s.revision, seed);
    if (!signal.aborted && run === selectionRun) $("content").setAttribute("aria-busy", "false");
  }
  selection.subscribe(s => { void selected(s); }, { signal });
  await selected(selection.get());
}
