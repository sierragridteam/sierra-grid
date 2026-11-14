import type { Context } from "../context";
import { data } from "../context";
import { btn, empty } from "../render";
import { cameraDashboard, bindCameraMedia } from "./road-media";

export async function mount(ctx: Context) {
  const { state, client, $ } = ctx;
  $("content").innerHTML =
    `<header class="road-page-heading"><h1>Road cameras</h1><p>See the roads actually covered by nearby cameras.</p></header>`;
  if (state.mode !== "now") {
    $("content").innerHTML +=
      empty(
        "Camera footage is current only. No historical or predicted imagery is available for these bounds. Your selected interval is retained.",
      ) +
      '<button class="btn btn--outline" data-current="cameras">Open current camera context →</button>';
    return;
  }
  const [scoped, catalog] = await Promise.allSettled([
    data(client.listCameras({ place: state.place })),
    data(client.listCameras()),
  ]);
  if (scoped.status !== "fulfilled") throw scoped.reason;
  const d = scoped.value;
  if (ctx.signal.aborted) return;
  $("content").insertAdjacentHTML(
    "beforeend",
    (catalog.status === "fulfilled"
      ? `<p class="meta">${d.cameras.length} views returned for this place · ${catalog.value.cameras.length} in the current service directory. The directory is limited to configured source districts and nearby coverage areas; it is not a census of all regional cameras.</p>`
      : "") +
      cameraDashboard(d, true) +
      `<div class="actions">${btn("Road reports & restrictions", "roads")}${btn("Weather ahead", "weather")}</div>`,
  );
  bindCameraMedia(ctx, $("content"));
}
