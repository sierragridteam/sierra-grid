import { test } from "node:test";
import assert from "node:assert/strict";
import { headlineCounts, feedOrder, reportChanges } from "../src/lib/event-model.ts";
import { parseState, stateUrl } from "../src/lib/state.ts";

test("headline separates scheduled records and qualifies incomplete event counts", () => {
  const reports = [
    { status: "ACTIVE", severity: "SEVERE" },
    { status: "SCHEDULED", severity: "MODERATE" },
  ];
  const complete = headlineCounts(reports, false);
  assert.equal(complete.first, "2 events are active or scheduled in Ebbetts Pass Corridor.");
  assert.equal(complete.second, "1 is severe.");
  assert.equal(complete.active, 1);
  assert.equal(complete.scheduled, 1);
  assert.match(headlineCounts(reports, true).first, /^At least 2/);
  assert.match(headlineCounts([], true).second, /More reports/);
  assert.equal(headlineCounts([], false).total, 0);
});

test("feed prioritizes severity then Grid receipt, never a future node clock", () => {
  const reports = [
    { id: "node", severity: "INFO", ingestedAt: "2026-11-01T10:00:00Z", observedAt: "2099-01-01T00:00:00Z" },
    { id: "older", severity: "SEVERE", ingestedAt: "2026-10-01T10:00:00Z" },
    { id: "newer", severity: "SEVERE", ingestedAt: "2026-11-01T10:00:00Z" },
  ];
  assert.deepEqual([...reports].sort(feedOrder).map(r => r.id), ["newer", "older", "node"]);
});

test("report history includes changed source narrative and does not invent changes from receipt clocks", () => {
  const before = { status: "ACTIVE", severity: "MINOR", headline: "Road incident", summary: "", description: "Lane blocked", ingestedAt: "2026-11-01T10:00:00Z" };
  const after = { ...before, description: "Lane reopened", status: "RESOLVED", ingestedAt: "2026-11-01T11:00:00Z" };
  assert.deepEqual(reportChanges(before, after).map(c => c.label), ["Status", "Original report"]);
  assert.deepEqual(reportChanges(before, { ...before, ingestedAt: after.ingestedAt }), []);
  assert.equal(reportChanges(before, { ...before, summary: "Road reopened" }).find(c => c.label === "Summary").kind, "added");
  assert.equal(reportChanges(before, { ...before, description: "" }).find(c => c.label === "Original report").kind, "removed");
});

test("browser filters, pagination and historical selection roundtrip without accepting arbitrary state", () => {
  const state = parseState(new URL("https://grid.example/history/?layer=POWER&status=RESOLVED&severity=SEVERE&record=pge:1&revision=3&pages=2"));
  const restored = parseState(new URL(stateUrl(state), "https://grid.example"));
  assert.equal(restored.revision, "3");
  assert.equal(restored.eventStatus, "RESOLVED");
  assert.equal(restored.severity, "SEVERE");
  assert.equal(restored.browserPages, 2);
  const invalid = parseState(new URL("https://grid.example/events/?status=nope&severity=oops&revision=x&pages=999"));
  assert.equal(invalid.eventStatus, "current");
  assert.equal(invalid.severity, "");
  assert.equal(invalid.revision, "");
  assert.equal(invalid.browserPages, 20);
});
