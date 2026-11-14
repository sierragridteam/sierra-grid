import type { Context } from "../context";
export type RoadLayer = Extract<
  Awaited<ReturnType<Context["client"]["getMapLayer"]>>,
  { notModified: false }
>["data"];
export type RoadFeature = RoadLayer["features"][number];
export type RoadMapEntry = {
  feature: RoadFeature;
  kind: "route" | "incident" | "restriction";
  label: string;
  status: string;
  explanation: string;
  tone: "green" | "alarm" | "brass";
};
/** Route polylines describe monitored journeys, never an exact closure extent. */
export function roadMapEntries(
  layers: Partial<
    Record<"road_segment" | "road_incident" | "chain_control", RoadLayer>
  >,
): RoadMapEntry[] {
  const entries: RoadMapEntry[] = [];
  for (const feature of layers.chain_control?.features || []) {
    const p = feature.properties,
      closed = p.category === "closed" || p.status === "CLOSED";
    entries.push({
      feature,
      kind: "restriction",
      label: p.headline,
      status: closed
        ? "Reported closure point"
        : p.chainControl?.level || "Reported restriction point",
      explanation:
        p.description ||
        p.summary ||
        (closed
          ? "Caltrans reports a closure at this marker. The point does not establish the complete closure extent."
          : "The source supplied a restriction at this location."),
      tone: closed ? "alarm" : "brass",
    });
  }
  for (const feature of layers.road_incident?.features || []) {
    const p = feature.properties;
    // Future work is a separate drilldown, not an active incident on this map.
    if (p.status !== "ACTIVE") continue;
    entries.push({
      feature,
      kind: "incident",
      label: p.headline,
      status: p.incident?.closure ? "Active road work" : "Active incident",
      explanation:
        p.description || p.summary || "No source narrative supplied.",
      tone: p.severityRank >= 2 ? "alarm" : "brass",
    });
  }
  for (const feature of layers.road_segment?.features || []) {
    const p = feature.properties;
    entries.push({
      feature,
      kind: "route",
      label: p.headline,
      status:
        p.status === "CLOSED"
          ? "Closure notice attached to route"
          : p.status === "RESTRICTED"
            ? "Restriction notice attached to route"
            : p.status === "OPEN"
              ? "Reported open"
              : p.status || "Status unavailable",
      explanation:
        p.description ||
        p.summary ||
        "Monitored travel route. This line is route context, not a mapped restriction boundary.",
      tone: "green",
    });
  }
  return entries;
}
