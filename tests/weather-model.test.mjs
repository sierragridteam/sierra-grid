import { test } from "node:test";
import assert from "node:assert/strict";
import { nextHours, alertWindow, climb, currentAlerts, days, headline, outlook, snowLevel, units, weatherIcon, within } from "../src/lib/weather-model.ts";

const H = 3_600_000, now = Date.parse("2026-11-13T20:30:00Z");
const period = (h, extra = {}) => ({ time: new Date(Date.parse("2026-11-13T20:00:00Z") + h * H).toISOString(), temperatureCelsius: 5, humidityPercent: 90, windSpeedKmh: 10, windGustKmh: 20, precipitationProbabilityPercent: 50, precipitationMm: 1, snowfallMm: 0, snowLevelMeters: 2000, skyCoverPercent: 80, weather: "", ...extra });
const fmt = (t) => new Date(t).toISOString().slice(11, 16);

test("units: feet, mph and inches go with °F; metres, km/h and mm with °C", () => {
  const f = units("F"), c = units("C");
  assert.equal(f.temp(0), "32°");
  assert.equal(c.temp(0.4), "0°");
  assert.equal(f.elevation(1576), "5,200 ft");
  assert.equal(c.elevation(1576), "1,600 m");
  assert.equal(f.speed(67), "42 mph");
  assert.equal(f.rain(4.5), "0.18 in");
  assert.equal(f.snow(19.5), "0.8 in");
  assert.equal(c.snow(20), "2.0 cm");
});

test("the current hour counts, hours already over do not", () => {
  const ps = [period(-1), period(0), period(1), period(24), period(25)];
  assert.deepEqual(within(ps, now, now + 24 * H).map((p) => p.time), [ps[1].time, ps[2].time, ps[3].time]);
});

test("snow level is the mean across towns now, with the lowest hour in the window", () => {
  const s = snowLevel([
    { locationId: "a", daily: [], periods: [period(0, { snowLevelMeters: 2400 }), period(6, { snowLevelMeters: 1600 }), period(30, { snowLevelMeters: 900 })] },
    { locationId: "b", daily: [], periods: [period(0, { snowLevelMeters: 2200 }), period(6, { snowLevelMeters: 1500 }), period(7, { snowLevelMeters: null })] },
  ], now);
  assert.equal(s.now, 2300);
  assert.equal(s.lowest.meters, 1550);
  assert.equal(s.lowest.time, Date.parse(period(6).time));
  assert.equal(snowLevel([{ locationId: "a", daily: [], periods: [] }], now), undefined);
});

test("outlook totals rain and snow and finds the peak gust", () => {
  const o = outlook({ locationId: "a", daily: [], periods: [period(0, { snowfallMm: 2 }), period(3, { windGustKmh: 67, temperatureCelsius: -2 }), period(40, { windGustKmh: 99 })] }, now);
  assert.equal(o.precipitationMm, 2);
  assert.equal(o.snowfallMm, 2);
  assert.equal(o.gustKmh, 67);
  assert.equal(o.low, -2);
});

test("the climb keeps Hwy 4 order and measures distance up the road", () => {
  const towns = [
    { id: "bearvalley", name: "Bear Valley, CA", latitude: 38.46, longitude: -120.04, elevationMeters: 2155 },
    { id: "sonora", name: "Sonora, CA", latitude: 37.98, longitude: -120.38, elevationMeters: 547 },
    { id: "murphys", name: "Murphys, CA", latitude: 38.14, longitude: -120.46, elevationMeters: 667 },
    { id: "arnold", name: "Arnold, CA", latitude: 38.27, longitude: -120.33, elevationMeters: null },
  ];
  const c = climb(towns);
  assert.deepEqual(c.map((x) => x.id), ["murphys", "bearvalley"]);
  assert.equal(c[0].at, 0);
  assert.ok(c[1].at > 45 && c[1].at < 60);
});

