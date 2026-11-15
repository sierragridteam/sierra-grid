/**
 * Search: the one place text is searched. The box finds the best few reports,
 * mesh nodes, monitored roads, cameras and scanner feeds and leads to each
 * one's page; for reports and nodes it can also list every match, newest
 * first. The Events page browses by type, status and importance, not by text.
 */
import type { Context } from "../context";
import { data } from "../context";
import { pageHero } from "../hero";
import { stateUrl } from "../state";
import { httpUrl } from "../render";
import { humanize, relativeTime, reportFeedProps, typeLabel, type Report } from "../event-model";
import { matchCount, matchExcerpt, searchFailure, searchParams, type Match } from "../search-model";
import { allOfKind, finderAnswer, finderEmpty, finderKinds, kindLayers, kindNoun, listEmpty, type ListedKind } from "../finder-model";
import type { EventQuery, V1SearchHit, V1SearchResults } from "@sierragridteam/sdk";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { html, nothing, repeat } from "@sierragridteam/design-system/lib/template";
import { callout, feedItem, moreLink, searchField, type FeedItemProps } from "@sierragridteam/design-system/lib/ui";
import { defineLoadMore, type LoadMoreProps } from "@sierragridteam/design-system/lib/load-more";
import { focusOnKey } from "@sierragridteam/design-system/lib/dom";

/** How long after the last keystroke the question is sent. */
const SEARCH_DELAY_MS = 250;
/** Hits shown per kind; the group says when there are more. */
const PER_KIND = 5;
/** The URL restores at most this many pages of a full list (state.ts clamps `pages` to 20). */
const MAX_PAGES = 20;

type Row = { report: Report; match: Match };
/** A full list of one kind: every match the service has, a page at a time. */
type Listing = { rows: Row[]; token: string; pages: number; total: number | null; since: string | null };

