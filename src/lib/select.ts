/** Adapt Grid-owned native field declarations to the published Select API. */
import { createSelect, type SierraSelect } from "@sierragridteam/design-system/lib/select";

export function sourceSelect(id: string): HTMLSelectElement {
  return (document.getElementById(id + "-source") || document.getElementById(id)) as HTMLSelectElement;
}
export function setChoice(id: string, value: string) {
  const source = sourceSelect(id);
  source.value = value;
  const control = document.getElementById(id + "-control") as SierraSelect | null;
  if (control) control.value = value;
}
export function upgradeSelects(root: ParentNode = document) {
  root.querySelectorAll<HTMLSelectElement>("select:not([data-ds-choice])").forEach(source => {
    if (!source.id) return;
    const id = source.id;
    if (source.parentElement?.tagName === "LABEL") {
      const old = source.parentElement, field = document.createElement("div"), label = document.createElement("label");
      field.className = old.className || "field";
      label.className = "field__label"; label.htmlFor = id;
      while (old.firstChild && old.firstChild !== source) label.append(old.firstChild);
      field.append(label);
      while (old.firstChild) field.append(old.firstChild);
      old.replaceWith(field);
    }
    const control = createSelect({ id, value: source.value, disabled: source.disabled,
      options: Array.from(source.options, option => ({ value: option.value, label: option.textContent || "", disabled: option.disabled })),
    });
    control.id = id + "-control";
    source.id = id + "-source"; source.hidden = true; source.dataset.dsChoice = "true";
    control.addEventListener("change", () => { source.value = control.value; });
    source.after(control);
  });
}
