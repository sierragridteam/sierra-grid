import { test } from "node:test";
import assert from "node:assert/strict";

const m = await import("../src/lib/search-model.ts");

test("the box sends its text as a query still being typed, and nothing when empty", () => {
  assert.deepEqual(m.searchParams("  hwy 4 "), { q: "hwy 4", qTyping: true });
  assert.deepEqual(m.searchParams(""), {});
  assert.deepEqual(m.searchParams("   "), {});
  assert.deepEqual(m.searchParams(undefined), {});
});

test("an excerpt is shown only for a match in the report's text", () => {
  const parts = [{ text: "Road ", hit: false }, { text: "flooded", hit: true }];
  assert.deepEqual(m.matchExcerpt({ field: "text", parts }), parts);
  // The headline and place are already on the row.
  assert.equal(m.matchExcerpt({ field: "title", parts }), null);
  // Matched on an identifier or the source's name: nothing to show.
  assert.equal(m.matchExcerpt({ field: "", parts: [] }), null);
  assert.equal(m.matchExcerpt({ field: "text", parts: [{ text: "no hit", hit: false }] }), null);
  assert.equal(m.matchExcerpt(null), null);
  assert.equal(m.matchExcerpt(undefined), null);
});

const base = { loading: false, searching: false, error: false, query: "", archive: false, loaded: 0, more: false, total: null };

test("the count line states the service's total for a search, over every page", () => {
  assert.equal(m.countLine({ ...base, query: "hwy 4", loaded: 50, more: true, total: 557 }), "557 reports match · 50 shown · newest first");
  assert.equal(m.countLine({ ...base, query: "hwy 4", loaded: 12, total: 12 }), "12 reports match · newest first");
  assert.equal(m.countLine({ ...base, query: "dome", loaded: 1, total: 1 }), "1 report matches");
  assert.equal(m.countLine({ ...base, query: "zzz", loaded: 0, total: 0 }), "0 reports match");
  assert.equal(m.countLine({ ...base, query: "hwy 4", loaded: 1200, more: true, total: 12228 }), "12,228 reports match · 1,200 shown · newest first");
  assert.equal(m.countLine({ ...base, query: "order", archive: true, loaded: 3, total: 3 }), "3 saved updates match · newest first");
  assert.equal(m.countLine({ ...base, query: "order", archive: true, loaded: 1, total: 1 }), "1 saved update matches");
});

test("without a total the count claims only what is loaded", () => {
  assert.equal(m.countLine({ ...base, query: "hwy 4", loaded: 50, more: true, total: null }), "50 reports match so far · newest first");
});

test("loading, searching and failure are said, not counted", () => {
  assert.equal(m.countLine({ ...base, loading: true, query: "x" }), "Loading reports…");
  assert.equal(m.countLine({ ...base, searching: true, query: "x", loaded: 9, total: 9 }), "Searching…");
  assert.equal(m.countLine({ ...base, error: true, query: "x" }), "Reports unavailable");
});

test("the plain list keeps its count line", () => {
  assert.equal(m.countLine({ ...base, loaded: 50, more: true }), "50 reports loaded · more available · newest received first");
  assert.equal(m.countLine({ ...base, loaded: 7 }), "7 reports · newest received first");
  assert.equal(m.countLine({ ...base, loaded: 1 }), "1 report · newest received first");
  assert.equal(m.countLine({ ...base, archive: true, loaded: 20 }), "20 saved updates · newest reported first");
});

test("an empty search says what was searched and never that conditions are clear", () => {
  const live = m.emptySearch("volcano", "2026-07-07T00:19:16Z", false, false);
  assert.equal(live.title, "No report matches “volcano”");
  assert.match(live.body, /^No active or scheduled report \(the Grid has kept reports since July 6, 2026\)/);
  assert.match(live.body, /does not establish clear conditions\.$/);
  assert.match(m.emptySearch("volcano", "2026-07-07T00:19:16Z", false, true).body, /^No stored report /);
  const archive = m.emptySearch("order", null, true, true);
  assert.equal(archive.title, "No saved update matches “order”");
  assert.match(archive.body, /^No saved update in this period has those words/);
  assert.doesNotMatch(archive.body, /since/);
  assert.doesNotMatch(m.emptySearch("x", "not a date", false, true).body, /since/);
});

test("a failed search is explained by its cause, never shown as no results", () => {
  assert.match(m.searchFailure({ status: 503 }), /index is being rebuilt/);
  assert.match(m.searchFailure({ status: 400 }), /nothing to look for/);
  assert.match(m.searchFailure(new Error("network")), /could not be retrieved/);
  assert.match(m.searchFailure(undefined), /could not be retrieved/);
});
