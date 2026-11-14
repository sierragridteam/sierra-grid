import type { Context } from "../context";
import { esc, fmt, httpUrl } from "../render";
import { cameraDistanceText, cameraRoutes } from "./camera-geography";
type CameraResponse = Extract<
  Awaited<ReturnType<Context["client"]["listCameras"]>>,
  { notModified: false }
>["data"];
export function cameraDashboard(d: CameraResponse, detailed = false) {
  // Preserve the service's nearest-first order. Route order would imply a journey
  // the proximity query does not establish.
  const ordered = d.cameras;
  const routes = cameraRoutes(ordered);
  return `${detailed ? `<p class="meta">${d.cameras.length} views · ${esc(d.sourceStatus.toLowerCase())} · ${esc(d.attribution)}</p>` : `<div class="section-header"><h2>Nearby camera views</h2><span class="badge badge--plain">${d.cameras.length} views · ${esc(d.sourceStatus.toLowerCase())}</span></div>`}<p class="road-camera-primary">${ordered.some((camera) => camera.route === "SR-4") ? "Highway 4 camera views are included below." : "No Highway 4 camera was returned for the corridor; these are supplemental views."}</p><p class="meta road-camera-coverage">${routes.length ? `Views on ${routes.map(esc).join(" · ")}. Nearby roads, not necessarily the selected route.` : "No nearby camera routes returned."}</p><div class="road-camera-grid">${ordered.map((c) => `<article class="card road-camera-card"><div class="road-camera-image" data-camera-state="${httpUrl(c.imageUrl) ? "loading" : "empty"}">${httpUrl(c.imageUrl) ? `<p class="road-image-status" role="status">Loading camera image…</p><a href="${esc(httpUrl(c.imageUrl))}" target="_blank" rel="noopener"><img class="camera" src="${esc(httpUrl(c.imageUrl))}" alt="External camera view: ${esc(c.name)}" loading="lazy" /></a>` : '<p class="road-image-empty">No still image supplied</p>'}</div><div class="card__body road-camera-caption"><div class="road-camera-title"><span class="badge badge--plain">${esc(c.route || "Camera")}</span><h2>${esc(c.name)}</h2></div><p class="meta">${esc([c.nearbyPlace, c.direction, `${c.elevationFeet.toLocaleString()} ft`].filter(Boolean).join(" · "))}</p><p class="meta">${esc(cameraDistanceText(c.distanceMeters))}</p>${detailed && c.description ? `<p>${esc(c.description)}</p>` : ""}<div class="road-camera-links">${httpUrl(c.imageUrl) ? `<a href="${esc(httpUrl(c.imageUrl))}" target="_blank" rel="noopener">Full image</a>` : ""}${httpUrl(c.streamUrl) ? `<a href="${esc(httpUrl(c.streamUrl))}" target="_blank" rel="noopener">Stream</a>` : ""}<span class="meta">${c.imageRefreshMinutes ? `${c.imageRefreshMinutes} min refresh` : "Refresh not supplied"}</span></div></div></article>`).join("")}</div><p class="meta road-camera-provenance">${esc(d.attribution)} · nearest first, within 25 km of the corridor boundary. Distances are not driving distances; 0 km means on or inside the corridor. Frame capture time unavailable.${d.lastSourceUpdate ? ` Directory updated ${fmt(d.lastSourceUpdate)}.` : ""}</p>${ordered.length ? "" : '<p class="callout">No cameras returned within the service’s nearby-camera area. Road reports and conditions remain available.</p>'}`;
}

/** Images load independently of the directory. A slow camera is not a failed camera. */
export function bindCameraMedia(ctx: Context, host: HTMLElement) {
  host.querySelectorAll<HTMLImageElement>("img.camera").forEach((image) => {
    const wrapper = image.closest<HTMLElement>(".road-camera-image")!;
    const status = wrapper.querySelector<HTMLElement>(".road-image-status")!;
    const update = () => {
      if (ctx.signal.aborted) return;
      const loaded = image.naturalWidth > 0;
      wrapper.dataset.cameraState = loaded ? "loaded" : "error";
      status.hidden = loaded;
      status.textContent = loaded
        ? ""
        : "Camera image unavailable. Open the source image or stream below.";
      image.hidden = !loaded;
    };
    image.addEventListener("load", update, { signal: ctx.signal });
    image.addEventListener("error", update, { signal: ctx.signal });
    if (image.complete) update();
  });
}
