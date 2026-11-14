export type TemperatureUnit = "F" | "C";
export function weatherPreferences(): {
  unit: TemperatureUnit;
  location: string;
} {
  try {
    return {
      unit: localStorage.getItem("grid:temperature-unit") === "C" ? "C" : "F",
      location: localStorage.getItem("grid:weather-location") || "",
    };
  } catch {
    return { unit: "F", location: "" };
  }
}
export function rememberWeather(unit: TemperatureUnit, location: string) {
  try {
    localStorage.setItem("grid:temperature-unit", unit);
    localStorage.setItem("grid:weather-location", location);
  } catch {
    /* Optional preference storage. */
  }
}
export const temperature = (celsius: number, unit: TemperatureUnit) =>
  Math.round((unit === "F" ? (celsius * 9) / 5 + 32 : celsius) * 10) / 10;
/** A reading is anything finite: 0 °C is a temperature, not a gap. */
export const resolved = (n: number) => Number.isFinite(n);
export function temperatureText(celsius: number, unit: TemperatureUnit) {
  return resolved(celsius)
    ? `${Math.round(temperature(celsius, unit))}°${unit}`
    : "—";
}
export function weatherIconName(description: string) {
  if (/snow|flurr/i.test(description)) return "cloud-snow";
  if (/rain|shower|drizzle/i.test(description)) return "cloud-rain";
  if (/partly/i.test(description)) return "cloud-sun";
  if (/cloud|overcast|fog/i.test(description)) return "cloud";
  if (/wind/i.test(description)) return "wind";
  return /clear|sun/i.test(description) ? "sun" : undefined;
}
