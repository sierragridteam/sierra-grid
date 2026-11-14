/** Readable report details using published, state-driven DS regions/elements. */
import { html, nothing, repeat } from "@sierragridteam/design-system/lib/template";
import { createStore, region } from "@sierragridteam/design-system/lib/region";
import { defineDataDiff, type DataDiffProps } from "@sierragridteam/design-system/lib/data-diff";
import { defineGeoMap, type GeoMapProps } from "@sierragridteam/design-system/lib/geo-map";
import { callout, closeLink, progress, propertyList, recordHeader, segmented, stat, timeline, trendList, type PropertyItem } from "@sierragridteam/design-system/lib/ui";
import { genericTimeline, nearPlace, reportProfile } from "./report-profile";
import { defineSparkline } from "@sierragridteam/design-system/lib/sparkline";
import type { V1MeshTelemetryArchive } from "@sierragridteam/sdk";
import { telemetryMetrics, telemetrySeries, type TelemetryMetric } from "./mesh-telemetry";
import { data, makeContext, type Context } from "./context";
import { fmt } from "./render";
import { stateUrl } from "./state";
import { humanize, reportFields, reportChanges, typeLabel, type Report, type Revision } from "./event-model";

export const severityTone = (value: string) => ["SEVERE", "EXTREME"].includes(value) ? "alarm" as const : value === "MODERATE" ? "elevated" as const : "muted" as const;
const displayValue = (value: string) => /^\d{4}-\d\d-\d\dT/.test(value) ? fmt(value) : value;
/** Source fields that are comma-separated hashes (mesh gateways) are lists of identifiers. */
export const identifierList = (value: string): string[] | undefined => {
  const parts = value.split(/\s*,\s*/).filter(Boolean);
  return parts.length && parts.every(part => /^[0-9a-f]{8,}$/i.test(part)) ? parts : undefined;
};
const changeValue = (value: string) => identifierList(value) ?? displayValue(value);
const diffProps = (revision: Revision, previous: Revision): DataDiffProps => ({
  label: `Update ${revision.revision} · ${fmt(revision.observedAt || revision.ingestedAt)}`,
  count: false,
  changes: reportChanges(previous.event, revision.event).map(change => ({ path: change.label.replace(/^(Metadata|Properties|Attributes) · /i, ""), kind: change.kind as "added" | "removed" | "changed", before: changeValue(change.before), after: changeValue(change.after) })),
});
const factItem = ([label, value]: [string, string]): PropertyItem => {
  const ids = identifierList(value);
  return ids ? { label, identifiers: ids } : { label, value: displayValue(value) };
};
/** Coordinates are already on the map; they are not details a reader scans. */
const coordinate = /^(lat|lng|lon|long|latitude|longitude)$/i;
/** "Telemetry · Admin · Battery volts" → group "Telemetry · Admin", label "Battery volts". */
const groupFields = (fields: [string, string][]) => {
  const groups = new Map<string, PropertyItem[]>([["", []]]);
  for (const [key, value] of fields) {
    const parts = key.split(" · "), label = parts.pop()!;
    // Container names from the source ("Metadata", "Properties") say nothing; keep those fields ungrouped.
    const group = /^(metadata|properties|attributes|details|fields|data)$/i.test(parts.join(" · ")) ? "" : parts.join(" · ");
    if (coordinate.test(label)) continue;
    groups.set(group, [...(groups.get(group) ?? []), factItem([label, value])]);
  }
  // Ungrouped details first, then named groups; empty groups disappear.
  return [...groups].filter(([, items]) => items.length);
};
/** Recent updates show in full; older ones fold away (a mesh node can have hundreds). */
const recentUpdates = 5;
/** A titled card grouping one section of the report. */
const block = (title: string, body: unknown, actions?: unknown) => html`<section class="card report-block">${actions ? html`<div class="report-block__head"><h3>${title}</h3>${actions}</div>` : html`<h3>${title}</h3>`}${body}</section>`;
export type DetailClose = { href: () => string; onClose: () => void };

