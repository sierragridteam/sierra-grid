/**
 * Who is watching the mesh: the reporters that push monitor readings (the
 * SIERRA relay, an operator's own monitor), the gateway radios the relay
 * reads, and the repeaters each reads on a schedule. Answers "is my gateway
 * up" and "what is it reporting for". Pure, so it can be tested.
 */
import { since } from "./conditions-model.ts";

export type Radio = {
  id: string; key: string; name: string;
  /** A gateway is the radio paired with the relay (a companion); the rest are repeaters it reads. */
  role: "gateway" | "repeater";
  reporterId: string;
  /** Last successful read and last try (epoch ms; NaN when never). */
  read: number; tried: number;
  batteryVolts?: number | null; noiseFloorDbm?: number | null; uptimeSeconds?: number | null;
};
export type Reporter = { id: string; name: string; status: string; lastSuccessAt?: string | null; pollIntervalSeconds?: number };
export type Verdict = { tone: "ok" | "elevated" | "alarm"; label: string; detail: string; due?: number };

const MIN = 60_000;
/**
 * The relay's own schedule: gateways every 5 minutes, shared repeaters every
 * 30. An operator's own monitor keeps irregular hours, so nothing is "due" there and only a long
 * silence is worth flagging.
 */
export const GATEWAY_EVERY = 5 * MIN, GATEWAY_FRESH = 15 * MIN, REPEATER_EVERY = 30 * MIN, REPEATER_OVERDUE = 60 * MIN, OTHER_OVERDUE = 8 * 60 * MIN;
const ms = (v?: string | null) => (v ? Date.parse(v) : NaN);

type MeshEvent = { id: string; headline: string; mesh?: { publicKey?: string; name?: string; nodeType?: string; telemetry?: unknown } | null };
/** The monitored radios among mesh records: those a reporter has readings for. */
export function radios(events: MeshEvent[]): Radio[] {
  return events.flatMap((e) => {
    const a = (e.mesh?.telemetry as { admin?: Record<string, any> | null } | undefined)?.admin;
    if (!a?.reporterId || !e.mesh?.publicKey) return [];
    const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    return [{
      id: e.id, key: e.mesh.publicKey, name: (e.mesh.name || e.headline).replace(/\s*\(companion\)$/i, ""),
      role: /companion/i.test(e.mesh.nodeType ?? "") ? "gateway" as const : "repeater" as const, reporterId: String(a.reporterId),
      read: ms(a.lastSuccessAt), tried: ms(a.lastAttemptAt), batteryVolts: num(a.batteryVolts), noiseFloorDbm: num(a.noiseFloorDbm), uptimeSeconds: num(a.uptimeSeconds),
    }];
  });
}

/**
 * Is it up. A try that failed after the last good read is a real "no answer".
 * A gateway that simply has not been read lately is not: the relay records no
 * try while someone is using the radio or its host has paused it.
 */
export function verdict(r: Radio, now: number): Verdict {
  if (!Number.isFinite(r.read) && !Number.isFinite(r.tried)) return { tone: "elevated", label: "Not read yet", detail: "No read on record" };
  const answered = Number.isFinite(r.read) ? `last answered ${since(r.read, now)} ago` : "never answered";
  if (Number.isFinite(r.tried) && (!Number.isFinite(r.read) || r.tried > r.read + MIN))
    return { tone: "alarm", label: "No answer", detail: `Tried ${since(r.tried, now)} ago; ${answered}` };
  if (r.role === "gateway") {
    if (Number.isFinite(r.read) && now - r.read <= GATEWAY_FRESH) return { tone: "ok", label: "Up", detail: `Answered ${since(r.read, now)} ago`, due: r.read + GATEWAY_EVERY };
    return { tone: "elevated", label: "Not read", detail: `${answered[0].toUpperCase()}${answered.slice(1)}: in use, paused by its host, or its bridge is offline` };
  }
  const scheduled = r.reporterId === "relay";
  if (Number.isFinite(r.read) && now - r.read > (scheduled ? REPEATER_OVERDUE : OTHER_OVERDUE))
    return { tone: "elevated", label: "Read overdue", detail: `${answered[0].toUpperCase()}${answered.slice(1)}${scheduled ? "; read about every 30 min" : ""}` };
  return { tone: "ok", label: "Reachable", detail: `Read ${since(r.read, now)} ago`, due: scheduled ? r.tried + REPEATER_EVERY : undefined };
}

/** Reporters with the radios each reports for: the relay first, gateways before repeaters, problems first. */
export function monitorGroups(list: Radio[], reporters: Reporter[], now: number) {
  const ids = [...new Set(list.map((r) => r.reporterId))].sort((a, b) => Number(b === "relay") - Number(a === "relay") || a.localeCompare(b));
  const order = { alarm: 0, elevated: 1, ok: 2 };
  return ids.map((id) => {
    const source = reporters.find((s) => s.id === id);
    const mine = list.filter((r) => r.reporterId === id).map((r) => ({ ...r, verdict: verdict(r, now) }))
      .sort((a, b) => Number(b.role === "gateway") - Number(a.role === "gateway") || order[a.verdict.tone] - order[b.verdict.tone] || a.name.localeCompare(b.name));
    const last = ms(source?.lastSuccessAt);
    return {
      id, name: source?.name ?? id, reporting: source ? source.status === "OK" : undefined, status: source?.status,
      lastReport: last, every: source?.pollIntervalSeconds,
      gateways: mine.filter((r) => r.role === "gateway"), repeaters: mine.filter((r) => r.role === "repeater"),
      down: mine.filter((r) => r.verdict.tone === "alarm").length,
    };
  });
}

/** Whether a repeater's reads follow the relay's schedule (and so can be "due" or "overdue" by it). */
export const onRelaySchedule = (reporterId?: string | null) => reporterId === "relay";
