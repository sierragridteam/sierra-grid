/**
 * The mesh view is the network overview. A node's measurements and history live
 * in its report (Events), so an old `?node=` link redirects there.
 */
import { navigate } from "@sierragridteam/design-system/lib/app";
import { mountNetwork } from "./mesh-network";
import type { Context } from "../context";
import { stateUrl } from "../state";

/** The report URL for a mesh node (its event id is `meshcore:<public key>`). */
export const nodeReportUrl = (state: Context["state"], key: string) =>
  stateUrl({ ...state, topic: "events", layer: "MESH", record: `meshcore:${key}`, revision: "", node: "", compare: "", autoSelect: true, timeExplicit: false });

export async function mount(ctx: Context) {
  if (ctx.state.node) {
    void navigate(nodeReportUrl(ctx.state, ctx.state.node), { replace: true });
    return;
  }
  return mountNetwork(ctx);
}
