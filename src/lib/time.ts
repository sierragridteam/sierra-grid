/** Human-facing time belongs to the region; API and shared URLs remain ISO UTC. */
export const regionTimeZone = "America/Los_Angeles";
export function regionalTime(value: unknown, compact = false): string {
  if (value === null || value === undefined || value === "")
    return "Not reported";
  const date = new Date(
    value instanceof Date
      ? +value
      : typeof value === "number"
        ? value
        : String(value),
  );
  if (!Number.isFinite(+date)) return "Not reported";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: regionTimeZone,
    month: "short",
    day: "numeric",
    ...(date.getUTCFullYear() !== new Date().getUTCFullYear()
      ? { year: "numeric" as const }
      : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date) + (compact ? "" : " PT");
}
export function localInput(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: regionTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = (name: string) => parts.find((part) => part.type === name)?.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}
/** Reject nonexistent spring-forward times. Repeated autumn times use the first occurrence. */
export function parseLocalInput(value: string): number {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return NaN;
  const wall = Date.parse(value + "Z");
  if (!Number.isFinite(wall)) return NaN;
  for (const hours of [7, 8]) {
    const candidate = wall + hours * 3600000;
    if (localInput(new Date(candidate).toISOString()) === value)
      return candidate;
  }
  return NaN;
}
