import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionFor } from "../src/lib/attention.ts";
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
