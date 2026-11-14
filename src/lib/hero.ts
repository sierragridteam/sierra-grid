/**
 * The top of every page: kicker, title, a line under it. It is the design
 * system's page header (its type scale and spacing), so a page that states an
 * answer ("Hwy 4 closed past Bear Valley") and one that states its name
 * ("Events") start at the same place in the same size.
 */
import { html, nothing } from "@sierragridteam/design-system/lib/template";

export function pageHero(p: {
  kicker: string;
  title: unknown;
  /** Kept on the h1 for tests and page-specific hooks, e.g. "roads-answer". */
  titleClass?: string;
  /** The title is a warning (a closure, an alert in effect). */
  alarm?: boolean;
  /** Short facts under the title, joined with middle dots. */
  lines?: unknown[];
  /** Or one sentence under the title. */
  lead?: unknown;
  /** A control beside the header, e.g. a units switch. */
  actions?: unknown;
}) {
  const cls = [p.titleClass, p.alarm && p.titleClass ? `${p.titleClass}--alarm` : "", p.alarm ? "grid-hero__title--alarm" : ""].filter(Boolean).join(" ");
  return html`<header class="page-header grid-hero">
    <div class="page-header__text">
      <span class="kicker">${p.kicker}</span>
      <h1 class=${cls}>${p.title}</h1>
      ${p.lines?.length ? html`<p class="grid-hero__more">${p.lines.map((l, i) => html`${i ? html`<span aria-hidden="true"> · </span>` : nothing}<span>${l}</span>`)}</p>` : nothing}
      ${p.lead ? html`<p class="grid-hero__more">${p.lead}</p>` : nothing}
    </div>
    ${p.actions ?? nothing}
  </header>`;
}
