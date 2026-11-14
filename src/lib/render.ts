export const esc = (x: unknown) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export { regionalTime as fmt } from "./time.ts";
import { regionalTime as fmt } from "./time.ts";
export const pretty = (value: unknown) =>
  String(value ?? "Unknown")
    .replaceAll("_", " ")
    .toLowerCase();
export function row(e: any) {
  return `<article class="evidence-row"><div><span class="badge badge--plain">${esc(pretty(e.status))}</span><span class="meta">${esc(e.provenance?.sourceName)} · ${fmt(e._revisionObservedAt || e.observedAt)}</span><h2>${esc(e.headline)}</h2><p>${esc(e.areaLabel)}</p><p>${esc(e.summary || e.description?.slice(0, 220))}</p></div><button class="btn btn--outline btn--sm" data-record="${esc(e.id)}">Inspect report →</button></article>`;
}
export function facts(e: any) {
  let pairs: any[] = [];
  if (e.wildfire)
    pairs = [
      ["Reported area", `${e.wildfire.acres} acres`],
      [
        "Containment",
        e.wildfire.containment
          ? `${e.wildfire.containment}%`
          : "0 encoded / unknown",
      ],
      ["Cause", e.wildfire.cause || "Not reported"],
      ["County", e.wildfire.county],
    ];
  if (e.power)
    pairs = [
      ["Customers", e.power.customersAffected || "0 encoded / unknown"],
      ["Cause", e.power.cause],
      ["Crew", e.power.crewStatus],
      ["Restoration estimate", fmt(e.power.estimatedRestoration)],
      ["PSPS stage", e.power.stage || "Not supplied"],
    ];
  if (e.roadIncident) {
    const r = e.roadIncident.closure || e.roadIncident;
    pairs = [
      ["Route", r.route],
      ["Direction", r.direction],
      ["Work / closure", r.workType || r.closureType],
      ["Planned start", fmt(r.plannedStart)],
      ["Planned end", fmt(r.plannedEnd)],
      ["Impact", r.impact],
    ];
  }
  if (e.earthquake)
    pairs = [
      ["Magnitude", e.earthquake.magnitude],
      ["Depth", `${e.earthquake.depthKm} km`],
    ];
  if (e.evacuation)
    pairs = [
      ["Zone", e.evacuation.zoneId],
      ["Notice", e.evacuation.level],
      ["County", e.evacuation.county],
    ];
  if (e.burnStatus)
    pairs = [
      ["Combined decision", pretty(e.burnStatus.permission)],
      ["Air district", pretty(e.burnStatus.burnDay)],
      ["CAL FIRE", pretty(e.burnStatus.calfireStatus)],
      ["CAL FIRE observed", fmt(e.burnStatus.calfireObservedAt)],
    ];
  return `<dl class="facts">${pairs
    .filter((p) => p[1] !== undefined && p[1] !== "")
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join("")}</dl>`;
}
export const btn = (label: string, topic: string) =>
  `<button class="btn btn--outline" data-topic="${esc(topic)}">${esc(label)} →</button>`;
export const empty = (text: string) => `<p class="callout">${text}</p>`;
export function next() {
  return `<h2>Follow this evidence</h2><div class="actions">${btn("Power", "POWER")}${btn("Weather", "weather")}${btn("Roads and cameras", "roads")}${btn("Node comparison", "mesh")}</div>`;
}

/**
 * A URL from the API, only if it is http(s). Escaping does not make a
 * `javascript:` or `data:` URL safe in an href or src, so anything else is dropped.
 */
export const httpUrl = (value: unknown): string => (typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : "");
