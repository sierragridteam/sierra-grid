/**
 * Search: one box across the corridor's reports, mesh nodes, monitored roads,
 * cameras and scanner feeds. It is for finding a thing by name and going to
 * its page; the Events page lists every matching report in date order.
 */
import type { Context } from "../context";
import { data } from "../context";
import { pageHero } from "../hero";
import { stateUrl } from "../state";
import { httpUrl } from "../render";
import { humanize, relativeTime, typeLabel } from "../event-model";
import { matchExcerpt, searchFailure } from "../search-model";
import { finderAnswer, finderEmpty, finderKinds, type FinderGroup } from "../finder-model";
import type { V1SearchHit, V1SearchResults } from "@sierragridteam/sdk";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { html, nothing, repeat } from "@sierragridteam/design-system/lib/template";
import { callout, feedItem, moreLink, searchField, type FeedItemProps } from "@sierragridteam/design-system/lib/ui";
import { focusOnKey } from "@sierragridteam/design-system/lib/dom";

/** How long after the last keystroke the question is sent. */
const SEARCH_DELAY_MS = 250;
/** Hits shown per kind; the group says when there are more. */
const PER_KIND = 5;

export async function mount(ctx: Context) {
  const { state, client, $, signal } = ctx;
  const store = createStore({ query: state.query || "", asked: "", searching: false, error: "", result: null as V1SearchResults | null });

  // Where each kind of hit lives in Grid.
  const page = (topic: "roads" | "cameras" | "scanners") => stateUrl({ ...state, topic, layer: "ALL", query: "", record: "", revision: "", timeExplicit: false });
  const report = (hit: V1SearchHit) => stateUrl({ ...state, topic: "events", layer: hit.kind === "MESH_NODE" ? "MESH" : "ALL", eventStatus: "all", severity: "", query: "", record: hit.id, revision: "", autoSelect: true, timeExplicit: false });
  const everyReport = (group: FinderGroup, query: string) => stateUrl({ ...state, topic: "events", layer: group.kind === "MESH_NODE" ? "MESH" : "ALL", eventStatus: "all", severity: "", query, record: "", revision: "", timeExplicit: false });
  const excerpt = (hit: V1SearchHit) => {
    const parts = matchExcerpt(hit.match);
    return parts ? html`<p class="feed-item__match">${parts.map(part => part.hit ? html`<mark>${part.text}</mark>` : part.text)}</p>` : nothing;
  };
  function row(hit: V1SearchHit) {
    if (hit.event) {
      const e = hit.event;
      const props: FeedItemProps = {
        title: hit.title || "Untitled report", href: report(hit), place: hit.detail || undefined,
        severity: hit.kind === "MESH_NODE" ? undefined : { tone: ["SEVERE", "EXTREME"].includes(e.severity) ? "alarm" : e.severity === "MODERATE" ? "elevated" : "muted", label: humanize(e.severity) },
        tags: [hit.kind === "MESH_NODE" ? humanize(e.category || "node") : typeLabel(e.layer), humanize(e.status)],
        // A hit carries when the source last reported, not when Grid received it: say that.
        when: e.observedAt ? `Reported ${relativeTime(e.observedAt).replace("Just now", "just now")}` : undefined,
      };
      return feedItem(props, excerpt(hit));
    }
    if (hit.kind === "ROAD") return feedItem({ title: [hit.title, hit.detail].filter(Boolean).join(" · "), href: page("roads"), source: "Conditions, chain control and work on the Roads page" });
    if (hit.kind === "CAMERA") return feedItem({ title: hit.title, href: page("cameras"), place: hit.detail || undefined, source: "Live view on the Road cameras page" });
    // A scanner feed plays on Broadcastify; the Scanner feeds page says what each channel carries.
    return feedItem({ title: hit.title, href: page("scanners"), place: hit.detail || undefined, source: "Listen from the Scanner feeds page" },
      httpUrl(hit.url) ? html`<p class="feed-item__match"><a href=${httpUrl(hit.url)} target="_blank" rel="noopener">Open on Broadcastify</a></p>` : nothing);
  }

  let run = 0, request = new AbortController(), timer = 0;
  signal.addEventListener("abort", () => { request.abort(); clearTimeout(timer); });
  /** Ask for the text in the box. An answer to older text is dropped and its request cancelled. */
  async function ask() {
    const query = (state.query || "").trim(), mine = ++run;
    request.abort(); request = new AbortController();
    if (!query) return void store.set({ asked: "", searching: false, error: "", result: null });
    store.set({ searching: true, error: "" });
    try {
      const result = await data(client.search({ q: query, qTyping: true, place: state.place, kind: [...finderKinds], limit: PER_KIND }, { signal: request.signal }));
      if (signal.aborted || mine !== run) return;
      store.set({ asked: query, searching: false, result });
    } catch (error) {
      if (signal.aborted || mine !== run) return;
      // Not answered is an error on the page, never "nothing matches".
      store.set({ asked: query, searching: false, result: null, error: searchFailure(error).replace("Reports are unaffected: clear the search to browse them, or try again shortly.", "The pages in the sidebar are unaffected. Try again shortly.") });
    }
  }
  const typed = (query: string) => {
    store.set({ query });
    state.query = query.trim();
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (signal.aborted) return;
      history.replaceState(history.state, "", stateUrl(state));
      void ask();
    }, SEARCH_DELAY_MS);
  };

  region($("content"), store, s => {
    const answer = s.result ? finderAnswer(s.result) : undefined;
    const empty = answer?.empty && !answer.unsearched ? finderEmpty(s.asked, s.result?.search.since) : undefined;
    const status = s.searching ? "Searching…" : s.error ? "Search unavailable" : answer?.summary || (empty ? "0 matches" : "");
    return html`
      ${pageHero({ kicker: "Ebbetts Pass corridor", title: "Search", lead: "Find a report, a mesh node, a road, a camera or a scanner feed by name or by words in it." })}
      <form class="finder-form" role="search" aria-label="Search the corridor" @submit=${(event: Event) => { event.preventDefault(); clearTimeout(timer); history.replaceState(history.state, "", stateUrl(state)); void ask(); }}>
        ${searchField({ id: "finder-search", label: "Search the corridor", value: s.query, placeholder: "A road, a fire, a node, a camera…", shortcut: "/", onInput: typed })}
      </form>
      <p id="finder-status" class="meta finder-status" role="status">${status}</p>
      ${s.error ? callout(s.error, { tone: "brass" }) : nothing}
      ${answer?.unsearched ? callout(answer.unsearched, { tone: "brass" }) : nothing}
      ${!s.asked && !s.searching && !s.error ? html`<div class="finder-help"><p>Type a road (any way: “hwy 4”, “SR 4”), a fire or a node by name, the start of a node’s public key, or words from a report (“chain control”, “tree work”). Every word must match; put words in quotes to keep them together.</p></div>` : nothing}
      ${empty ? html`<div class="browser-empty"><h2>${empty.title}</h2><p>${empty.body}</p></div>` : nothing}
      ${answer ? html`<div class="finder-results">${repeat(answer.groups, group => group.kind, group => html`
        <section class="finder-group" aria-labelledby=${`finder-${group.kind}`}>
          <header class="finder-group__head"><h2 id=${`finder-${group.kind}`}>${group.title}</h2>${group.more ? html`<span class="meta">${group.more}</span>` : nothing}</header>
          <div class="feed">${repeat(group.hits, hit => hit.kind + ":" + hit.id, row)}</div>
          ${group.more && (group.kind === "EVENT" || group.kind === "MESH_NODE") ? html`<p class="finder-group__more">${moreLink(everyReport(group, s.asked), `All ${group.total.toLocaleString("en-US")} in Events, newest first`)}</p>` : nothing}
        </section>`)}</div>` : nothing}`;
  }, { signal });
  focusOnKey("/", () => document.getElementById("finder-search"), signal);
  await ask();
}
