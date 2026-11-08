import type { V1MeshTelemetryArchive } from '@sierragridteam/sdk';
export function activity(mesh: {
    telemetry: {
        lastRelayedAt: string | null;
        lastHeardAt: string | null;
    } | null;
}) { return mesh.telemetry?.lastRelayedAt ?? mesh.telemetry?.lastHeardAt ?? null; }
export function samplePoints(archive: V1MeshTelemetryArchive, metric: string) {
    const cadence = Number(archive.cadenceSeconds) * 1000;
    return archive.samples.flatMap((sample, i) => {
        const time = sample.reading.reportedAt ? Date.parse(sample.reading.reportedAt) : NaN;
        if (!Number.isFinite(time))
            return [];
        let value: number | null = null;
        if (metric === 'packetsReceived') {
            const previous = archive.samples[i - 1];
            const previousTime = previous?.reading.reportedAt ? Date.parse(previous.reading.reportedAt) : NaN;
            const elapsed = time - previousTime;
            if (previous && elapsed > 0 && cadence > 0 && elapsed <= cadence * 1.5 && !archive.reboots.some(t => Date.parse(t) > previousTime && Date.parse(t) <= time)) {
                const delta = BigInt(sample.reading.packetsReceived) - BigInt(previous.reading.packetsReceived);
                if (delta >= 0n && delta <= BigInt(Number.MAX_SAFE_INTEGER))
                    value = Number(delta) / (elapsed / 1000);
            }
        }
        else {
            const raw = sample.reading[metric as keyof typeof sample.reading];
            value = typeof raw === 'number' ? raw : null;
        }
        // Without a cadence, draw isolated points rather than implying continuous collection.
        return cadence > 0 ? [{ time, value }] : [{ time: time - 1, value: null }, { time, value }, { time: time + 1, value: null }];
    });
}

/** Follow continuation tokens, retaining successful pages if a later request fails. */
export async function collectPages<T>(read: (token: string) => Promise<{items:T[]; nextPageToken:string}>, cap=20) {
 const items:T[]=[];let token='';let pages=0;
 try {
  do { const page=await read(token);items.push(...page.items);token=page.nextPageToken;pages++; } while(token && pages<cap);
  return {items,complete:!token,failed:false,pages};
 } catch {return {items,complete:false,failed:true,pages};}
}