test("days pair the day's high with the night's low; a forecast starting at night has no high", () => {
  const d = (name, start, isDaytime, temp, pop, short) => ({ name, start, end: null, isDaytime, temperatureCelsius: temp, precipitationProbabilityPercent: pop, shortForecast: short, detailedForecast: short + ".", windSpeed: "", windDirection: "" });
  const out = days([
    d("Tonight", "2026-11-14T02:00:00Z", false, 1, 75, "Rain"),
    d("Saturday", "2026-11-14T14:00:00Z", true, 9, 20, "Mostly Sunny"),
    d("Saturday Night", "2026-11-15T02:00:00Z", false, -1, null, "Clear"),
  ], "America/Los_Angeles", now);
  assert.deepEqual(out.map((x) => [x.label, x.high, x.low, x.chance, x.note]), [["Today", undefined, 1, 75, "Rain"], ["Sat 14", 9, -1, 20, "Mostly Sunny"]]);
});

test("alerts: most severe first, ended ones dropped, windows worded by whether they have started", () => {
  const alerts = [
    { id: "w", headline: "Wind Advisory", severity: "MODERATE", status: "ACTIVE", effective: "2026-11-13T19:00:00Z", expires: "2026-11-14T03:00:00Z" },
    { id: "s", headline: "Winter Storm Warning", severity: "SEVERE", status: "ACTIVE", effective: "2026-11-13T20:00:00Z", expires: "2026-11-14T18:00:00Z" },
    { id: "old", headline: "Frost Advisory", severity: "MINOR", status: "ACTIVE", expires: "2026-11-13T10:00:00Z" },
    { id: "next", headline: "Freeze Watch", severity: "MODERATE", status: "SCHEDULED", effective: "2026-11-15T08:00:00Z", expires: "2026-11-15T17:00:00Z" },
  ];
  const cur = currentAlerts(alerts, now);
  assert.deepEqual(cur.map((a) => a.id), ["s", "w", "next"]);
  assert.equal(alertWindow(cur[0], now, fmt), "until 18:00");
  assert.equal(alertWindow(cur[2], now, fmt), "from 08:00");
});

test("headline leads with the worst alert and says which towns the snow level reaches", () => {
  const snow = { now: 2360, lowest: { meters: 1600, time: now + 8 * H }, highest: { meters: 2360, time: now }, series: [] };
  const h = headline({
    alerts: [{ id: "s", headline: "Winter Storm Warning", severity: "SEVERE", status: "ACTIVE", expires: "2026-11-14T18:00:00Z" }],
    now, fmt, u: units("F"), snow, stops: [{ name: "Arnold, CA", elevationMeters: 1295 }, { name: "Dorrington, CA", elevationMeters: 1637 }, { name: "Bear Valley, CA", elevationMeters: 2155 }],
    current: [], totals: [{ precipitationMm: 9, snowfallMm: 20 }],
  });
  assert.equal(h.title, "Winter Storm Warning until 18:00");
  assert.equal(h.tone, "alarm");
  assert.match(h.lines[0], /^Snow level falling to 5,200 ft by 04:30 — reaches Dorrington and Bear Valley$/);
  const calm = headline({ alerts: [], now, fmt, u: units("F"), stops: [], current: [{ temperatureCelsius: 10, weatherDescription: "clear sky" }, { temperatureCelsius: 0, weatherDescription: "clear sky" }], totals: [] });
  assert.equal(calm.title, "Clear sky, 32° to 50°");
  assert.equal(calm.tone, "ok");
});

test("snow wins the icon over rain", () => {
  assert.equal(weatherIcon("Rain And Snow Showers"), "cloud-snow");
  assert.equal(weatherIcon("Showers And Thunderstorms"), "cloud-rain");
  assert.equal(weatherIcon("Mostly Sunny"), "cloud-sun");
  assert.equal(weatherIcon("Sunny"), "sun");
});

test("the next 24 hours are 24 periods even mid-hour, and a trace of rain is not 0.00", () => {
  const ps = Array.from({ length: 30 }, (_, i) => period(i - 2));
  assert.equal(nextHours(ps, now, 24).length, 24);
  assert.equal(nextHours(ps, now, 24)[0].time, period(0).time);
  assert.equal(outlook({ locationId: "a", daily: [], periods: ps }, now).hours, 24);
  assert.equal(units("F").rain(0.1), "a trace");
  assert.equal(units("F").rain(0.3), "0.01 in");
  assert.equal(units("C").rain(0), "0.0 mm");
});
