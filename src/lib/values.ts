/** Labels preserve the API's units instead of guessing from a displayed magnitude. */
export function fieldLabel(key: string): string {
    const known: Record<string, string> = {
        observedAt: 'Content observed (not radio activity)', ingestedAt: 'Revision stored',
        receivedAt: 'Sample received by Grid', reportedAt: 'Measurement reported',
        fetchedAt: 'Source fetched', issuedAt: 'Forecast issued', lastUpdated: 'Aggregate refresh',
        temperatureCelsius: 'Temperature · °C', feelsLikeCelsius: 'Feels like · °C',
        windSpeedKmh: 'Sustained wind · km/h', windGustKmh: 'Wind gust · km/h',
        peakWindGustKmh: 'Peak forecast gust · km/h', windDirectionDegrees: 'Wind from · degrees',
        humidityPercent: 'Relative humidity · %', minHumidityPercent: 'Minimum humidity · %',
        visibilityKm: 'Visibility · km', depthKm: 'Depth · km', acres: 'Area · acres',
        containment: 'Containment · %', containmentPercent: 'Containment · %', elevationFeet: 'Elevation · feet',
        distanceMeters: 'Distance · metres', batteryVolts: 'Battery · volts',
        noiseFloorDbm: 'Noise floor · dBm', lastRssiDbm: 'Last RSSI · dBm', lastSnrDb: 'Last SNR · dB',
        temperatureC: 'Temperature · °C', humidity: 'Relative humidity · %', pressure: 'Pressure · hPa', pressureHpa: 'Pressure · hPa',
        uptimeSeconds: 'Uptime · seconds', airtimeMs: 'Transmit airtime · ms', rxAirtimeMs: 'Receive airtime · ms',
        batteryPercent: 'Battery charge · %', bestSnr: 'Best observed SNR · dB', cadenceSeconds: 'Median cadence · seconds',
        delayMinutes: 'Delay · minutes', durationMinutes: 'Duration · minutes', distanceKm: 'Distance · km',
    };
    return known[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, x => x.toUpperCase());
}
export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
export function safeUrl(value: unknown): string | null {
    if (typeof value !== 'string')
        return null;
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    }
    catch {
        return null;
    }
}
export function displayValue(value: unknown): string {
    if (value === null || value === undefined)
        return 'Not reported';
    if (value === '')
        return 'Not supplied';
    if (typeof value === 'boolean')
        return value ? 'Yes' : 'No';
    return String(value);
}
