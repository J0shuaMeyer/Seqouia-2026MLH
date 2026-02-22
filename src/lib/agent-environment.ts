import type { City } from "@/data/cities";
import type { CityEnvironment, EarthquakeInfo } from "./agent-types";

/**
 * WMO weather code predicates.
 * Codes reference: https://open-meteo.com/en/docs#weathervariables
 */
export function isRaining(code: number): boolean {
  // 51-57: drizzle, 61-67: rain, 80-82: rain showers, 95-99: thunderstorm
  return (code >= 51 && code <= 57) || (code >= 61 && code <= 67)
      || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
}

export function isSnowing(code: number): boolean {
  // 71-77: snowfall, 85-86: snow showers
  return (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
}

/**
 * Extract traffic hotspots from Waze jam data.
 * Groups jams by grid cell and picks the highest-level jam per cell.
 */
function extractTrafficHotspots(
  jams: Array<{ level: number; line: Array<{ x: number; y: number }> }>,
): CityEnvironment["trafficHotspots"] {
  const hotspots: CityEnvironment["trafficHotspots"] = [];
  for (const jam of jams) {
    if (jam.level < 3 || !jam.line?.length) continue;
    // Use midpoint of jam polyline
    const mid = jam.line[Math.floor(jam.line.length / 2)];
    hotspots.push({ lat: mid.y, lng: mid.x, level: jam.level });
  }
  return hotspots;
}

/**
 * Compute average jam level from Waze data (0-5 scale).
 */
function computeAvgJamLevel(
  jams: Array<{ level: number }>,
): number {
  if (jams.length === 0) return 0;
  const sum = jams.reduce((s, j) => s + j.level, 0);
  return sum / jams.length;
}

/**
 * Simplify POI GeoJSON features into the flat format the simulation needs.
 */
function simplifyPOIs(
  features: Array<{
    geometry?: { coordinates?: number[] };
    properties?: { category?: string; activity?: number };
  }>,
): CityEnvironment["pois"] {
  const pois: CityEnvironment["pois"] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    pois.push({
      lng: coords[0],
      lat: coords[1],
      category: f.properties?.category || "other",
      activity: f.properties?.activity ?? 50,
    });
  }
  return pois;
}

/**
 * Simplify bikeshare GeoJSON features.
 */
function simplifyBikeStations(
  features: Array<{
    geometry?: { coordinates?: number[] };
    properties?: { availableBikes?: number };
  }>,
): CityEnvironment["bikeStations"] {
  const stations: CityEnvironment["bikeStations"] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    stations.push({
      lng: coords[0],
      lat: coords[1],
      available: f.properties?.availableBikes ?? 0,
    });
  }
  return stations;
}

/**
 * Haversine distance between two lat/lng points in kilometers.
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Map USGS GeoJSON features to EarthquakeInfo[].
 */
function parseEarthquakes(
  geojson: { features?: Array<{
    properties?: { mag?: number; place?: string; time?: number };
    geometry?: { coordinates?: number[] };
  }> },
  cityLat: number,
  cityLng: number,
): EarthquakeInfo[] {
  const features = geojson?.features ?? [];
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  return features
    .filter((f) => (f.properties?.mag ?? 0) >= 2.0 && (f.properties?.time ?? 0) > oneHourAgo)
    .map((f) => {
      const coords = f.geometry?.coordinates ?? [0, 0];
      const lat = coords[1];
      const lng = coords[0];
      return {
        magnitude: f.properties?.mag ?? 0,
        place: f.properties?.place ?? "Unknown",
        lat,
        lng,
        time: f.properties?.time ?? 0,
        distanceKm: haversineKm(cityLat, cityLng, lat, lng),
      };
    })
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 5);
}

/**
 * Build a CityEnvironment from existing API routes.
 * Runs on the main thread (browser), fetches in parallel.
 */
export async function buildCityEnvironment(
  city: City,
  simHour?: number,
): Promise<CityEnvironment> {
  const [wazeRes, weatherRes, poisRes, bikeRes, pulseRes, quakeRes] = await Promise.allSettled([
    fetch(`/api/waze/${city.slug}`).then((r) => r.json()),
    fetch(`/api/weather/${city.slug}`).then((r) => r.json()),
    fetch(`/api/popularity/${city.slug}`).then((r) => r.json()),
    city.bikeNetwork
      ? fetch(`/api/bikeshare/${city.slug}`).then((r) => r.json())
      : Promise.reject("none"),
    fetch(`/api/pulse/${city.slug}`).then((r) => r.json()),
    fetch(`/api/earthquakes/${city.slug}`).then((r) => r.json()),
  ]);

  // Defaults
  let tempF = 68;
  let weatherCode = 0;
  let aqi = 50;
  let alertCount = 0;
  let avgJamLevel = 0;
  let trafficHotspots: CityEnvironment["trafficHotspots"] = [];
  let pois: CityEnvironment["pois"] = [];
  let bikeStations: CityEnvironment["bikeStations"] = [];
  let upiScore = 50;

  // Waze
  if (wazeRes.status === "fulfilled") {
    const waze = wazeRes.value;
    // GeoJSON response: features with properties
    const features = waze?.features ?? [];
    const alerts = features.filter(
      (f: { geometry?: { type?: string } }) => f.geometry?.type === "Point",
    );
    const jams = features
      .filter((f: { geometry?: { type?: string } }) => f.geometry?.type === "LineString")
      .map((f: { geometry?: { coordinates?: number[][] }; properties?: { level?: number } }) => ({
        level: f.properties?.level ?? 0,
        line: (f.geometry?.coordinates ?? []).map(([x, y]: number[]) => ({ x, y })),
      }));
    alertCount = alerts.length;
    avgJamLevel = computeAvgJamLevel(jams);
    trafficHotspots = extractTrafficHotspots(jams);
  }

  // Weather
  if (weatherRes.status === "fulfilled") {
    const w = weatherRes.value;
    tempF = w.tempF ?? 68;
    weatherCode = w.weatherCode ?? 0;
    aqi = w.aqi ?? 50;
  }

  // POIs
  if (poisRes.status === "fulfilled") {
    const geo = poisRes.value;
    pois = simplifyPOIs(geo?.features ?? []);
  }

  // Bikeshare
  if (bikeRes.status === "fulfilled") {
    const geo = bikeRes.value;
    bikeStations = simplifyBikeStations(geo?.features ?? []);
  }

  // Pulse
  if (pulseRes.status === "fulfilled") {
    upiScore = pulseRes.value?.score ?? 50;
  }

  // Earthquakes
  let earthquakes: EarthquakeInfo[] = [];
  if (quakeRes.status === "fulfilled") {
    earthquakes = parseEarthquakes(quakeRes.value, city.lat, city.lng);
  }

  const hour = simHour ?? new Date().getHours();
  const rushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);

  return {
    tempF,
    weatherCode,
    isRaining: isRaining(weatherCode),
    isSnowing: isSnowing(weatherCode),
    aqi,
    alertCount,
    avgJamLevel,
    trafficHotspots,
    hasTransit: !!city.transitType,
    hasBikeshare: !!city.bikeNetwork,
    isRushHour: rushHour,
    pois,
    bikeStations,
    upiScore,
    earthquakes,
    environmentChanges: [],
  };
}
