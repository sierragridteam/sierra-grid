/**
 * Weather page model: units, the snow level against the towns, 24-hour
 * outlook figures, days from NWS day/night periods, and the headline. Pure, so
 * it can be tested without a browser.
 */
export type Units = "F" | "C";

export type Period = {
  time: string | null; temperatureCelsius: number; humidityPercent: number; windSpeedKmh: number; windGustKmh: number;
  precipitationProbabilityPercent: number | null; precipitationMm: number | null; snowfallMm: number | null;
  snowLevelMeters: number | null; skyCoverPercent: number | null; weather: string;
};
export type Daily = {
  name: string; start: string | null; end: string | null; isDaytime: boolean; temperatureCelsius: number;
  precipitationProbabilityPercent: number | null; shortForecast: string; detailedForecast: string; windSpeed: string; windDirection: string;
};
export type Forecast = { locationId: string; periods: Period[]; daily: Daily[]; issuedAt?: string | null; source?: string };
export type Town = { id: string; name: string; latitude: number; longitude: number; elevationMeters: number | null };
export type Alert = { id: string; headline: string; severity: string; status: string; effective?: string | null; expires?: string | null };

const HOUR = 3_600_000;
const round = (n: number, step = 1) => Math.round(n / step) * step;
const num = (n: number) => n.toLocaleString("en-US");

