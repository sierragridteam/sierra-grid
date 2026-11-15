/**
 * What Grid says about a text search of reports. The Grid service does the
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

/** The line above the report browser's list (Events, saved updates). */
export function countLine(s: { loading: boolean; error: boolean; archive: boolean; loaded: number; more: boolean }): string {
  if (s.loading) return "Loading reports…";
  if (s.error) return "Reports unavailable";
  const noun = s.archive ? (s.loaded === 1 ? "saved update" : "saved updates") : (s.loaded === 1 ? "report" : "reports");
  return `${s.loaded.toLocaleString("en-US")} ${noun}${s.more ? " loaded · more available" : ""} · ${s.archive ? "newest reported first" : "newest received first"}`;
}

export type MatchCount = {
  /** "report" / "reports", "mesh node" / "mesh nodes". */
  one: string; many: string;
  /** Rows loaded so far, and whether the service has more. */
  loaded: number; more: boolean;
  /** Every match across all pages, when the service counted them. */
  total: number | null;
};

/** The line above a full list of matches. */
export function matchCount(s: MatchCount): string {
  // The total is the service's count over every page. Without it (it should
  // always come with a search) only what is loaded can be claimed.
  const n = s.total ?? s.loaded;
  const counted = `${n.toLocaleString("en-US")} ${n === 1 ? s.one : s.many} ${n === 1 ? "matches" : "match"}`;
  const partial = s.total === null && s.more ? " so far" : s.more ? ` · ${s.loaded.toLocaleString("en-US")} shown` : "";
  return counted + partial + (n > 1 ? " · newest first" : "");
}

/** Why a search could not be answered. Never rendered as an empty list. */
export function searchFailure(error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 0;
  if (status === 400) return "That search has nothing to look for. Type at least one whole word; words like “the” do not count.";
  if (status === 503) return "Search is not available at the moment (its index is being rebuilt). The pages in the sidebar are unaffected. Try again shortly.";
  return "The search could not be answered. Your text is kept; try again shortly.";
}