export async function mount(ctx: Context) {
  defineLoadMore();
  const { state, client, $, signal } = ctx;
  // "" is the best few of every kind; a kind is that kind listed in full.
  const kind: ListedKind | "" = state.query ? state.searchKind || "" : "";
  const store = createStore({ query: state.query || "", asked: "", searching: false, error: "", result: null as V1SearchResults | null, listing: null as Listing | null, loadingMore: false, pageError: "" });

  // Where each kind of hit lives in Grid.
  const page = (topic: "roads" | "cameras" | "scanners") => stateUrl({ ...state, topic, layer: "ALL", query: "", searchKind: "", record: "", revision: "", browserPages: 1, timeExplicit: false });
  const report = (id: string, mesh: boolean) => stateUrl({ ...state, topic: "events", layer: mesh ? "MESH" : "ALL", eventStatus: "all", severity: "", query: "", searchKind: "", record: id, revision: "", browserPages: 1, autoSelect: true, timeExplicit: false });
  const scope = (to: ListedKind | "", query: string) => stateUrl({ ...state, query, searchKind: to, browserPages: 1 });
  const excerpt = (match: Match) => {
    const parts = matchExcerpt(match);
    return parts ? html`<p class="feed-item__match">${parts.map(part => part.hit ? html`<mark>${part.text}</mark>` : part.text)}</p>` : nothing;
  };
  function hitRow(hit: V1SearchHit) {
    if (hit.event) {
      const e = hit.event;
      const props: FeedItemProps = {
        title: hit.title || "Untitled report", href: report(hit.id, hit.kind === "MESH_NODE"), place: hit.detail || undefined,
        severity: hit.kind === "MESH_NODE" ? undefined : { tone: ["SEVERE", "EXTREME"].includes(e.severity) ? "alarm" : e.severity === "MODERATE" ? "elevated" : "muted", label: humanize(e.severity) },
        tags: [hit.kind === "MESH_NODE" ? humanize(e.category || "node") : typeLabel(e.layer), humanize(e.status)],
        // A hit carries when the source last reported, not when Grid received it: say that.
        when: e.observedAt ? `Reported ${relativeTime(e.observedAt).replace("Just now", "just now")}` : undefined,
      };
      return feedItem(props, excerpt(hit.match));
    }
    if (hit.kind === "ROAD") return feedItem({ title: [hit.title, hit.detail].filter(Boolean).join(" · "), href: page("roads"), source: "Conditions, chain control and work on the Roads page" });
    if (hit.kind === "CAMERA") return feedItem({ title: hit.title, href: page("cameras"), place: hit.detail || undefined, source: "Live view on the Road cameras page" });
    // A scanner feed plays on Broadcastify; the Scanner feeds page says what each channel carries.
    return feedItem({ title: hit.title, href: page("scanners"), place: hit.detail || undefined, source: "Listen from the Scanner feeds page" },
      httpUrl(hit.url) ? html`<p class="feed-item__match"><a href=${httpUrl(hit.url)} target="_blank" rel="noopener">Open on Broadcastify</a></p>` : nothing);
  }
  function listRow(row: Row) {
    const mesh = row.report.layer === "MESH";
    const props = reportFeedProps(row.report, report(row.report.id, mesh));
    return feedItem(mesh ? { ...props, severity: undefined, tags: [humanize(row.report.category || "node"), humanize(row.report.status)] } : props, excerpt(row.match));
  }

  let run = 0, request = new AbortController(), timer = 0;
  signal.addEventListener("abort", () => { request.abort(); clearTimeout(timer); });
  /** One more page of the full list, onto `from` (nothing, for a new question). */
  async function listPage(query: string, from: Listing | null): Promise<Listing> {
    const response = await data(client.listEvents({
      place: state.place, layer: [...kindLayers(kind as ListedKind)], status: ["ACTIVE", "SCHEDULED", "RESOLVED", "EXPIRED"],
      pageSize: 50, geometryFormat: "NONE", ...searchParams(query), ...(from?.token ? { pageToken: from.token } : {}),
    } as EventQuery, { signal: request.signal }));
    // The service orders a search newest first; keep its order, one row per report.
    const rows = [...new Map([...(from?.rows ?? []), ...response.events.map(e => ({ report: e, match: response.matches[e.id] }))].map(row => [row.report.id, row])).values()];
    return { rows, token: response.nextPageToken, pages: (from?.pages ?? 0) + 1, total: response.totalMatches, since: response.search?.since ?? null };
  }
  /** Ask for the text in the box. An answer to older text is dropped and its request cancelled. */
  async function ask(pages = 1) {
    const query = (state.query || "").trim(), mine = ++run;
    request.abort(); request = new AbortController();
    if (!query) return void store.set({ asked: "", searching: false, error: "", result: null, listing: null, pageError: "" });
    store.set({ searching: true, error: "", pageError: "" });
    try {
      if (kind) {
        let listing = await listPage(query, null);
        while (listing.token && listing.pages < pages && !signal.aborted && mine === run) listing = await listPage(query, listing);
        if (signal.aborted || mine !== run) return;
        store.set({ asked: query, searching: false, listing });
      } else {
        const result = await data(client.search({ q: query, qTyping: true, place: state.place, kind: [...finderKinds], limit: PER_KIND }, { signal: request.signal }));
        if (signal.aborted || mine !== run) return;
        store.set({ asked: query, searching: false, result });
      }
    } catch (error) {
      if (signal.aborted || mine !== run) return;
      // Not answered is an error on the page, never "nothing matches".
      store.set({ asked: query, searching: false, result: null, listing: null, error: searchFailure(error) });
    }
  }
  async function loadMore() {
    const s = store.get(), mine = run;
    if (s.loadingMore || !s.listing?.token) return;
    store.set({ loadingMore: true, pageError: "" });
    try {
      const listing = await listPage(s.asked, s.listing);
      if (signal.aborted || mine !== run) return;
      store.set({ listing });
      state.browserPages = listing.pages;
      history.replaceState(history.state, "", stateUrl(state));
    } catch { if (!signal.aborted && mine === run) store.set({ pageError: "More could not load. Try again; the results shown are kept." }); }
    finally { if (!signal.aborted) store.set({ loadingMore: false }); }
  }
  const typed = (query: string) => {
    store.set({ query });
    state.query = query.trim();
    state.browserPages = 1;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (signal.aborted) return;
      history.replaceState(history.state, "", stateUrl(state));
      void ask();
    }, SEARCH_DELAY_MS);
  };

  region($("content"), store, s => {
    const answer = !kind && s.result ? finderAnswer(s.result) : undefined;
    const listing = kind ? s.listing : null;
    const empty = answer?.empty && !answer.unsearched ? finderEmpty(s.asked, s.result?.search.since)
      : kind && listing && !listing.rows.length ? listEmpty(kind, s.asked, listing.since) : undefined;
    const status = s.searching ? "Searching…" : s.error ? "Search unavailable"
      : kind && listing ? matchCount({ ...kindNoun(kind), loaded: listing.rows.length, more: !!listing.token, total: listing.total })
      : answer?.summary || (empty ? "0 matches" : "");
    return html`
      ${pageHero({ kicker: "Ebbetts Pass corridor", title: "Search", lead: "Find a report, a mesh node, a road, a camera or a scanner feed by name or by words in it." })}
      <form class="finder-form" role="search" aria-label="Search the corridor" @submit=${(event: Event) => { event.preventDefault(); clearTimeout(timer); history.replaceState(history.state, "", stateUrl(state)); void ask(); }}>
        ${searchField({ id: "finder-search", label: "Search the corridor", value: s.query, placeholder: "A road, a fire, a node, a camera…", shortcut: "/", onInput: typed })}
      </form>
      <p id="finder-status" class="meta finder-status" role="status">${status}</p>
      ${kind && s.asked ? html`<p class="finder-scope">${moreLink(scope("", s.asked), "Best matches of every kind")}</p>` : nothing}
      ${s.error ? callout(s.error, { tone: "brass" }) : nothing}
      ${answer?.unsearched ? callout(answer.unsearched, { tone: "brass" }) : nothing}
      ${!s.asked && !s.searching && !s.error ? html`<div class="finder-help"><p>Type a road (any way: “hwy 4”, “SR 4”), a fire or a node by name, the start of a node’s public key, or words from a report (“chain control”, “tree work”). Every word must match; put words in quotes to keep them together. Reports are searched whether current or past.</p></div>` : nothing}
      ${empty ? html`<div class="browser-empty"><h2>${empty.title}</h2><p>${empty.body}</p></div>` : nothing}
      ${answer ? html`<div class="finder-results">${repeat(answer.groups, group => group.kind, group => html`
        <section class="finder-group" aria-labelledby=${`finder-${group.kind}`}>
          <header class="finder-group__head"><h2 id=${`finder-${group.kind}`}>${group.title}</h2>${group.more ? html`<span class="meta">${group.more}</span>` : nothing}</header>
          <div class="feed">${repeat(group.hits, hit => hit.kind + ":" + hit.id, hitRow)}</div>
          ${group.more && (group.kind === "EVENT" || group.kind === "MESH_NODE") ? html`<p class="finder-group__more">${moreLink(scope(group.kind, s.asked), allOfKind(group.kind, group.total))}</p>` : nothing}
        </section>`)}</div>` : nothing}
      ${listing?.rows.length ? html`<div class="finder-results">
        <section class="finder-group" aria-labelledby="finder-listed">
          <h2 id="finder-listed" class="sr-only">${kind === "MESH_NODE" ? "Mesh nodes" : "Reports"}, newest first</h2>
          <div id="finder-list" class="feed">${repeat(listing.rows, row => row.report.id, listRow)}</div>
          <sierra-load-more class="browser-pagination" .props=${{
            // Pages are capped (the URL restores at most MAX_PAGES); past that, more words are the way in.
            hasMore: !!listing.token && listing.pages < MAX_PAGES,
            loading: s.loadingMore,
            error: s.pageError || undefined,
            label: "Load more",
            endLabel: listing.token ? `Showing the newest ${listing.rows.length.toLocaleString("en-US")}. Add a word to narrow the search.` : "All matches loaded.",
          } satisfies LoadMoreProps} @load-more=${loadMore}></sierra-load-more>
        </section></div>` : nothing}`;
  }, { signal });
  focusOnKey("/", () => document.getElementById("finder-search"), signal);
  await ask(state.browserPages || 1);
}