/** Display in the reader's units: °F goes with feet, mph and inches; °C with metres, km/h and mm/cm. */
export const units = (u: Units) => ({
  temp: (c: number) => `${Math.round(u === "F" ? (c * 9) / 5 + 32 : c)}°`,
  tempValue: (c: number) => (u === "F" ? (c * 9) / 5 + 32 : c),
  tempUnit: `°${u}`,
  elevation: (m: number) => (u === "F" ? `${num(round(m * 3.28084, 100))} ft` : `${num(round(m, 50))} m`),
  /** Town elevations are exact enough to show unrounded to the ten. */
  height: (m: number) => (u === "F" ? `${num(round(m * 3.28084, 10))} ft` : `${num(round(m, 10))} m`),
  speed: (kmh: number) => (u === "F" ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`),
  speedValue: (kmh: number) => (u === "F" ? kmh * 0.621371 : kmh),
  speedUnit: u === "F" ? "mph" : "km/h",
  // Less than a hundredth of an inch (or a tenth of a millimetre) is a trace, not "0.00".
  rain: (mm: number) => (mm > 0 && mm < (u === "F" ? 0.127 : 0.05) ? "a trace" : u === "F" ? `${(mm / 25.4).toFixed(mm / 25.4 < 0.995 ? 2 : 1)} in` : `${mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm`),
  rainValue: (mm: number) => (u === "F" ? mm / 25.4 : mm),
  rainUnit: u === "F" ? "in" : "mm",
  snow: (mm: number) => (u === "F" ? `${(mm / 25.4).toFixed(mm / 25.4 < 9.95 ? 1 : 0)} in` : `${(mm / 10).toFixed(mm < 100 ? 1 : 0)} cm`),
  snowValue: (mm: number) => (u === "F" ? mm / 25.4 : mm / 10),
  snowUnit: u === "F" ? "in" : "cm",
});

const t = (p: { time: string | null }) => (p.time ? Date.parse(p.time) : NaN);
/** Hourly periods that cover [from, to): a period stands for the hour starting at its time. */
export const within = (periods: Period[], from: number, to: number) => periods.filter((p) => t(p) + HOUR > from && t(p) < to);

/** Exactly the next `hours` hourly periods, starting with the hour now is in (not 25 when now is mid-hour). */
export const nextHours = (periods: Period[], now: number, hours = 24) => { const from = Math.floor(now / HOUR) * HOUR; return periods.filter((p) => t(p) >= from && t(p) < from + hours * HOUR); };

/**
 * The regional snow level: the mean across towns for the current hour, and
 * where it goes over the window (lowest and highest, with the hour of each).
 */
export function snowLevel(forecasts: Forecast[], now: number, hours = 24) {
  const byHour = new Map<number, number[]>();
  for (const f of forecasts) for (const p of nextHours(f.periods, now, hours)) if (p.snowLevelMeters !== null && Number.isFinite(p.snowLevelMeters)) byHour.set(t(p), [...(byHour.get(t(p)) ?? []), p.snowLevelMeters]);
  const series = [...byHour].sort((a, b) => a[0] - b[0]).map(([time, v]) => ({ time, meters: v.reduce((a, b) => a + b, 0) / v.length }));
  if (!series.length) return undefined;
  const lowest = series.reduce((a, b) => (b.meters < a.meters ? b : a));
  const highest = series.reduce((a, b) => (b.meters > a.meters ? b : a));
  return { now: series[0].meters, lowest, highest, series };
}

/** Per town over the window: rain and snow totals, the peak gust and the temperature range. */
export function outlook(f: Forecast, now: number, hours = 24) {
  const ps = nextHours(f.periods, now, hours);
  const sum = (pick: (p: Period) => number | null) => ps.reduce((n, p) => n + (pick(p) ?? 0), 0);
  const gust = ps.reduce<Period | undefined>((a, p) => (!a || p.windGustKmh > a.windGustKmh ? p : a), undefined);
  const temps = ps.map((p) => p.temperatureCelsius);
  return {
    locationId: f.locationId, hours: ps.length,
    precipitationMm: sum((p) => p.precipitationMm), snowfallMm: sum((p) => p.snowfallMm),
    gustKmh: gust?.windGustKmh ?? 0, gustAt: gust ? t(gust) : NaN,
    low: temps.length ? Math.min(...temps) : NaN, high: temps.length ? Math.max(...temps) : NaN,
  };
}

/** Great-circle distance in km. */
export function km(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** The Hwy 4 towns, bottom to top, with their distance up the road from the first. */
export const HWY4 = ["murphys", "arnold", "dorrington", "bearvalley"];
export function climb(towns: Town[], order = HWY4) {
  const stops = order.map((id) => towns.find((x) => x.id === id)).filter((x): x is Town => !!x && x.elevationMeters !== null);
  let at = 0;
  return stops.map((s, i) => {
    if (i) at += km([stops[i - 1].longitude, stops[i - 1].latitude], [s.longitude, s.latitude]);
    return { ...s, elevationMeters: s.elevationMeters!, at };
  });
}

/** An icon for forecast or observation text. Snow wins over rain: it is what changes plans. */
export function weatherIcon(text: string) {
  if (/snow|flurr|blizzard|sleet|wintry/i.test(text)) return "cloud-snow";
  if (/rain|shower|drizzle|thunder|storm/i.test(text)) return "cloud-rain";
  if (/partly|mostly sunny|mostly clear|few clouds|scattered/i.test(text)) return "cloud-sun";
  if (/cloud|overcast|fog|haze|mist/i.test(text)) return "cloud";
  if (/wind|breezy|blustery/i.test(text)) return "wind";
  return /clear|sun|fair/i.test(text) ? "sun" : undefined;
}

/**
 * NWS gives day and night periods in turn. One entry per calendar day: the
 * day period's high and words, the following night's low. A forecast that
 * starts at night ("Tonight") has no high for its first day.
 */
export function days(daily: Daily[], timeZone: string, now: number) {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }), date = new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric" });
  const label = { format: (v: number) => `${weekday.format(v)} ${date.format(v)}` };
  const out: { key: string; label: string; high?: number; low?: number; chance: number | null; note: string; title: string }[] = [];
  for (const p of daily) {
    if (!p.start) continue;
    const start = Date.parse(p.start);
    // A night period belongs to the day it starts on (it starts in the evening).
    const k = key.format(start);
    let d = out.find((x) => x.key === k);
    if (!d) out.push((d = { key: k, label: k === key.format(now) ? "Today" : label.format(start), chance: null, note: "", title: "" }));
    if (p.isDaytime) { d.high = p.temperatureCelsius; d.note = p.shortForecast; } else { d.low = p.temperatureCelsius; d.note ||= p.shortForecast; }
    if (p.precipitationProbabilityPercent !== null) d.chance = Math.max(d.chance ?? 0, p.precipitationProbabilityPercent);
    d.title += `${d.title ? " " : ""}${p.name}: ${p.detailedForecast}`;
  }
  return out;
}

const RANK: Record<string, number> = { EXTREME: 4, SEVERE: 3, MODERATE: 2, MINOR: 1, INFO: 0 };
/** In effect now or still to come, most severe first, then soonest to end. */
export function currentAlerts<T extends Alert>(alerts: T[], now: number) {
  return alerts
    .filter((a) => a.status !== "RESOLVED" && a.status !== "CANCELLED" && !(a.expires && Date.parse(a.expires) < now))
    .sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0) || Date.parse(a.expires ?? "") - Date.parse(b.expires ?? ""));
}
export const alertTone = (severity: string) => ((RANK[severity] ?? 0) >= 3 ? "alarm" : (RANK[severity] ?? 0) === 2 ? "elevated" : "muted") as "alarm" | "elevated" | "muted";
/** "until Sat 10:00" for one in effect, "from Fri 16:00" for one to come. */
export function alertWindow(a: Alert, now: number, fmt: (t: number) => string) {
  const from = a.effective ? Date.parse(a.effective) : NaN, to = a.expires ? Date.parse(a.expires) : NaN;
  if (Number.isFinite(from) && from > now) return `from ${fmt(from)}`;
  return Number.isFinite(to) ? `until ${fmt(to)}` : "in effect";
}

/**
 * The page's headline: the most severe alert and when it ends; otherwise the
 * weather in a sentence. Lines under it carry the other alerts and what the
 * snow level is doing.
 */
export function headline(o: {
  alerts: Alert[]; now: number; fmt: (t: number) => string; u: ReturnType<typeof units>;
  snow?: ReturnType<typeof snowLevel>; stops: { name: string; elevationMeters: number }[];
  current: { temperatureCelsius: number; weatherDescription: string }[];
  totals: { precipitationMm: number; snowfallMm: number }[];
}) {
  const alerts = currentAlerts(o.alerts, o.now);
  const lines = alerts.slice(1).map((a) => `${a.headline} ${alertWindow(a, o.now, o.fmt)}`);
  if (o.snow) {
    // Name the towns the snow level reaches: that is what the number means.
    const reached = o.stops.filter((s) => s.elevationMeters >= o.snow!.lowest.meters).map((s) => s.name.split(",")[0]);
    const falling = o.snow.now - o.snow.lowest.meters > 150;
    const snowing = o.totals.some((x) => x.snowfallMm > 0);
    if (snowing || falling)
      lines.push(`Snow level ${falling ? `falling to ${o.u.elevation(o.snow.lowest.meters)} by ${o.fmt(o.snow.lowest.time)}` : `near ${o.u.elevation(o.snow.now)}`}${reached.length ? ` — reaches ${list(reached)}` : ""}`);
  }
  if (alerts.length) return { title: `${alerts[0].headline} ${alertWindow(alerts[0], o.now, o.fmt)}`, lines, tone: alertTone(alerts[0].severity) };
  const temps = o.current.map((c) => c.temperatureCelsius);
  const wet = Math.max(0, ...o.totals.map((x) => x.precipitationMm));
  const words = mostCommon(o.current.map((c) => c.weatherDescription)) || "No observations";
  const title = `${words[0].toUpperCase()}${words.slice(1)}${temps.length ? `, ${o.u.temp(Math.min(...temps))} to ${o.u.temp(Math.max(...temps))}` : ""}`;
  if (wet >= 0.5) lines.unshift(`Up to ${o.u.rain(wet)} of precipitation in the next 24 hours`);
  return { title, lines, tone: "ok" as const };
}

export const list = (items: string[]) => (items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
function mostCommon(items: string[]) {
  const counts = new Map<string, number>();
  for (const i of items.filter(Boolean)) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}
