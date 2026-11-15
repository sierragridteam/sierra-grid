/**
 * What the report browser says about a text search. The Grid service does the
 * matching (headline, place, summary, the source's own text, a road in any
 * spelling); this module decides the words on the page, so that a search that
 * failed or found nothing is never read as "nothing happened".
 */

/** One run of a match excerpt; `hit` marks a matched word. */
export type MatchPart = { text: string; hit: boolean };
export type Match = { field: string; parts: MatchPart[] } | null | undefined;

/** A search box is typed into: its last word also matches as a prefix. */
export const searchParams = (query: string | undefined) => {
  const q = (query || "").trim();
  return q ? { q, qTyping: true } : {};
};

/**
 * The excerpt to show under a result, or nothing. The headline and place are
 * already on the row, so only a match in the report's text is worth a line.
 */
export function matchExcerpt(match: Match): MatchPart[] | null {
  if (!match || match.field !== "text" || !match.parts.some(part => part.hit)) return null;
  return match.parts;
}

export type CountState = {
  loading: boolean; searching: boolean; error: boolean;
  query: string; archive: boolean;
  /** Reports loaded so far, and whether the service has more. */
  loaded: number; more: boolean;
  /** Every match across all pages, when the service counted them. */
  total: number | null;
};

/** The line above the list. */
export function countLine(s: CountState): string {
  if (s.loading) return "Loading reports…";
  if (s.error) return "Reports unavailable";
  const noun = (n: number) => s.archive ? (n === 1 ? "saved update" : "saved updates") : (n === 1 ? "report" : "reports");
  if (s.query) {
    if (s.searching) return "Searching…";
    // The total is the service's count over every page. Without it (it should
    // always come with a search) only what is loaded can be claimed.
    const n = s.total ?? s.loaded;
    const counted = `${n.toLocaleString("en-US")} ${noun(n)} ${n === 1 ? "matches" : "match"}`;
    const partial = s.total === null && s.more ? " so far" : s.more ? ` · ${s.loaded.toLocaleString("en-US")} shown` : "";
    return counted + partial + (n > 1 ? " · newest first" : "");
  }
  return `${s.loaded.toLocaleString("en-US")} ${noun(s.loaded)}${s.more ? " loaded · more available" : ""} · ${s.archive ? "newest reported first" : "newest received first"}`;
}

/** What an empty search result may and may not be taken to mean. */
export function emptySearch(query: string, since: string | null | undefined, archive: boolean, pastIncluded: boolean) {
  const from = since && Number.isFinite(Date.parse(since))
    ? new Date(since).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric" })
    : "";
  const scope = archive ? "saved update in this period" : pastIncluded ? "stored report" : "active or scheduled report";
  return {
    title: `No ${archive ? "saved update" : "report"} matches “${query}”`,
    body: `No ${scope}${from ? ` (the Grid has kept reports since ${from})` : ""} has those words in its headline, place, summary or source text. ` +
      "Try fewer or other words; a road can be typed any way (“hwy 4”, “SR 4”). An empty result does not establish clear conditions.",
  };
}

/** Why a search could not be answered. Never rendered as an empty list. */
export function searchFailure(error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 0;
  if (status === 400) return "That search has nothing to look for. Type at least one whole word; words like “the” do not count.";
  if (status === 503) return "Search is not available at the moment (its index is being rebuilt). Reports are unaffected: clear the search to browse them, or try again shortly.";
  return "Reports could not be retrieved. Your search and filters are retained.";
}
