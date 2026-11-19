import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionFor, attentionSentence } from "../src/lib/attention.ts";
const domain = (name, patch = {}) => ({
  domain: name,
  status: "OK",
  highestSeverity: "INFO",
  headlines: [],
  activeCount: 0,
  ...patch,
});
const summary = (patch = {}) => ({
  mode: "QUIET",
  generatedAt: "2026-11-08T12:00:00Z",
  domains: ["fire", "evacuation", "weather", "roads", "seismic", "power"].map(
    (n) => domain(n),
  ),
  ...patch,
});
test("closed road condition gets attention even with a QUIET aggregate; never event-detail link", () => {
  const input = summary();
  input.domains[3] = domain("roads", {
    highestSeverity: "SEVERE",
    headlines: [
      {
        id: "road:hwy4",
        headline: "Highway 4 closed",
        severity: "SEVERE",
        kind: "CONDITION",
        layer: "ROAD_SEGMENT",
      },
    ],
  });
  const out = attentionFor(input);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].view, "roads");
  assert.equal(out.items[0].record, "");
});
test("stale important evidence remains visible and cannot count as healthy quiet", () => {
  const input = summary();
  input.domains[0] = domain("fire", {
    status: "STALE",
    highestSeverity: "EXTREME",
    headlines: [
      {
        id: "calfire:one",
        headline: "Reported wildfire",
        severity: "EXTREME",
        kind: "EVENT",
        layer: "WILDFIRE",
      },
    ],
  });
  const out = attentionFor(input);
  assert.equal(out.complete, false);
  assert.equal(out.items[0].record, "calfire:one");
  assert.equal(out.items[0].health, "STALE");
});
test("healthy empty, unavailable coverage and missing domain are distinct", () => {
  assert.equal(attentionFor(summary()).complete, true);
  const input = summary();
  input.domains[1].status = "UNAVAILABLE";
  assert.equal(attentionFor(input).complete, false);
  input.domains.pop();
  assert.deepEqual(attentionFor(input).missing, ["power"]);
});
test("ambient mesh counts and benign burns do not inflate attention", () => {
  const input = summary();
  input.domains.push(
    domain("comms", { highestSeverity: "SEVERE", activeCount: 1000 }),
    domain("burn", { highestSeverity: "MODERATE" }),
  );
  assert.equal(attentionFor(input).items.length, 0);
});

test("the severity sentence is counted from the list it sits beside, whatever the list holds", () => {
  const summary = { generatedAt: "2026-11-19T03:38:00Z", domains: [
    { domain: "weather", status: "OK", highestSeverity: "SEVERE", headlines: [{ id: "wx:1", kind: "EVENT", layer: "WEATHER_ALERT", severity: "SEVERE", headline: "Winter Storm Warning" }] },
    // A seasonal closure past a road's end: a condition with no event behind it.
    { domain: "roads", status: "OK", highestSeverity: "SEVERE", headlines: [
      { id: "road:hwy4-arnold-bearvalley:beyond-0", kind: "CONDITION", layer: "ROAD_SEGMENT", severity: "SEVERE", headline: "Hwy 4: Ebbetts Pass winter closure" },
      { id: "chp:1", kind: "EVENT", layer: "ROAD_INCIDENT", severity: "MODERATE", headline: "Collision" }] },
    { domain: "fire", status: "OK", highestSeverity: "INFO", headlines: [] },
    { domain: "evacuation", status: "OK", highestSeverity: "INFO", headlines: [] },
    { domain: "power", status: "OK", highestSeverity: "INFO", headlines: [] },
  ] };
  const { items } = attentionFor(summary);
  assert.equal(items.filter((i) => i.rank >= 3).length, 2);
  assert.equal(attentionSentence(items), "2 are severe.");
  for (let n = 0; n <= items.length; n++) {
    const shown = items.slice(0, n), severe = shown.filter((i) => i.rank === 3).length;
    assert.equal(attentionSentence(shown), severe ? `${severe} ${severe === 1 ? "is" : "are"} severe.` : "None are rated severe or extreme.");
  }
  assert.equal(attentionSentence([{ rank: 4 }, { rank: 3 }]), "1 is extreme.");
  assert.equal(attentionSentence([]), "None are rated severe or extreme.");
});
