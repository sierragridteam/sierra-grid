import type { V1MeshTelemetryArchive, V1Event } from '@sierragridteam/sdk';
export function heardAt(event: V1Event): string | null {
  return event.mesh?.telemetry?.lastRelayedAt || event.mesh?.telemetry?.lastHeardAt || null;
}
export function isRecent(event: V1Event, now: number): boolean {
  const at = heardAt(event);
  return !!at && now - Date.parse(at) <= 86400000;
}
export function samplePoints(archive: V1MeshTelemetryArchive, metric: string) {
  const samples = [...archive.samples].sort((a,b) => a.receivedAt.localeCompare(b.receivedAt));
  const cadence = Number(archive.cadenceSeconds) * 1000;
  return samples.map((sample,index) => {
    const time = Date.parse(sample.receivedAt);
    if (metric !== 'packets') {
      const key = metric as 'batteryPercent' | 'lastSnrDb' | 'lastRssiDbm' | 'temperatureC';
      return { time, value: sample.reading[key] ?? null };
    }
    const prev = samples[index-1];
    if (!prev) return {time,value:null};
    const start = Date.parse(prev.receivedAt), duration = time-start;
    const reset = BigInt(sample.reading.packetsReceived) < BigInt(prev.reading.packetsReceived)
      || BigInt(sample.reading.uptimeSeconds) < BigInt(prev.reading.uptimeSeconds)
      || archive.reboots.some(at => Date.parse(at)>start && Date.parse(at)<=time);
    if (reset || duration <= 0 || !cadence || duration > cadence*1.5) return {time,value:null};
    const delta = BigInt(sample.reading.packetsReceived)-BigInt(prev.reading.packetsReceived);
    return {time,value: delta > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(delta)/(duration/60000)};
  });
}
export function gapCount(archive: V1MeshTelemetryArchive) {
  const cadence = Number(archive.cadenceSeconds)*1000;
  if (!cadence) return null;
  const samples = [...archive.samples].sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt));
  return samples.slice(1).filter((s,i)=>Date.parse(s.receivedAt)-Date.parse(samples[i].receivedAt)>cadence*1.5).length;
}
