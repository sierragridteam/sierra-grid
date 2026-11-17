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

const plain = { loading: false, error: false, archive: false, loaded: 0, more: false };

test("the report browser's count line says what is loaded and in what order", () => {
  assert.equal(m.countLine({ ...plain, loaded: 50, more: true }), "50 reports loaded · more available · newest received first");
  assert.equal(m.countLine({ ...plain, loaded: 7 }), "7 reports · newest received first");
  assert.equal(m.countLine({ ...plain, loaded: 1 }), "1 report · newest received first");
  assert.equal(m.countLine({ ...plain, archive: true, loaded: 20 }), "20 revisions · newest reported first");
  // The Overview counts events only; the list it links to says how its own total divides.
  assert.equal(m.countLine({ ...plain, loaded: 31, standing: 6, standingTypes: ["Burn day", "Road status"] }), "31 reports · 25 events and 6 standing status reports (burn day, road status) · newest received first");
  assert.equal(m.countLine({ ...plain, loaded: 5, standing: 1, standingTypes: ["Road status"] }), "5 reports · 4 events and 1 standing status report (road status) · newest received first");
  assert.equal(m.countLine({ ...plain, loaded: 50, more: true, standing: 6, standingTypes: ["Road status"] }), "50 reports loaded · more available · 44 events and 6 standing status reports (road status) · newest received first");
  assert.equal(m.countLine({ ...plain, loaded: 4, standing: 4, standingTypes: ["Road status"] }), "4 reports · all standing status (road status), not events · newest received first");
  assert.equal(m.countLine({ ...plain, loaded: 7, standing: 0, standingTypes: [] }), "7 reports · newest received first");
  assert.equal(m.countLine({ ...plain, archive: true, loaded: 20, standing: 3 }), "20 revisions · newest reported first", "revisions are not divided");
  assert.equal(m.countLine({ ...plain, loading: true }), "Loading reports…");
  assert.equal(m.countLine({ ...plain, error: true }), "Reports unavailable");
});

const reports = { one: "report", many: "reports", loaded: 0, more: false, total: null };

test("a full list of matches states the service's total, over every page", () => {
  assert.equal(m.matchCount({ ...reports, loaded: 50, more: true, total: 557 }), "557 reports match · 50 shown · newest first");
  assert.equal(m.matchCount({ ...reports, loaded: 12, total: 12 }), "12 reports match · newest first");
  assert.equal(m.matchCount({ ...reports, loaded: 1, total: 1 }), "1 report matches");
  assert.equal(m.matchCount({ ...reports, loaded: 0, total: 0 }), "0 reports match");
  assert.equal(m.matchCount({ ...reports, loaded: 1200, more: true, total: 12228 }), "12,228 reports match · 1,200 shown · newest first");
  assert.equal(m.matchCount({ one: "mesh node", many: "mesh nodes", loaded: 3, more: false, total: 3 }), "3 mesh nodes match · newest first");
});

test("without a total the count claims only what is loaded", () => {
  assert.equal(m.matchCount({ ...reports, loaded: 50, more: true, total: null }), "50 reports match so far · newest first");
});

test("a failed search is explained by its cause, never shown as no results", () => {
  assert.match(m.searchFailure({ status: 503 }), /index is being rebuilt/);
  assert.match(m.searchFailure({ status: 400 }), /nothing to look for/);
  // The service's other 400: too many words or characters. Saying "nothing to look for" would be false.
  assert.match(m.searchFailure({ status: 400 }, Array(17).fill("word").join(" ")), /too long\. Use at most 16 words \(200 characters\)/);
  assert.match(m.searchFailure({ status: 400 }, "x".repeat(201)), /too long/);
  assert.match(m.searchFailure({ status: 400 }, "the"), /nothing to look for/);
  assert.match(m.searchFailure({ status: 503 }), /pages in the sidebar are unaffected/);
  assert.match(m.searchFailure(new Error("network")), /could not be answered/);
  assert.match(m.searchFailure(undefined), /could not be answered/);
});

test("a search of the revision history counts reports, not revisions, and says which revisions matched", () => {
  assert.equal(m.historyCount({ loaded: 50, more: true, total: 212 }), "212 reports have a matching revision · 50 shown · latest match first");
  assert.equal(m.historyCount({ loaded: 1, more: false, total: 1 }), "1 report has a matching revision");
  assert.equal(m.historyCount({ loaded: 0, more: false, total: 0 }), "0 reports have a matching revision");
  assert.equal(m.historyCount({ loaded: 50, more: true, total: null }), "50 reports have a matching revision so far · latest match first");
  assert.equal(m.revisionSpan(2, 2, 1), "Revision 2 matches");
  assert.equal(m.revisionSpan(2, 5, 3), "3 revisions match, from revision 2 to revision 5");
});

test("an empty revision history search never reads as clear conditions", () => {
  const e = m.historyEmpty("volcano", "2026-07-07T00:19:16Z");
  assert.equal(e.title, "No revision matches “volcano”");
  assert.match(e.body, /^No stored revision of any report kept since July 6, 2026 has those words\./);
  assert.match(e.body, /does not establish clear conditions\.$/);
  assert.doesNotMatch(m.historyEmpty("x", null).body, /since/);
});