/** A mesh node's monitor telemetry for the Measurements card. */
type Telemetry = { key: string; days: 1 | 7; archive?: V1MeshTelemetryArchive; loading: boolean; error: string };
type Related = { event: Report; rule: string; confidence: string; reason: string };
type DetailState = { related: Related[]; report?: Report; revision: string; revisions: Revision[]; next: string; loading: boolean; historyLoading: boolean; moreLoading: boolean; error: string; historyError: string; tel: Telemetry };
export function reportDetail(ctx: Context, host: HTMLElement, close?: DetailClose) {
  defineDataDiff(); defineGeoMap(); defineSparkline();
  const store = createStore<DetailState>({ related: [], revision: "", revisions: [], next: "", loading: false, historyLoading: false, moreLoading: false, error: "", historyError: "", tel: { key: "", days: 1, loading: false, error: "" } });
  let lifetime: AbortController | undefined;
  let request = ctx;
  const sourceFields = (report: Report) => Object.entries(reportFields(report)).filter(([key]) => !["Status", "Severity", "Headline", "Summary", "Area", "Original report"].includes(key));
  // The pin is labelled with where exactly (cross streets, place), so the map answers "where" on its own.
  const mapProps = (report: Report, place?: string): GeoMapProps => ({
    label: "Reported event location", compact: true, basemap: true, featureList: false, selectable: false, labels: "selected", selected: 0,
    data: { type: "FeatureCollection", features: [{ type: "Feature", geometry: report.geometry!.object as GeoMapProps["data"]["features"][number]["geometry"], properties: { label: place || (report.areaLabel || report.headline).split(/, near /i)[0], tone: severityTone(report.severity) === "alarm" ? "alarm" : "green" } }] },
  });
  region(host, store, s => {
    const report = s.report;
    if (!report) return html`${s.error ? callout(s.error, { tone: "brass" }) : s.loading ? html`<p role="status">Loading report…</p>` : nothing}`;
    const attribution = report.provenance.attribution || report.provenance.sourceName || "Source not supplied";
    const sourceUrl = report.provenance.sourceUrl || report.canonicalUrl;
    const fields = sourceFields(report);
    const ordered = [...s.revisions].sort((a, b) => Number(b.revision) - Number(a.revision));
    const version = (revision: Revision, index: number) => {
      const previous = ordered[index + 1], changes = previous ? diffProps(revision, previous) : undefined;
      const label = `Update ${revision.revision} · ${fmt(revision.observedAt || revision.ingestedAt)}`;
      return html`<article class=${`report-version${String(revision.revision) === s.revision ? " is-selected" : ""}`}>
        ${changes?.changes.length ? html`<sierra-data-diff .props=${changes}></sierra-data-diff>` : !previous && !s.next ? html`<p class="ds-diff-label">First saved · ${fmt(revision.ingestedAt || revision.observedAt)}</p>` : html`<p class="ds-diff-label">${label}</p><p class="meta">${previous ? "No change to the displayed report details." : "Oldest loaded update. Load earlier updates to compare."}</p>`}
      </article>`;
    };
    const profile = reportProfile(report, s.revisions);
    const moments = profile ?? genericTimeline(report, s.revisions);
    const reported = moments.timeline.find(m => m.label === "Reported");
    const linkedSource = /^https?:\/\//.test(sourceUrl) ? html`<a href=${sourceUrl} target="_blank" rel="noopener noreferrer">${attribution} ↗</a>` : attribution;
    const details = profile
      ? profile.sections.map(section => block(section.title, propertyList({ label: section.title, items: section.items })))
      : fields.length ? [block("Details", html`${groupFields(fields).map(([group, items]) => html`${group ? html`<h4 class="kicker report-group">${group}</h4>` : nothing}${propertyList({ label: group || "Details", items })}`)}`)] : [];
    const telemetryCard = report.mesh && (report.mesh.telemetry as { admin?: unknown } | undefined)?.admin ? measurements(s.tel) : nothing;
    const timelineCard = block(moments.timelineDay ? `Timeline · ${moments.timelineDay}` : "Timeline", html`${timeline({ label: "Report timeline", items: moments.timeline })}<p class="meta report-legend"><span class="report-legend__source"></span>Source event <span class="report-legend__system"></span>Grid record</p>`);
    // What the service links to this report (a fire and its evacuations, an outage in a storm), strongest link first.
    const rank = (r: Related) => ["RELATION_HIGH", "RELATION_MEDIUM", "RELATION_LOW", "RELATION_CONTEXT"].indexOf(r.confidence);
    const related = [...s.related].sort((a, b) => (rank(a) < 0 ? 9 : rank(a)) - (rank(b) < 0 ? 9 : rank(b)) || Number(b.event.status === "ACTIVE") - Number(a.event.status === "ACTIVE"));
    const relatedCard = related.length ? block("Related", html`<ul class="report-related">${related.slice(0, 6).map(r => html`<li>
      <a href=${stateUrl({ ...ctx.state, topic: "events", layer: "ALL", eventStatus: "all", record: r.event.id, revision: "", autoSelect: true })}>${(r.event.headline || "Untitled report").replace(/\.$/, "")}</a>
      <span class="meta">${typeLabel(r.event.layer)} · ${humanize(r.event.status)}${r.reason ? html` · ${r.reason}` : nothing}</span>
    </li>`)}</ul>${related.length > 6 ? html`<p class="meta">${related.length - 6} more not shown.</p>` : nothing}`) : nothing;
    const versionsLink = html`<a href="#report-versions" @click=${(event: MouseEvent) => { event.preventDefault(); host.querySelector("#report-versions")?.scrollIntoView({ block: "start" }); }}>${ordered.length === 1 ? "1 version" : `${ordered.length} versions`}</a>`;
    const savedFirst = [...s.revisions].sort((a, b) => Number(a.revision) - Number(b.revision))[0]?.ingestedAt || report.ingestedAt;
    // Sources hard-wrap their text at 70-odd columns (NWS bulletins); join those lines so the
    // text fills the column, keeping blank lines as the paragraph breaks they are.
    const original = (report.description || profile?.original?.text || "").replace(/([^\n])\n(?!\n)/g, "$1 "), long = original.length > 640;
    const fullOriginal = report.description ? undefined : profile?.original?.full;
    const raw = (summary: string) => html`<details class="report-original"><summary>${summary}</summary><p class="report-quote report-quote--long">${original}</p></details>`;
    // What the report says, in the main column under the map: the summary when there is one,
    // then the source's own words as published (long bulletins fold after a preview). Most
    // reports have little else, so this is the body of the page, not a side note.
    const reportCard = block(report.summary ? "Summary" : "Original report", html`
      ${report.summary ? html`<p class="report-summary">${report.summary}</p>` : nothing}
      ${report.summary && original ? html`<h4 class="kicker report-group">Original report</h4>` : nothing}
      ${original
        ? long ? html`<p class="report-quote report-quote--long">${original.slice(0, 560).trimEnd()}…</p>${raw("Show full report")}` : html`<p class="report-quote">${original}</p>`
        : report.summary ? nothing : html`<p class="meta">The source supplied no narrative.</p>`}
      ${fullOriginal ? html`<details class="report-original"><summary>Call transcript</summary><p class="report-quote report-quote--long">${fullOriginal}</p></details>` : nothing}
      <p class="meta">${linkedSource} · first saved by Grid ${fmt(savedFirst)} · ${versionsLink}</p>`);
    return html`<div class="report-detail">
      ${recordHeader({
        badges: [{ label: humanize(report.severity), tone: severityTone(report.severity) }, { label: humanize(report.status), dot: false }],
        tags: [typeLabel(report.layer), ...(s.revision ? ["Saved version"] : [])],
        title: (report.headline || "Untitled report").replace(/\.$/, ""),
        subtitle: profile?.subtitle ? [profile.subtitle, nearPlace(report.areaLabel)].filter(Boolean).join(" · ") : report.areaLabel || undefined,
        meta: [attribution, profile?.when ?? (reported ? `Reported ${fmt(reported.datetime)}` : "Report time not supplied"), ...(profile?.identifiers ?? [])].join(" · "),
        actions: close ? closeLink(close.href(), { label: "Close report", onClose: close.onClose }) : undefined,
      })}
      ${s.revision ? html`<p class="report-history-label">Saved version ${s.revision}. This describes the report then, not a current alert.</p>` : nothing}
      ${profile?.stats.length ? html`<div class="stats stats--compact">${profile.stats.map(item => stat({ label: item.label, value: item.value, sub: item.progress ? undefined : item.sub, extra: item.progress ? progress({ value: item.progress.value, label: item.label, text: item.progress.text }) : undefined }))}</div>` : nothing}
      <div class="columns columns--wide-narrow report-columns">
        <div class="report-main">
          ${report.geometry?.object ? html`<sierra-geo-map .props=${mapProps(report, profile?.place)}></sierra-geo-map>` : nothing}
          ${reportCard}
          ${details}
        </div>
        <aside class="report-aside" aria-label="Measurements, timeline and related reports">${telemetryCard}${timelineCard}${relatedCard}</aside>
      </div>
      <section class="report-section report-history" id="report-versions"><h3>Version history</h3>
        ${s.revision ? html`<p class="meta">Complete saved history, including updates after this selected version.</p>` : nothing}
        <div class="report-versions">${repeat(ordered.slice(0, recentUpdates), revision => revision.revision, version)}</div>
        ${ordered.length > recentUpdates ? html`<details class="report-older" ?open=${ordered.slice(recentUpdates).some(r => String(r.revision) === s.revision)}>
          <summary>Show ${ordered.length - recentUpdates} earlier ${ordered.length - recentUpdates === 1 ? "update" : "updates"}</summary>
          <div class="report-versions">${repeat(ordered.slice(recentUpdates), revision => revision.revision, (revision, index) => version(revision, index + recentUpdates))}</div>
        </details>` : nothing}
        ${s.next ? html`<button class="btn btn--outline btn--sm" type="button" ?disabled=${s.moreLoading} @click=${loadOlder}>Load older updates</button>` : nothing}
        ${s.historyLoading || s.historyError || s.next ? html`<p class="meta" role="status">${s.historyLoading ? "Loading saved changes…" : s.historyError || `${ordered.length} saved updates loaded.`}</p>` : nothing}
      </section>
      <footer class="report-source meta">Grid record <code>${report.id}</code></footer>
    </div>`;
  }, { signal: ctx.signal });

  /** Every monitor measurement over 24 hours or 7 days, as small multiples. */
  function measurements(t: Telemetry) {
    const now = Date.now();
    const reporters = t.archive ? [...new Set(t.archive.samples.map(sample => sample.reading.reporterId).filter(Boolean))].join(", ") : "";
    const cadence = Number(t.archive?.cadenceSeconds);
    const items = t.archive ? Object.entries(telemetryMetrics).flatMap(([metric, meta]) => {
      const series = telemetrySeries(t.archive!, metric as TelemetryMetric);
      if (!series.points.some(p => p.value !== null)) return [];
      const fixed = (v: number) => v.toFixed(meta.decimals);
      const detail = series.summary
        ? series.isRate ? `mean ${fixed(series.summary.value)}/min` : `${series.summary.value > 0 ? "+" : series.summary.value < 0 ? "−" : "±"}${fixed(Math.abs(series.summary.value))} over ${t.days === 1 ? "24 h" : "7 days"}`
        : undefined;
      return [{ label: meta.label, value: series.latest === undefined ? "—" : `${fixed(series.latest)}${meta.unit.startsWith("/") ? "" : " "}${meta.unit}`, detail, values: series.points.map(p => p.value), unit: meta.unit, decimals: meta.decimals }];
    }) : [];
    const period = segmented({ name: "measure-days", label: "Period", options: [{ value: "1", label: "24 h" }, { value: "7", label: "7 days" }], value: String(t.days), onChange: v => setTelemetry({ days: v === "7" ? 7 : 1 }) });
    return block("Measurements", html`
      ${t.error ? html`<p class="meta" role="status">${t.error}</p>`
        : !t.archive ? html`<p class="meta" role="status">Loading measurements…</p>`
        : items.length ? html`${trendList({ label: `Measurements, last ${t.days === 1 ? "24 hours" : "7 days"}`, items })}
          <p class="meta">Rates are averages between monitor reports. ${reporters ? `Read by ${reporters}` : "Monitor readings"}${cadence > 0 ? ` about every ${Math.round(cadence / 60)} min` : ""}; kept since ${fmt(t.archive.coverage?.from)}.${t.archive.truncated ? " Partial: narrow the period." : ""}</p>`
        : html`<p class="meta">No monitor readings in the last ${t.days === 1 ? "24 hours" : "7 days"} (as of ${fmt(now)}).</p>`}`, period);
  }
  function setTelemetry(change: Partial<Pick<Telemetry, "days">>) {
    const t = store.get().tel;
    store.set({ tel: { ...t, ...change } });
    if (change.days && change.days !== t.days) void loadTelemetry();
  }
  async function loadTelemetry() {
    const s = store.get(), key = s.report?.mesh?.publicKey, active = request;
    if (!key) return;
    const days = s.tel.days, now = Date.now();
    store.set({ tel: { ...s.tel, key, archive: s.tel.key === key ? s.tel.archive : undefined, loading: true, error: "" } });
    try {
      const archive = await data(active.client.getMeshTelemetry({ node: key, from: new Date(now - days * 86_400_000).toISOString(), to: new Date(now).toISOString() }));
      if (!active.signal.aborted && store.get().tel.key === key && store.get().tel.days === days) store.set({ tel: { ...store.get().tel, archive, loading: false } });
    } catch {
      if (!active.signal.aborted) store.set({ tel: { ...store.get().tel, loading: false, archive: undefined, error: "Measurements could not load. Reload the page to try again." } });
    }
  }

  async function loadOlder() {
    const current = store.get(), active = request;
    if (!current.report || !current.next || current.moreLoading) return;
    store.set({ moreLoading: true });
    try {
      const result = await data(active.client.getEventHistory(current.report.id, { pageSize: 50, pageToken: current.next }));
      if (!active.signal.aborted) store.set({ revisions: [...current.revisions, ...result.revisions], next: result.nextPageToken, historyError: "" });
    } catch { if (!active.signal.aborted) store.set({ historyError: "Older updates could not load. Try again." }); }
    finally { if (!active.signal.aborted) store.set({ moreLoading: false }); }
  }
  return async (id: string, revision = "", seed?: Report) => {
    lifetime?.abort(); lifetime = new AbortController();
    const signal = AbortSignal.any([ctx.signal, lifetime.signal]);
    const active = request = makeContext(ctx.root, { ...ctx.state }, signal);
    store.set({ tel: { key: "", days: store.get().tel.days, loading: false, error: "" }, related: [], report: seed, revision, revisions: [], next: "", loading: !!id, historyLoading: !!id, moreLoading: false, error: "", historyError: "" });
    if (!id) return;
    // Related reports and the shape (lists are read without shapes) fill in when they arrive.
    void data(active.client.listRelatedEvents(id)).then(r => { if (!signal.aborted) store.set({ related: r.related as unknown as Related[] }); }, () => {});
    if (seed && !revision && !seed.geometry?.object && (seed.geometry as { bbox?: unknown } | null | undefined)?.bbox)
      void data(active.client.getEvent(id)).then(full => { const now = store.get().report; if (!signal.aborted && now?.id === id) store.set({ report: { ...now, geometry: full.geometry } }); }, () => {});
    // A node's measurements do not wait for its history.
    if (seed?.mesh && (seed.mesh.telemetry as { admin?: unknown } | undefined)?.admin) void loadTelemetry();
    const historyPromise = data(active.client.getEventHistory(id, { pageSize: 50 })).then(value => ({ ok: true as const, value }), () => ({ ok: false as const }));
    if (!seed && !revision) {
      try { const report = await data(active.client.getEvent(id)); if (!signal.aborted) store.set({ report }); }
      catch { if (!signal.aborted) store.set({ error: "This report could not be loaded. Your selection is retained; reload the page to try again." }); }
    }
    const result = await historyPromise;
    if (signal.aborted) return;
    let revisions = result.ok ? result.value.revisions : [], next = result.ok ? result.value.nextPageToken : "";
    let historyError = result.ok ? "" : "Saved changes could not load. Reload the page to retry.";
    if (revision && !seed) {
      for (let page = 0; next && !revisions.some(r => String(r.revision) === revision) && page < 20; page++) {
        try {
          const older = await data(active.client.getEventHistory(id, { pageSize: 100, pageToken: next }));
          if (signal.aborted) return;
          revisions.push(...older.revisions); next = older.nextPageToken;
        } catch { historyError = "Some saved changes could not load."; break; }
      }
      store.set({ report: revisions.find(r => String(r.revision) === revision)?.event });
    }
    if (!store.get().report) store.set({ error: "The selected report version could not load. Your selection is retained; reload the page to try again." });
    store.set({ revisions, next, historyError, loading: false, historyLoading: false });
    const loaded = store.get().report;
    if (loaded?.mesh && (loaded.mesh.telemetry as { admin?: unknown } | undefined)?.admin && !store.get().tel.archive && !store.get().tel.loading) void loadTelemetry();
  };
}
