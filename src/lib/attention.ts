import type { V1PlaceSummary } from "@sierragridteam/sdk";
import type { ViewId } from "../config/views";
const ranks: Record<string, number> = {
  INFO: 0,
  MINOR: 1,
  MODERATE: 2,
  SEVERE: 3,
  EXTREME: 4,
};
const domains: Record<string, ViewId> = {
  fire: "WILDFIRE",
  evacuation: "EVACUATION",
  weather: "WEATHER_ALERT",
  roads: "roads",
  power: "POWER",
};
export type AttentionItem = {
  id: string;
  headline: string;
  severity: string;
  rank: number;
  view: ViewId;
  record: string;
  health: string;
  domain: string;
};
/** Presentation policy over source-assessed severity, never a new risk score. */
export function attentionFor(summary: V1PlaceSummary) {
  const relevant = summary.domains.filter((d) => d.domain in domains);
  const degraded = relevant.filter((d) => d.status !== "OK");
  const missing = Object.keys(domains).filter(
    (name) => !relevant.some((d) => d.domain === name),
  );
  const items: AttentionItem[] = [];
  for (const domain of relevant) {
    const elevated = domain.headlines.filter(
      (h) => (ranks[h.severity] ?? 0) >= 2,
    );
    for (const h of elevated) {
      const view =
        h.layer === "FIRE_WEATHER"
          ? "weather"
          : h.layer === "ROAD_INCIDENT"
            ? "roads"
            : domains[domain.domain];
      items.push({
        id: h.id,
        headline: h.headline,
        severity: h.severity,
        rank: ranks[h.severity] ?? 0,
        view,
        record: h.kind === "EVENT" ? h.id : "",
        health: domain.status,
        domain: domain.domain,
      });
    }
    if (!elevated.length && (ranks[domain.highestSeverity] ?? 0) >= 2)
      items.push({
        id: "domain:" + domain.domain,
        headline: `Review ${domain.domain} reports`,
        severity: domain.highestSeverity,
        rank: ranks[domain.highestSeverity],
        view: domains[domain.domain],
        record: "",
        health: domain.status,
        domain: domain.domain,
      });
  }
  const unique = [...new Map(items.map((i) => [i.id, i])).values()].sort(
    (a, b) => b.rank - a.rank || a.id.localeCompare(b.id),
  );
  return {
    items: unique,
    degraded,
    missing,
    complete: !degraded.length && !missing.length,
    generatedAt: summary.generatedAt,
  };
}

/**
 * The Overview's "N are severe." It is counted from the list shown beside it
 * (the items above), never separately, so the sentence and the list cannot
 * disagree. They did twice in 2026-11: the sentence counted events while the
 * list also carried closed monitored roads, then a seasonal closure that is a
 * condition and not an event.
 *
 * With some source coverage missing (`complete` false) the list may be short
 * of what is out there, so the sentence does not conclude past it: a count is
 * "at least", and none found is about the reports that arrived, not the region.
 */
export function attentionSentence(items: Pick<AttentionItem, "rank">[], complete = true): string {
  const extreme = items.filter((i) => i.rank >= 4).length;
  const severe = items.filter((i) => i.rank === 3).length;
  const least = complete ? "" : "At least ";
  const count = (n: number, word: string) => `${least}${n} ${n === 1 ? "is" : "are"} ${word}.`;
  if (extreme) return count(extreme, "extreme");
  if (severe) return count(severe, "severe");
  return complete ? "None are rated severe or extreme." : "None of the reports that arrived are rated severe or extreme.";
}
