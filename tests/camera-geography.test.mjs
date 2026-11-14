import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cameraDistanceText,
  cameraRoutes,
  cameraRouteCoverage,
} from "../src/lib/views/camera-geography.ts";
test("camera distance describes the selected geometry, never drive time or centroid distance", () => {
  assert.equal(cameraDistanceText(0), "0 km from corridor");
  assert.equal(cameraDistanceText(13242), "13.2 km from corridor");
  assert.equal(cameraDistanceText(12), "<0.1 km from corridor");
  assert.equal(cameraDistanceText(NaN), "Distance unavailable");
  assert.equal(cameraDistanceText(-1), "Distance unavailable");
});
test("actual camera routes remain distinct from the selected route and retain nearest-first encounter order", () => {
  const cameras = [
    { route: "SR-108" },
    { route: "SR-88" },
    { route: "SR-120" },
    { route: "SR-120" },
    { route: "" },
  ];
  assert.deepEqual(cameraRoutes(cameras), ["SR-108", "SR-88", "SR-120"]);
  assert.equal(cameras.length, 5);
});

test("route label matching never treats a highway prefix as camera coverage", () => {
  const cameras = [{ route: "SR-40" }, { route: "SR-49" }, { route: "SR-49" }];
  assert.equal(
    cameraRouteCoverage("SR-4", cameras),
    "No returned camera is labeled SR-4.",
  );
  assert.equal(
    cameraRouteCoverage("SR-49", cameras),
    "2 nearby cameras labeled SR-49; incident visibility is not established.",
  );
  assert.equal(cameraRouteCoverage("", cameras), "");
});
