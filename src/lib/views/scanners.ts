/**
 * Scanner feeds: the radio channels worth having open during an incident.
 * They play on Broadcastify; each card says who is on the channel and links
 * to the Grid page that covers the same thing in writing.
 */
import type { Context } from "../context";
import { httpUrl } from "../render";
import { pageHero } from "../hero";
import { data } from "../context";
import { stateUrl } from "../state";
import type { ViewId } from "../../config/views";
import { renderInto } from "@sierragridteam/design-system/lib/region";
import { html, nothing } from "@sierragridteam/design-system/lib/template";
import { card, icon, moreLink } from "@sierragridteam/design-system/lib/ui";

/** What a channel is for, from who is on it. */
function about(label: string, agency: string): { hear: string; view?: ViewId; viewLabel?: string } {
  const text = `${label} ${agency}`;
  if (/chp|highway patrol/i.test(text)) return { hear: "Traffic collisions, hazards and road closures as CHP units are sent to them.", view: "roads", viewLabel: "Roads" };
  if (/sheriff|\bso\b|police/i.test(text)) return { hear: "Sheriff and fire dispatch for the county: the first word of most local incidents.", view: "events", viewLabel: "Events" };
  if (/fire|usfs|forest/i.test(text)) return { hear: "Fire crews and command on a working incident: resources, spread and containment.", view: "WILDFIRE", viewLabel: "Wildfires" };
  return { hear: "Local public-safety radio traffic." };
}

export async function mount(ctx: Context) {
  const { state, client, $, signal } = ctx;
  $("content").innerHTML = `<div id="scanners-page"></div>`;
  const host = $("scanners-page");
  const hero = (lead: unknown) => pageHero({ kicker: "Scanner feeds · Broadcastify", title: "Listen to local dispatch", titleClass: "scanners-answer", lead });
  renderInto(host, hero("Finding the feeds…"));
  let scanners: Extract<Awaited<ReturnType<typeof client.listScanners>>, { notModified: false }>["data"]["scanners"];
  try { scanners = (await data(client.listScanners({ place: state.place }))).scanners; }
  catch {
    if (!signal.aborted) renderInto(host, html`${hero("The list of feeds could not be loaded.")}<p class="callout">Scanner feeds are unavailable right now. Reload the page to try again.</p>`);
    return;
  }
  if (signal.aborted) return;
  const pageUrl = (view: ViewId) => stateUrl({ ...state, topic: view, layer: "ALL", record: "", revision: "", timeExplicit: false } as any);
  renderInto(host, html`
    ${hero(scanners.length ? `${scanners.length === 1 ? "One live radio feed" : `${scanners.length} live radio feeds`} for the corridor. Radio is often minutes ahead of any written report, and unconfirmed: treat what you hear as a lead, not a fact.` : "No feeds are set up for this area.")}
    <div class="dashboard scanners-grid">
      ${scanners.map((s) => { const a = about(s.channelLabel, s.agency); return card({ variant: "panel", title: s.channelLabel, kicker: s.agency, as: "article", class: "scanners-feed",
          actions: a.view ? moreLink(pageUrl(a.view), a.viewLabel!) : undefined },
        html`<p class="scanners-hear">${a.hear}</p>
          <p class="scanners-listen"><a class="btn btn--primary" href=${httpUrl(s.broadcastifyUrl) || "https://www.broadcastify.com/"} target="_blank" rel="noopener" aria-label=${`Listen to ${s.channelLabel} on Broadcastify`}>Listen ${icon("external")}</a><span class="meta">Opens Broadcastify · feed ${s.feedId}</span></p>`); })}
    </div>
    ${scanners.length ? html`<p class="meta scanners-footnote">The audio is Broadcastify's, streamed from volunteers' receivers, usually 30 seconds to 2 minutes behind the air. Grid does not record it or check whether a feed is up.</p>` : nothing}`);
}
