/** The API reports shortest distance to the selected place geometry, not its center. */
export function cameraDistanceText(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "Distance unavailable";
  const km = meters / 1000;
  return `${km === 0 ? "0" : km < 0.1 ? "<0.1" : km.toLocaleString("en-US", { maximumFractionDigits: 1 })} km from corridor`;
}
export function cameraRoutes(cameras: readonly { route: string }[]): string[] {
  return [...new Set(cameras.map((c) => c.route).filter(Boolean))];
}

/** An exact route label match is not evidence that a camera sees an incident. */
export function cameraRouteCoverage(
  route: string,
  cameras: readonly { route: string }[],
): string {
  if (!route) return "";
  const count = cameras.filter((camera) => camera.route === route).length;
  return count
    ? `${count} nearby camera${count === 1 ? "" : "s"} labeled ${route}; incident visibility is not established.`
    : `No returned camera is labeled ${route}.`;
}
