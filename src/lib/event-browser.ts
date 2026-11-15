/** Grid query semantics; DS owns keyed rendering, controls and URL selection. */
import { navigate, urlState } from "@sierragridteam/design-system/lib/app";
import { param } from "@sierragridteam/design-system/lib/url-state";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { html, nothing, repeat } from "@sierragridteam/design-system/lib/template";
import { feedItem, moreLink, callout, searchField } from "@sierragridteam/design-system/lib/ui";
import { focusOnKey } from "@sierragridteam/design-system/lib/dom";
import { defineSelect, type SelectProps } from "@sierragridteam/design-system/lib/select";
import { defineLoadMore, type LoadMoreProps } from "@sierragridteam/design-system/lib/load-more";
import type { Context } from "./context";
import { data } from "./context";
import type { EventQuery } from "@sierragridteam/sdk";
import { stateUrl, defaults } from "./state";
import { eventTypes, newestFirst, reportFeedProps, type Report, type Revision } from "./event-model";
import { countLine, emptySearch, matchExcerpt, searchFailure, searchParams, type Match } from "./search-model";
import { reportDetail } from "./event-detail";
import { viewFor } from "../config/views";

type Entry = { report: Report; revision?: Revision; match?: Match };
/** How long after the last keystroke the search is sent. */
const SEARCH_DELAY_MS = 250;
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
  // Filter buttons: no label above; the filter's name is announced. The bar gives them equal
  // columns, so the trigger shows an option's short text where the full one would not fit.
  type Item = readonly [value: string, label: string, short?: string];
  const choice = (id: string, label: string, items: readonly Item[], value: string, fallback: string, field: "layer" | "eventStatus" | "severity") => html`<sierra-select .props=${{ id, value, variant: "filter", label, applied: value !== fallback, options: items.map(([value, label, short]) => ({ value, label, short })) } satisfies SelectProps} @change=${(event: Event) => patch({ [field]: (event.currentTarget as { value?: string }).value })}></sierra-select>`;
  const types: Item[] = eventTypes.map(([id, label]) => [id, id === "ALL" ? "Any type" : label, id === "WEATHER_ALERT" ? "Weather" : undefined]);
  const filtered = allTypes && layer !== "ALL" || !archive && ((state.eventStatus || "current") !== "current" || !!state.severity);
  const reset = () => void navigate(stateUrl({ ...state, ...(allTypes ? { layer: "ALL" } : {}), eventStatus: "current", severity: "", query: "", record: "", revision: "", browserPages: 1, autoSelect: true }));
  let searchTimer = 0;
  // The service does the matching, over every stored report and not only the ones on the page,
  // so typing asks it again once the keys pause. The list on screen stays until the answer lands.
  const search = (query: string) => {
    store.set({ query });
    // The state is current at once, so a filter chosen straight after typing keeps the text;
    // the address bar and the list follow a beat behind, without a history entry per keystroke.
    state.query = query.trim();
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      if (signal.aborted) return;
      state.browserPages = 1;
      history.replaceState(history.state, "", stateUrl(state));
      void reload();
    }, SEARCH_DELAY_MS);
  };
  signal.addEventListener("abort", () => clearTimeout(searchTimer));
  const store = createStore({ entries: [] as Entry[], token: "", pages: 0, record: state.record, revision: state.revision || "", loading: true, loadingMore: false, error: "", pageError: "", query: state.query || "", applied: (state.query || "").trim(), searching: false, total: null as number | null, since: null as string | null });
  const key = (entry: Entry) => entry.report.id + ":" + (entry.revision?.revision ?? "latest");
  const day = (entry: Entry) => new Date(entry.revision?.observedAt || entry.revision?.ingestedAt || entry.report.ingestedAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", year: "numeric" });
  // `applied` is the query the list on screen answers; `query` is what the box holds.
  region($("content"), store, s => { const q = s.applied, shown = s.entries, empty = q ? emptySearch(q, s.since, archive, archive || state.eventStatus === "all") : undefined; return html`
    <header class="page-header"><div class="page-header__text"><span class="kicker">Ebbetts Pass corridor</span><h1>${title}</h1><p class="lead">${archive ? "Follow reports through time, one saved update at a time." : "Browse source reports. Select one for its location, details and history."}</p></div></header>
    <div id="browser-period"></div>
    <div class=${`report-browser${s.record ? " has-selection" : ""}`}>
      <section class="browser-results" aria-label="Report results">
        <form class="browser-filters" aria-label="Search and filter reports" @submit=${(event: Event) => event.preventDefault()}>
          ${searchField({ id: "browser-search", label: "Search reports", value: s.query, placeholder: "Search events, places, sources…", shortcut: "/", onInput: search })}
          <div class="filter-bar">
            ${allTypes ? choice("browser-type", "Type", types, layer, "ALL", "layer") : nothing}
            ${!archive ? html`${choice("browser-status", "Status", [["current", "Active & scheduled", "Current"], ["ACTIVE", "Active"], ["SCHEDULED", "Scheduled"], ["all", "All statuses"], ["RESOLVED", "Resolved"], ["EXPIRED", "Expired"]], state.eventStatus || "current", "current", "eventStatus")}${choice("browser-severity", "Importance", [["", "Any importance", "Any level"], ["MODERATE", "Moderate or higher", "Moderate +"], ["SEVERE", "Severe or higher", "Severe +"], ["EXTREME", "Extreme"]], state.severity || "", "", "severity")}` : nothing}
          </div>
        </form>
        <h2 class="sr-only">${archive ? "Saved updates" : "Reports"}</h2><div class="browser-count"><p id="browser-count" class="meta" role="status">${countLine({ loading: s.loading, searching: s.searching, error: !!s.error, query: s.searching ? s.query.trim() : q, archive, loaded: s.entries.length, more: !!s.token, total: s.total })}</p>${filtered || s.query.trim() ? html`<button type="button" class="filter-reset" @click=${reset}>Reset</button>` : nothing}</div>
        <div id="browser-list" class="feed">${repeat(shown, key, (entry, index) => html`
          ${archive && (index === 0 || day(entry) !== day(shown[index - 1])) ? html`<h3 class="browser-day">${day(entry)}</h3>` : nothing}
          ${feedItem({ ...reportFeedProps(entry.report, reportLink(ctx, entry.report, entry.revision), entry.revision), selected: entry.report.id === s.record && (!s.revision || String(entry.revision?.revision) === s.revision), onSelect: () => select({ record: entry.report.id, revision: entry.revision ? String(entry.revision.revision) : "", selection: "auto" }) }, excerpt(entry))}
        `)}</div>
        ${s.error ? callout(html`${s.error}<button class="btn btn--outline" data-retry>Retry reports</button>`, { tone: "brass" }) : s.loading || s.searching || s.entries.length ? nothing : empty ? html`<div class="browser-empty"><h2>${empty.title}</h2><p>${empty.body}</p>${!archive && state.eventStatus !== "all" ? moreLink(stateUrl({ ...state, eventStatus: "all", record: "", revision: "", browserPages: 1 }), "Search past reports too") : nothing}</div>` : html`<div class="browser-empty"><h2>No ${archive ? "saved updates" : "matching reports"} returned</h2><p>${archive ? "No updates returned for this type and period. This does not establish that nothing happened." : "Try all statuses or browse earlier reports. An empty result does not establish clear conditions."}</p>${archive ? moreLink(destination(false), "Check current reports") : state.eventStatus !== "all" ? moreLink(stateUrl({ ...state, eventStatus: "all", record: "", revision: "", browserPages: 1 }), "Include past reports") : nothing}</div>`}
        ${!s.loading && !s.error && s.entries.length ? html`<sierra-load-more class="browser-pagination" .props=${{
          // Pages are capped (the URL restores at most MAX_PAGES); past that, narrowing is the way in.
          hasMore: !!s.token && s.pages < MAX_PAGES,
          loading: s.loadingMore,
          error: s.pageError || undefined,
          label: archive ? "Load more updates" : "Load more reports",
          endLabel: s.token ? `Showing the first ${s.entries.length.toLocaleString()}. Narrow the ${q ? "search or the " : ""}filters to see others.` : "All matching results loaded.",
        } satisfies LoadMoreProps} @load-more=${loadMore}></sierra-load-more>` : nothing}
      </section>
      <section class="browser-selection" aria-label="Selected report" ?hidden=${!s.record}><div id="browser-detail"></div></section>
    </div>`; }, { signal });
  // Where the words matched, when that is in the report's text and not already on the row.
  function excerpt(entry: Entry) {
    const parts = matchExcerpt(entry.match);
    return parts ? html`<p class="feed-item__match">${parts.map(part => part.hit ? html`<mark>${part.text}</mark>` : part.text)}</p>` : nothing;
  }
  focusOnKey("/", () => document.getElementById("browser-search"), signal);
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
  // Each search or first load is a run. A slower answer to an older run is dropped, and its
  // request cancelled, so the list never shows the results of text that has since changed.
  let run = 0, request = new AbortController();
  async function load() {
    const mine = run, options = { signal: request.signal };
    const layers = layer === "ALL" ? undefined : [layer] as EventQuery["layer"];
    const text = searchParams(state.query);
    let total: number | null, since: string | null, page: Entry[], next: string;
    if (archive) {
      // No shapes in a list: the archive takes geometryFormat=NONE since the Grid service gained
      // search (it answered 400 before, which is why this view asked without it for a while).
      const response = await data(client.listHistory({ place: state.place, layer: layers, from: state.from, to: state.to, pageSize: 50, geometryFormat: "NONE", ...text, ...(token ? { pageToken: token } : {}) }, options));
      page = response.revisions.map(revision => ({ report: revision.event, revision, match: revision.match }));
      next = response.nextPageToken; total = response.totalMatches; since = response.search?.since ?? null;
    } else {
      const status = state.eventStatus === "all" ? ["ACTIVE", "SCHEDULED", "RESOLVED", "EXPIRED"] : state.eventStatus && state.eventStatus !== "current" ? [state.eventStatus] : undefined;
      const response = await data(client.listEvents({ place: state.place, layer: layers, status, ...(state.severity ? { severityMin: state.severity } : {}), pageSize: 50, geometryFormat: "NONE", ...text, ...(token ? { pageToken: token } : {}) } as EventQuery, options));
      page = response.events.map(report => ({ report, match: response.matches[report.id] }));
      next = response.nextPageToken; total = response.totalMatches; since = response.search?.since ?? null;
    }
    if (signal.aborted || mine !== run) return;
    entries.push(...page); token = next;
    pages++;
    entries = [...new Map(entries.map(entry => [key(entry), entry])).values()];
    entries.sort((a, b) => archive ? (Date.parse(b.revision?.observedAt || b.revision?.ingestedAt || "") || 0) - (Date.parse(a.revision?.observedAt || a.revision?.ingestedAt || "") || 0) || key(a).localeCompare(key(b)) : newestFirst(a.report, b.report));
    store.set({ entries, token, pages, total, since, applied: text.q ?? "" });
  }
  /** Ask again from the first page, for a changed search. The list on screen stays until the answer lands. */
  async function reload() {
    const mine = ++run;
    request.abort(); request = new AbortController();
    entries = []; token = ""; pages = 0;
    store.set({ searching: true, error: "", pageError: "" });
    try { await load(); }
    catch (error) {
      if (signal.aborted || mine !== run) return;
      // A search that could not be answered is an error on the page, never an empty list.
      store.set({ entries: [], token: "", pages: 0, total: null, applied: (state.query || "").trim(), error: searchFailure(error) });
    }
    if (!signal.aborted && mine === run) store.set({ searching: false });
  }
  signal.addEventListener("abort", () => request.abort());
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
      const first = entries[0];
      state.record = first.report.id; state.revision = first.revision ? String(first.revision.revision) : "";
      history.replaceState(history.state, "", stateUrl(state));
    }
  } catch (error) { if (!signal.aborted) store.set({ error: state.query ? searchFailure(error) : "Reports could not be retrieved. Your filters are retained." }); }
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
