/**
 * Wildfire and power pages: what is active now, and the record of the season
 * when nothing is. Pure, so it can be tested without a browser.
 */
export type Report = {
  id: string; headline: string; status: string; severity: string; areaLabel?: string; description?: string;
  effective?: string | null; expires?: string | null; observedAt?: string | null; ingestedAt: string;
  provenance: { sourceId: string; sourceName: string };
  geometry?: { object?: { type: string; coordinates: unknown } | null; centroid?: { lat: number; lng: number } | null; bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null } | null;
  wildfire?: { acres?: number | null; containment?: number | null; county?: string; cause?: string; hasPerimeter?: boolean } | null;
  evacuation?: { zoneId?: string; level?: string; county?: string } | null;
  power?: { customersAffected?: number | null; medicalBaselineAffected?: number | null; estimatedRestoration?: string | null; cause?: string; crewStatus?: string; stage?: string; eventName?: string; deEnergizationStart?: string | null; allClear?: string | null } | null;
};

const ms = (v?: string | null) => (v ? Date.parse(v) : NaN);
const firstFinite = (...values: number[]) => values.find(Number.isFinite) ?? NaN;
export const isActive = (r: { status: string }) => r.status === "ACTIVE" || r.status === "SCHEDULED";
/** When the thing began, as far as the source says; else when it was first seen. */
export const startedAt = (r: Report) => firstFinite(ms(r.effective), ms(r.observedAt), ms(r.ingestedAt));
export const updatedAt = (r: Report) => Math.max(...[ms(r.observedAt), ms(r.ingestedAt)].filter(Number.isFinite), -Infinity);

export type Fire = {
  /** The report to open: CAL FIRE's when there is one (it has the place and start). */
  id: string; name: string; acres: number | null; containment: number | null; place: string;
  started: number; updated: number; active: boolean; sources: string[];
  area?: { type: string; coordinates: unknown }; point?: [number, number];
  /** The mapped perimeter's longer side in metres, known before the shape itself is loaded. */
  extent?: number;
};
const fireKey = (headline: string) => headline.split(" — ")[0].replace(/\s+fire$/i, "").trim().toUpperCase();
/** "WOODS" → "Woods"; a word with a digit ("40Y") is a designator and stays as written. */
const title = (key: string) => key.split(" ").map((w) => (/\d/.test(w) ? w : w.toLowerCase().replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase()))).join(" ");

/**
 * One entry per fire. CAL FIRE (incident) and FIRIS (mapped perimeter) report
 * the same fire separately; they are joined by name. The larger area wins:
 * a mapped perimeter is often newer than the incident's last figure.
 */
export function fires(reports: Report[]): Fire[] {
  // Same name is not enough: names recur ("Creek Fire"). Reports join when they
  // also start within three weeks of each other and, where both have a place, lie within 30 km.
  const groups: [string, Report[]][] = [];
  for (const r of [...reports].sort((a, b) => startedAt(a) - startedAt(b))) {
    const key = fireKey(r.headline);
    const home = groups.find(([k, g]) => k === key && g.some((x) => Math.abs(startedAt(x) - startedAt(r)) <= 21 * 86_400_000 && near(x, r)));
    if (home) home[1].push(r); else groups.push([key, [r]]);
  }
  return groups.map(([key, group]) => {
    const lead = group.find((r) => r.provenance.sourceId === "calfire") ?? group[0];
    const areas = group.map((r) => r.wildfire?.acres).filter((a): a is number => typeof a === "number" && Number.isFinite(a));
    const contained = group.map((r) => r.wildfire?.containment).filter((c): c is number => typeof c === "number" && c > 0);
    const shape = group.map((r) => r.geometry?.object).find((g) => g && /Polygon$/.test(g.type));
    const box = group.find((r) => r.wildfire?.hasPerimeter || /Polygon$/.test(r.geometry?.object?.type ?? ""))?.geometry?.bbox;
    const c = lead.geometry?.centroid ?? group.find((r) => r.geometry?.centroid)?.geometry?.centroid;
    return {
      id: lead.id, name: `${title(key)} Fire`, acres: areas.length ? Math.max(...areas) : null,
      // The headline carries containment when the detail does not.
      containment: contained.length ? Math.max(...contained) : Number(/(\d+)% contained/.exec(lead.headline)?.[1] ?? NaN) || (/\b0% contained/.test(lead.headline) ? 0 : null),
      place: lead.areaLabel ?? "", started: Math.min(...group.map(startedAt).filter(Number.isFinite)), updated: Math.max(...group.map(updatedAt)),
      active: group.some(isActive), sources: [...new Set(group.map((r) => r.provenance.sourceName))],
      area: shape ?? undefined, point: c ? ([c.lng, c.lat] as [number, number]) : undefined,
      extent: box ? Math.max((box.maxLat - box.minLat) * 111_320, (box.maxLng - box.minLng) * 111_320 * Math.cos(((box.minLat + box.maxLat) / 2) * Math.PI / 180)) : undefined,
    };
  }).sort((a, b) => b.started - a.started);
}

