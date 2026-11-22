/**
 * Source health: are the feeds behind every other page current. The answer
 * first, anything stale or failing next, then every source grouped by the
 * page it feeds, with how fresh it is against how often it is checked.
 */
import type { Context } from "../context";
import { pageHero } from "../hero";
import { data, toPage } from "../context";
import { fmt, httpUrl } from "../render";
import { stateUrl } from "../state";
import type { ViewId } from "../../config/views";
import { since } from "../conditions-model";
import type { Report, Revision } from "../event-model";
import { RECORD_REFRESH_MS, isOwnService, nextRead, pagedReader, recordWindow, settle, sourceRecord, type Read, type RevisionPages } from "../record-model";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { html, nothing } from "@sierragridteam/design-system/lib/template";
import { badge, card, stat } from "@sierragridteam/design-system/lib/ui";

const REFRESH_MS = 60_000;
type Sources = Extract<Awaited<ReturnType<Context["client"]["listSources"]>>, { notModified: false }>["data"]["sources"];
type Source = Sources[number];
/**
 * `events` (each feed's health report) and `history` (their revisions over the period) are the
 * record of status changes. Each is not read yet, failed or answered; `record-model` decides
 * what the page may say in each case.
 */
type State = { sources: Source[]; loaded: boolean; error: boolean; updatedAt: number; now: number; events: Read<Report[]>; history: Read<RevisionPages>; recordFrom: number };
const HISTORY_DAYS = 30;
const when = (at: number) => html`<time datetime=${new Date(at).toISOString()}>${fmt(at)}</time>`;

