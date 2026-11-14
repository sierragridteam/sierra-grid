/** DS shell behavior: a persistent desktop nav, a keyboard-contained mobile drawer. */
export function installDrawer(signal: AbortSignal) {
  const shell = document.querySelector<HTMLElement>(".grid-shell")!;
  const sidebar = document.getElementById("grid-navigation")!;
  const column = document.querySelector<HTMLElement>(".grid-column")!;
  const toggle = document.getElementById("navigation-toggle")!;
  const mobile = matchMedia("(max-width: 860px)");
  let open = false;
  const update = (next: boolean, restoreFocus = false) => {
    open = mobile.matches && next;
    shell.dataset.drawer = open ? "open" : "closed";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
    sidebar.inert = mobile.matches && !open;
    column.inert = open;
    document.body.style.overflow = open ? "hidden" : "";
    if (open)
      sidebar.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    else if (restoreFocus) toggle.focus();
  };
  toggle.addEventListener("click", () => update(!open, true), { signal });
  document
    .querySelectorAll("[data-close-navigation]")
    .forEach((button) =>
      button.addEventListener("click", () => update(false, true), { signal }),
    );
  sidebar.addEventListener(
    "click",
    (event) => {
      if ((event.target as HTMLElement).closest("a")) update(false);
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        update(false, true);
      }
      if (event.key === "Tab") {
        const links = Array.from(
          sidebar.querySelectorAll<HTMLElement>(
            "a[href], button:not([disabled])",
          ),
        );
        const first = links[0],
          last = links.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    },
    { signal },
  );
  mobile.addEventListener("change", () => update(false), { signal });
  signal.addEventListener("abort", () => update(false), { once: true });
  update(false);
}
