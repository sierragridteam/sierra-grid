import { renderInto } from "@sierragridteam/design-system/lib/region";
import { choiceTiles } from "@sierragridteam/design-system/lib/ui";
import type { Context } from "../context";
import { data } from "../context";
import { esc, fmt } from "../render";
import { defaults, stateUrl } from "../state";
import { mountMap } from "../map";
import {
  roadMapEntries,
  type RoadLayer,
  type RoadMapEntry,
} from "./road-map-model";
import { upgradeSelects, setChoice } from "../select";
export type RoadOverviewResult = {
  layers: Partial<
    Record<"road_segment" | "road_incident" | "chain_control", RoadLayer>
  >;
  mapEntries: RoadMapEntry[];
};
/** Shared current road map for the homepage and the road front door. */
export async function mountRoadOverview(
  ctx: Context,
  target: HTMLElement,
  keyTarget: HTMLElement,
): Promise<RoadOverviewResult> {
  const compact = ctx.state.topic === "discover";
  const headingTag = compact ? "h3" : "h2";
  const choiceId = `${target.id || "road-overview"}-choice`;
  const kinds = ["road_segment", "road_incident", "chain_control"] as const;
  const results = await Promise.allSettled(
    kinds.map((kind) => data(ctx.client.getMapLayer(ctx.state.place, kind))),
  );
  const layers: RoadOverviewResult["layers"] = {};
  results.forEach((result, index) => {
    if (result.status === "fulfilled") layers[kinds[index]] = result.value;
  });
  const entries = roadMapEntries(layers);
  if (ctx.signal.aborted) return { layers, mapEntries: entries };
  const missing = kinds.filter((kind) => !layers[kind]);
  const status = kinds
    .filter(
      (kind) => layers[kind] && layers[kind]!.metadata.sourceStatus !== "OK",
    )
    .map(
      (kind) =>
        `${kind.replaceAll("_", " ")} ${layers[kind]!.metadata.sourceStatus.toLowerCase()}${layers[kind]!.metadata.lastSourceUpdate ? " · last successful update " + fmt(layers[kind]!.metadata.lastSourceUpdate) : ""}`,
    );
  target.classList.add("road-evidence-map");
  keyTarget.classList.add("road-map-key");
  keyTarget.classList.toggle("road-map-key--compact", compact);
  const features = entries.map((entry, index) => ({
    type: "Feature" as const,
    geometry: entry.feature.geometry,
    properties: {
      label: entry.label,
      description: entry.explanation,
      tone: entry.tone,
      roadEntry: index,
    },
  }));
  const map = mountMap(
    target,
    features,
    "Monitored roads, current incident locations and reported restriction points",
    // The overview map fills its panel; the roads page keeps the compact map beside its key.
    compact ? { compact: false } : {},
  );
  if (!features.some((feature) => feature.geometry))
    target.innerHTML =
      '<p class="callout">No located road evidence returned for this place. Unlocated reports remain listed.</p>';
  if (compact) {
    // Overview: the map is the summary. Selecting a marker names it; the key only reports missing coverage.
    const coverage = [...missing.map((kind) => kind.replaceAll("_", " ") + " unavailable"), ...status];
    keyTarget.hidden = !coverage.length;
    keyTarget.innerHTML = coverage.length ? `<p class="callout">Coverage: ${esc(coverage.join(" · "))}</p>` : "";
    if (map) {
      if (entries.length) map.selected = 0;
      target.addEventListener("feature-select", (event) => { map.selected = (event as CustomEvent<{ index: number }>).detail.index; }, { signal: ctx.signal });
    }
    return { layers, mapEntries: entries };
  }
  const choiceMarkup = compact
    ? `<label class="field">Inspect a road or report<select id="${esc(choiceId)}">${entries.map((entry, index) => `<option value="${index}">${esc(entry.label)} · ${esc(entry.status)}</option>`).join("")}</select></label>`
    : `<div class="road-map-choices"></div>`;
  keyTarget.innerHTML = `<div class="road-map-legend"><span>Lines: monitored routes</span><span>Markers: reported incidents / restrictions</span></div><p class="meta">${compact ? "Markers locate source reports; route lines are not closure boundaries." : "Route lines are context. Restriction markers are source locations, not complete closure extents."}</p>${missing.length || status.length ? `<p class="callout">Coverage: ${esc([...missing.map((kind) => kind.replaceAll("_", " ") + " unavailable"), ...status].join(" · "))}</p>` : ""}${entries.length ? choiceMarkup : ""}<section class="road-map-selection" aria-label="Selected road evidence" aria-live="polite"></section>`;
  if (compact) upgradeSelects(keyTarget);
  const credit = [
    ...new Set(
      kinds.flatMap((kind) =>
        layers[kind]?.metadata.attribution
          ? [layers[kind]!.metadata.attribution!]
          : [],
      ),
    ),
  ]
    .flatMap((value) => value.split(" · "))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" · ");
  if (credit)
    keyTarget.insertAdjacentHTML(
      "beforeend",
      `<p class="meta road-map-credit">Road data: ${esc(credit)}</p>`,
    );
  const details = keyTarget.querySelector<HTMLElement>(".road-map-selection")!;
  const select = (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    const p = entry.feature.properties;
    if (compact) setChoice(choiceId, String(index));
    if (map) map.selected = index;
    if (!compact) renderInto(keyTarget.querySelector<HTMLElement>(".road-map-choices")!, choiceTiles({
      name: choiceId, label: "Road reports and monitored routes", size: "compact", value: String(index),
      options: entries.map((entry, i) => ({ value: String(i), label: entry.label, detail: entry.status + (entry.feature.geometry ? "" : " · location unavailable") })),
      onChange: value => select(Number(value)),
    }));
    const href =
      entry.kind === "incident"
        ? stateUrl({
            ...ctx.state,
            ...defaults("roads"),
            topic: "roads",
            record: p.id,
            timeExplicit: false,
          })
        : "";
    details.innerHTML = `${compact ? "" : `<p class="kicker">${esc(entry.status)}</p>`}<${headingTag}>${esc(entry.label)}</${headingTag}><p>${esc(entry.explanation)}</p>${entry.kind === "route" && p.status !== "OPEN" ? '<p class="meta">The route is shown in full for orientation; the source has not supplied an exact closure line.</p>' : ""}${!compact && p.road ? `<dl class="facts"><div><dt>Reported travel</dt><dd>${p.road.durationMinutes ?? "—"} min</dd></div><div><dt>Reported delay</dt><dd>${p.road.delayMinutes ?? "—"} min</dd></div></dl>${p.status === "CLOSED" ? '<p class="meta">Travel estimates do not establish passability while a closure notice is attached.</p>' : ""}` : ""}<p class="meta">${esc(p.source.name)} · ${p.updatedAt || p.source.fetchedAt ? fmt(p.updatedAt || p.source.fetchedAt) : "Update time not supplied"}</p>${href ? `<a class="btn btn--outline btn--sm" href="${esc(href)}">Report & saved changes →</a>` : p.source.url ? `<a class="btn btn--outline btn--sm" href="${esc(p.source.url)}" target="_blank" rel="noopener">Source details ↗</a>` : ""}`;
  };
  keyTarget.addEventListener(
    "change",
    (event) => {
      const control = event.target as HTMLButtonElement;
      if (control.id !== choiceId && control.id !== choiceId + "-source")
        return;
      const index = Number(control.value);
      select(index);

    },
    { signal: ctx.signal },
  );
  target.addEventListener(
    "feature-select",
    (event) => {
      select((event as CustomEvent<{ index: number }>).detail.index);
      if (matchMedia("(max-width: 900px)").matches)
        details.scrollIntoView({ block: "nearest" });
    },
    { signal: ctx.signal },
  );
  if (entries.length) select(0);
  else
    details.innerHTML =
      "<p>No current road reports returned. Check source coverage before interpreting absence.</p>";
  return { layers, mapEntries: entries };
}