/** The page each source feeds, in sidebar order; anything else is "Other". */
const FEEDS: [label: string, view: ViewId | "", ids: string[]][] = [
  ["Roads", "roads", ["caltrans", "caltrans-cc", "chp", "roads"]],
  ["Weather", "weather", ["nws", "weather"]],
  ["Wildfires", "WILDFIRE", ["calfire", "firis", "caloes"]],
  ["Power", "POWER", ["pge", "psps"]],
  ["Burn day", "BURN_STATUS", ["burnline", "burn-line", "calfire-burn"]],
  ["Mesh", "mesh", ["meshcore", "relay", "alanpi"]],
];
const ms = (v?: string | null) => (v ? Date.parse(v) : NaN);
const every = (s: number) => (!s ? "—" : s >= 3600 ? `${+(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
const tone = (status: string) => (status === "OK" ? "ok" : status === "STALE" || status === "DEGRADED" ? "elevated" : "alarm") as "ok" | "elevated" | "alarm";
const word = (status: string) => ({ OK: "Current", STALE: "Stale", DEGRADED: "Degraded", UNAVAILABLE: "Unavailable", FAILING: "Failing" })[status] ?? status[0] + status.slice(1).toLowerCase();
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export async function mount(ctx: Context) {
  const { client, state, $, signal } = ctx;
  const store = createStore<State>({ sources: [], loaded: false, error: false, updatedAt: 0, now: Date.now(), events: { state: "loading" }, history: { state: "loading" }, recordFrom: 0 });
  // Each feed's status history is a Grid record of its own (one report per source, in no place).
  // It fills in after the sources and is read again far less often than they are: the period is
  // on whole hours so the request repeats, and an unchanged answer is a 304 that changes nothing.
  const readEvents = pagedReader<Report>(1), readHistory = pagedReader<Revision>();
  async function loadHistory() {
    const window = recordWindow(Date.now(), HISTORY_DAYS);
    const [events, history] = await Promise.allSettled([
      readEvents("health", async (pageToken, etag) => toPage(await client.listEvents({ layer: ["SOURCE_HEALTH"], pageSize: 200, geometryFormat: "NONE", ...(pageToken ? { pageToken } : {}) }, { etag }), (d) => ({ items: d.events, next: d.nextPageToken }))),
      readHistory(`${window.from}/${window.to}`, async (pageToken, etag) => toPage(await client.listHistory({ layer: ["SOURCE_HEALTH"], ...window, pageSize: 200, geometryFormat: "NONE", ...(pageToken ? { pageToken } : {}) }, { etag }), (d) => ({ items: d.revisions, next: d.nextPageToken }))),
    ]);
    if (signal.aborted) return;
    const now = Date.now(), s = store.get();
    store.set({
      // A period that moved on (a new hour) is a new question; the old answer's start no longer applies.
      recordFrom: history.status === "fulfilled" && history.value !== "unchanged" ? Date.parse(window.from) : s.recordFrom,
      events: nextRead(s.events, settle(events, (v) => v.items), now),
      history: nextRead(s.history, settle(history, (v) => ({ revisions: v.items, incomplete: v.incomplete })), now),
    });
  }
  const recordUrl = (id: string) => stateUrl({ ...state, topic: "events", layer: "ALL", eventStatus: "all", record: id, revision: "", autoSelect: true, timeExplicit: false } as any);
  async function load() {
    try {
      const d = await data(client.listSources());
      if (!signal.aborted) store.set({ sources: d.sources, loaded: true, error: false, updatedAt: Date.now(), now: Date.now() });
    } catch { if (!signal.aborted) store.set({ loaded: true, error: true, now: Date.now() }); }
  }
  const pageUrl = (view: ViewId) => stateUrl({ ...state, topic: view, layer: "ALL", record: "", revision: "", timeExplicit: false } as any);

  $("content").innerHTML = `<div id="sources-page"></div>`;
  region($("sources-page"), store, (s) => {
    // The service's own row is not an upstream feed: it is neither counted nor listed as one.
    const feeds = s.sources.filter((x) => !isOwnService(x)), own = s.sources.filter(isOwnService);
    const record = sourceRecord({ events: s.events, history: s.history, days: HISTORY_DAYS, from: s.recordFrom });
    const bad = feeds.filter((x) => x.status !== "OK").sort((a, b) => ms(a.lastSuccessAt) - ms(b.lastSuccessAt));
    const good = feeds.length - bad.length;
    const newest = Math.max(...feeds.map((x) => ms(x.lastSuccessAt)).filter(Number.isFinite), -Infinity);
    const group = (x: Source) => FEEDS.find(([, , ids]) => ids.includes(x.id));
    const groups = [...FEEDS.map(([label, view, ids]) => ({ label, view, list: feeds.filter((x) => ids.includes(x.id)) })), { label: "Other", view: "" as const, list: feeds.filter((x) => !group(x)) }].filter((g) => g.list.length);
    const affected = [...new Set(bad.map((x) => group(x)?.[0]).filter(Boolean))] as string[];
    const title = !s.loaded ? "Checking the sources…" : s.error && !s.sources.length ? "Source health is unavailable right now"
      : !feeds.length ? "No sources were returned"
      : bad.length ? `${good} of ${feeds.length} sources are current` : `All ${feeds.length} sources are current`;
    const lines = bad.slice(0, 3).map((x) => `${x.name} is ${word(x.status).toLowerCase()}${Number.isFinite(ms(x.lastSuccessAt)) ? `, last good ${since(ms(x.lastSuccessAt), s.now)} ago` : ", never read"}`);
    const fresh = (x: Source) => {
      const last = ms(x.lastSuccessAt);
      // Two short lines, as the Status cell beside it: how long ago, then the clock time.
      return Number.isFinite(last) ? html`${since(last, s.now)} ago<span class="meta sources-clock">${fmt(last)}</span>` : "Never";
    };
    // Since when it has held this status, from its health report; shown only when that agrees with the
    // status now. A report never revised says when recording began, which is all that is then claimed.
    const heldSince = (x: Source) => {
      const h = record.held.get(x.id);
      return h && h.status === x.status && Number.isFinite(h.since) ? html`<a class="meta sources-since" href=${recordUrl(h.eventId)}>${h.recordedOnly ? "recorded since" : "since"} ${when(h.since)}</a>` : nothing;
    };
    const panel = record.panel;
    return html`
      ${pageHero({ kicker: "Source health · the feeds behind every page", title, titleClass: "sources-answer", lines })}
      ${s.error && s.sources.length ? html`<p class="callout">The last check failed; this is the state as of ${fmt(s.updatedAt)}.</p>` : nothing}
      <div class="stats stats--compact sources-kpis">
        ${stat({ label: "Current", value: s.loaded && feeds.length ? String(good) : "—", sub: feeds.length ? `of ${plural(feeds.length, "source")}` : "" })}
        ${stat({ label: "Need attention", value: s.loaded && feeds.length ? String(bad.length) : "—", sub: bad.length ? `affects ${affected.join(", ") || "no page"}` : "nothing stale or failing" })}
        ${stat({ label: "Newest reading", value: Number.isFinite(newest) ? `${since(newest, s.now)} ago` : "—", sub: Number.isFinite(newest) ? fmt(newest) : "" })}
        ${stat({ label: "Longest quiet", value: bad.length && Number.isFinite(ms(bad[0].lastSuccessAt)) ? since(ms(bad[0].lastSuccessAt), s.now) : "—", sub: bad.length ? bad[0].name : "every source is inside its window" })}
      </div>
      ${bad.length ? card({ variant: "panel", title: "Needs attention", kicker: "A stale source is not an all-clear", as: "section", class: "sources-attention" },
        html`<ul class="sources-problems">${bad.map((x) => { const g = group(x); return html`<li>
          <p class="sources-problem__title">${badge(word(x.status), { tone: tone(x.status) })} <strong>${x.name}</strong></p>
          <p>${Number.isFinite(ms(x.lastSuccessAt)) ? `Last good reading ${since(ms(x.lastSuccessAt), s.now)} ago (${fmt(x.lastSuccessAt)}); it goes stale after ${every(x.staleAfterSeconds)}.` : "It has never been read."}${x.lastError ? html` Reason given: <span class="sources-error">${x.lastError}</span>.` : nothing}</p>
          ${g?.[1] ? html`<p class="meta">Feeds <a href=${pageUrl(g[1] as ViewId)}>${g[0]}</a>: what that page shows from this source may be out of date.</p>` : nothing}
        </li>`; })}</ul>`) : nothing}
      ${panel ? card({ variant: "panel", title: "Status changes", kicker: panel.kicker, as: "section", class: "sources-history" },
        html`${panel.staleAsOf ? html`<p class="meta">The record could not be refreshed; this is as of ${when(panel.staleAsOf)}.</p>` : nothing}
          ${panel.entries.length ? html`<ul class="sources-changes">${panel.entries.map((e) => html`<li>
            ${badge(e.badge.label, { tone: e.badge.tone })}
            <a href=${recordUrl(e.id)}>${e.label}</a><span class="meta">${when(e.at)}</span>
            ${e.detail ? html`<span class="meta sources-error">${e.detail}</span>` : e.sameReasonAs ? html`<span class="meta">Same reason as ${when(e.sameReasonAs)}.</span>` : nothing}
          </li>`)}</ul>` : html`<p class="meta">${panel.message}</p>`}
          ${panel.note ? html`<p class="meta">${panel.note}</p>` : nothing}`) : nothing}
      ${card({ variant: "panel", title: "Every source", kicker: "Grouped by the page it feeds", as: "section", class: "sources-all" },
        feeds.length ? html`<div class="table-scroll"><table class="table table--cards table--fields sources-table">
          <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Last good reading</th><th scope="col">Checked</th><th scope="col">Stale after</th><th scope="col"><span class="sr-only">Source site</span></th></tr></thead>
          ${groups.map((g) => html`<tbody>
            <tr class="sources-group"><th scope="rowgroup" colspan="6">${g.view ? html`<a href=${pageUrl(g.view as ViewId)}>${g.label}</a>` : g.label}</th></tr>
            ${g.list.map((x) => html`<tr>
              <th scope="row">${x.name}<span class="meta sources-by">${x.attribution}</span></th>
              <td data-label="Status">${badge(word(x.status), { tone: tone(x.status) })}${heldSince(x)}</td>
              <td data-label="Last good reading">${fresh(x)}</td>
              <td data-label="Checked">${x.kind === "REPORTER" ? `reports in every ${every(x.pollIntervalSeconds)}` : `every ${every(x.pollIntervalSeconds)}`}</td>
              <td data-label="Stale after">${every(x.staleAfterSeconds)}</td>
              <td data-label="Source site">${httpUrl(x.homepageUrl) ? html`<a href=${httpUrl(x.homepageUrl)} target="_blank" rel="noopener" aria-label=${`${x.name} source site`}>Site ↗</a>` : nothing}</td>
            </tr>`)}
          </tbody>`)}</table></div>${own.map((x) => html`<p class="meta sources-own">${x.name} is this service itself, not an upstream feed, and is not counted above: ${word(x.status).toLowerCase()}${Number.isFinite(ms(x.lastSuccessAt)) ? html`, last good reading ${since(ms(x.lastSuccessAt), s.now)} ago` : nothing}.</p>`)}`
          : html`<p class="meta">${s.loaded ? "No sources returned." : "Loading…"}</p>`)}
      <p class="meta sources-footnote" data-page-updated>A current source means Grid's last read succeeded, not that nothing is happening. "Reports in" sources are devices that push to Grid. ${record.footnote} Updated ${s.updatedAt ? fmt(s.updatedAt) : "—"}, refreshes every minute${panel ? "; the record of status changes every 10 minutes" : ""}.</p>`;
  }, { signal });

  await load();
  // Left during the first load: start nothing that would outlive the page.
  if (signal.aborted) return;
  void loadHistory();
  const refresh = setInterval(() => void load(), REFRESH_MS);
  const refreshRecord = setInterval(() => void loadHistory(), RECORD_REFRESH_MS);
  signal.addEventListener("abort", () => { clearInterval(refresh); clearInterval(refreshRecord); });
}
