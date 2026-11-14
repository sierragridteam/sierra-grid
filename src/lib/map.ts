/** Grid evidence composed through the published map properties. */
import { createGeoMap, type GeoMapProps, type SierraGeoMap } from "@sierragridteam/design-system/lib/geo-map";

export function mountMap(target: HTMLElement, features: Array<{ type: "Feature"; geometry: unknown; properties: Record<string, unknown> }>, label: string, options: Partial<GeoMapProps> = {}): SierraGeoMap | undefined {
  if (!features.some(f => f.geometry)) return;
  // SDK responses are Zod-validated GeoJSON; its generated coordinate type is unknown[].
  const map = createGeoMap({ label, data: { type: "FeatureCollection", features: features as GeoMapProps["data"]["features"] }, compact: true, basemap: true, labels: "selected", featureList: false, ...options });
  target.replaceChildren(map);
  return map;
}
