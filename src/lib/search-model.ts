/**
 * What Grid says about a text search of reports. The Grid service does the
 * matching (headline, place, summary, the source's own text, a road in any
 * spelling); this module decides the words on the page, so that a search that
 * failed or found nothing is never read as "nothing happened".
 */

/** One run of a match excerpt; `hit` marks a matched word. */
export type MatchPart = { text: string; hit: boolean };
export type Match = { field: string; parts: MatchPart[] } | null | undefined;

/** The service's limits on a query (sierra-data `internal/search/query.go`). */
export const MAX_QUERY = 200, MAX_TERMS = 16;
const tooLong = (query: string) => new TextEncoder().encode(query).length > MAX_QUERY || query.trim().split(/\s+/).length > MAX_TERMS;

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

/**
 * The line above the report browser's list (Events, and its revisions over a
 * period). `standing` is how many of the loaded reports are standing state
 * (an open road, a county's burn answer) and of which kinds: the Overview
 * counts events only, so the list it links to says how its total divides.
 */
export function countLine(s: { loading: boolean; error: boolean; archive: boolean; loaded: number; more: boolean; standing?: number; standingTypes?: string[] }): string {
  if (s.loading) return "Loading reports…";
  if (s.error) return "Reports unavailable";
  const n = (count: number, one: string, many = one + "s") => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
  const noun = s.archive ? n(s.loaded, "revision") : n(s.loaded, "report");
  const standing = s.archive ? 0 : Math.min(s.standing ?? 0, s.loaded);
  const kinds = (s.standingTypes ?? []).map(kind => kind.toLowerCase()).join(", ");
  const split = !standing ? ""
    : standing === s.loaded ? ` · all standing status${kinds ? ` (${kinds})` : ""}, not events`
    : ` · ${n(s.loaded - standing, "event")} and ${n(standing, "standing status report")}${kinds ? ` (${kinds})` : ""}`;
  return `${noun}${s.more ? " loaded · more available" : ""}${split} · ${s.archive ? "newest reported first" : "newest received first"}`;
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

/** The line above a search of the revision history: one row per report, however many of its revisions match. */
export function historyCount(s: { loaded: number; more: boolean; total: number | null }): string {
  const n = s.total ?? s.loaded;
  const counted = `${n.toLocaleString("en-US")} ${n === 1 ? "report has" : "reports have"} a matching revision`;
  const partial = s.total === null && s.more ? " so far" : s.more ? ` · ${s.loaded.toLocaleString("en-US")} shown` : "";
  return counted + partial + (n > 1 ? " · latest match first" : "");
}

/** Which of a report's revisions matched: the first, the last and how many. */
export function revisionSpan(first: number, last: number, matching: number): string {
  if (matching <= 1 || first === last) return `Revision ${first} matches`;
  return `${matching.toLocaleString("en-US")} revisions match, from revision ${first} to revision ${last}`;
}

/** What an empty search of the revision history may and may not be taken to mean. */
export function historyEmpty(query: string, since: string | null | undefined) {
  const from = since && Number.isFinite(Date.parse(since))
    ? new Date(since).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric" })
    : "";
  return {
    title: `No revision matches “${query}”`,
    body: `No stored revision of any report${from ? ` kept since ${from}` : ""} has those words. ` +
      "Try fewer or other words; a road can be typed any way (“hwy 4”, “SR 4”). Finding nothing does not establish clear conditions.",
  };
}

/** Why a search could not be answered. Never rendered as an empty list. */
export function searchFailure(error: unknown, query = ""): string {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 0;
  // The service refuses a search for two reasons; which one is plain from the text.
  if (status === 400 && tooLong(query)) return `That search is too long. Use at most ${MAX_TERMS} words (${MAX_QUERY} characters).`;
  if (status === 400) return "That search has nothing to look for. Type at least one whole word; words like “the” do not count.";
  if (status === 503) return "Search is not available at the moment (its index is being rebuilt). The pages in the sidebar are unaffected. Try again shortly.";
  return "The search could not be answered. Your text is kept; try again shortly.";
}
