import type { createSierraClient } from '@sierragridteam/sdk';
type Client = ReturnType<typeof createSierraClient>;
export type Body<K extends keyof Client> = NonNullable<Awaited<ReturnType<Client[K]>>['data']>;
export type NodeEvent = Body<'listEvents'>['events'][number];
export type Telemetry = Body<'getMeshTelemetry'>;
export type Metric = 'battery' | 'temperature' | 'packets' | 'snr';
export function lastActivity(event: NodeEvent) { return event.mesh?.telemetry?.lastRelayedAt || event.mesh?.telemetry?.lastHeardAt || null; }
export function seriesPoints(data: Telemetry, metric: Metric) {
    const cadence = Number(data.cadenceSeconds) * 1000;
    const samples = [...data.samples].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
    return samples.flatMap((sample, i) => {
        const time = Date.parse(sample.receivedAt), prev = samples[i - 1], previousTime = prev ? Date.parse(prev.receivedAt) : NaN;
        const gap = prev && (cadence <= 0 || time - previousTime > cadence * 1.5);
        let value: number | null = metric === 'battery' ? sample.reading.batteryPercent : metric === 'temperature' ? sample.reading.temperatureC : metric === 'snr' ? sample.reading.lastSnrDb : null;
        if (metric === 'packets' && prev && !gap && time > previousTime) {
            const reset = BigInt(sample.reading.uptimeSeconds) < BigInt(prev.reading.uptimeSeconds) || data.reboots.some(t => Date.parse(t) > previousTime && Date.parse(t) <= time);
            const delta = BigInt(sample.reading.packetsSent) - BigInt(prev.reading.packetsSent);
            if (!reset && delta >= 0 && delta <= BigInt(Number.MAX_SAFE_INTEGER))
                value = Number(delta) / ((time - previousTime) / 60000);
        }
        return [...(gap ? [{ time: previousTime + 1, value: null }] : []), { time, value }];
    });
}
export function gapCount(data: Telemetry) {
    const cadence = Number(data.cadenceSeconds) * 1000;
    if (cadence <= 0)
        return null;
    const times = data.samples.map(s => Date.parse(s.receivedAt)).sort((a, b) => a - b);
    return times.filter((t, i) => i > 0 && t - times[i - 1]! > cadence * 1.5).length;
}