function near(a: Report, b: Report) {
  const p = a.geometry?.centroid, q = b.geometry?.centroid;
  if (!p || !q) return true;
  const rad = Math.PI / 180, x = (q.lng - p.lng) * rad * Math.cos(((p.lat + q.lat) / 2) * rad), y = (q.lat - p.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371 <= 30;
}

export const acresText = (acres: number | null) => (acres === null ? "—" : `${acres < 10 ? acres.toFixed(1).replace(/\.0$/, "") : Math.round(acres).toLocaleString("en-US")} ac`);

export function fireSeason(all: Fire[]) {
  const sized = all.filter((f) => f.acres !== null);
  return {
    count: all.length, acres: sized.reduce((n, f) => n + f.acres!, 0),
    largest: sized.reduce<Fire | undefined>((a, f) => (!a || f.acres! > a.acres! ? f : a), undefined),
    latest: all[0], since: all.length ? Math.min(...all.map((f) => f.started)) : NaN,
  };
}

/** Evacuation zones issued on the same day in the same county read as one episode. */
export function evacuationEpisodes(reports: Report[], timeZone: string) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const groups = new Map<string, Report[]>();
  for (const r of reports) {
    const key = `${day.format(startedAt(r))}|${(r.evacuation?.county || r.areaLabel || "").toUpperCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((group) => ({
    id: group[0].id, at: Math.min(...group.map(startedAt)), county: title((group[0].evacuation?.county || group[0].areaLabel || "Unknown").toUpperCase()),
    orders: group.filter((r) => r.evacuation?.level === "ORDER").length, warnings: group.filter((r) => r.evacuation?.level === "WARNING").length,
    others: group.filter((r) => r.evacuation?.level !== "ORDER" && r.evacuation?.level !== "WARNING").length,
    zones: group.map((r) => r.evacuation?.zoneId ?? "").filter(Boolean), text: group.find((r) => r.description)?.description ?? "",
  })).sort((a, b) => b.at - a.at);
}

export const isShutoff = (r: Report) => r.provenance.sourceId === "psps" || /^PSPS/i.test(r.headline);
export const customers = (r: Report) => r.power?.customersAffected ?? 0;
/** The cause in plain words: the headline carries it ("broken pole equipment"); the detail field is the utility's code ("BRKN POLE EQUIPMNT"). */
export const causeText = (r: Report) => /\(([^)]+)\)\s*$/.exec(r.headline)?.[1] ?? "";

export function powerNow(active: Report[], now: number) {
  const outages = active.filter((r) => !isShutoff(r)), shutoffs = active.filter(isShutoff);
  const estimates = outages.map((r) => ms(r.power?.estimatedRestoration)).filter((t) => Number.isFinite(t) && t > now);
  return {
    outages: [...outages].sort((a, b) => customers(b) - customers(a)), shutoffs,
    customers: outages.reduce((n, r) => n + customers(r), 0),
    medical: outages.reduce((n, r) => n + (r.power?.medicalBaselineAffected ?? 0), 0),
    nextRestoration: estimates.length ? Math.min(...estimates) : NaN, lastRestoration: estimates.length ? Math.max(...estimates) : NaN,
  };
}

/** Customers affected by interruptions starting in each week, oldest first, ending with the current week. */
export function weeklyCustomers(reports: Report[], now: number, weeks: number, timeZone: string) {
  const WEEK = 7 * 86_400_000;
  const label = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });
  const end = now, start = end - weeks * WEEK;
  const buckets = Array.from({ length: weeks }, (_, i) => ({ from: start + i * WEEK, label: label.format(start + i * WEEK), outages: 0, shutoffs: 0, count: 0 }));
  for (const r of reports) {
    const t = startedAt(r);
    if (!(t >= start && t <= end)) continue;
    const b = buckets[Math.min(weeks - 1, Math.floor((t - start) / WEEK))];
    b.count++;
    if (isShutoff(r)) b.shutoffs += customers(r); else b.outages += customers(r);
  }
  return buckets;
}

/** "4 min", "3 h", "2 days": how long ago, without "ago". */
export function since(t: number, now: number) {
  if (!Number.isFinite(t) || !Number.isFinite(now)) return "an unknown time";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} days`;
}

/**
 * Testing only (`?preview=live`): the most recent fire and the most recent
 * day's evacuation zones, or the most recent safety shutoff, shown as if
 * active, so the live layout can be seen when nothing is. Real records with
 * the status changed; the page says so.
 */
export function previewLive<T extends Report>(now: T[], past: T[], pick: (past: T[]) => T[]): { now: T[]; past: T[] } {
  const chosen = new Set(pick(past).map((r) => r.id));
  if (!chosen.size) return { now, past };
  return { now: [...now, ...past.filter((r) => chosen.has(r.id)).map((r) => ({ ...r, status: "ACTIVE" }))], past: past.filter((r) => !chosen.has(r.id)) };
}
const latest = (reports: Report[]) => reports.reduce<Report | undefined>((a, r) => (!a || startedAt(r) > startedAt(a) ? r : a), undefined);
/** Every report of the most recently started fire (both sources). */
export const latestFire = <T extends Report>(past: T[]) => { const l = latest(past); return l ? past.filter((r) => fireKey(r.headline) === fireKey(l.headline)) : []; };
/** The zones issued within a day of the most recent one. */
export const latestEvacuation = <T extends Report>(past: T[]) => { const l = latest(past); return l ? past.filter((r) => startedAt(l) - startedAt(r) < 86_400_000) : []; };
export const latestShutoff = <T extends Report>(past: T[]) => { const l = latest(past.filter(isShutoff)); return l ? past.filter((r) => r.id === l.id) : []; };

/** Reports with their shapes attached once those have loaded (the lists are read without them). */
export const withShapes = <T extends Report>(reports: T[], shapes: Map<string, { type: string; coordinates: unknown }>) =>
  reports.map((r) => (shapes.has(r.id) ? { ...r, geometry: { ...r.geometry, object: shapes.get(r.id) } } : r));

/**
 * The zoom above which an area `extent` metres across is a bigger mark than
 * a dot of `radius` pixels, at this latitude: the dot can give way there.
 * Web-map scale: 78,271.5 m per pixel at zoom 0 on the equator (512 px tiles).
 */
export function dotMaxZoom(extent: number, lat: number, radius: number) {
  if (!(extent > 0)) return undefined;
  return Math.round(Math.log2((2 * radius * 78_271.5 * Math.cos((lat * Math.PI) / 180)) / extent) * 10) / 10;
}
