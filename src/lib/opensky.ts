// ── OpenSky ADS-B — Aircraft Near Airports ────────────────────────
// Fetches live aircraft positions from OpenSky Network.
// Server-side 30s cache per city. Daily counter safeguard at 350 credits.

import type { BBox } from "@/data/cities";

const OPENSKY_API = "https://opensky-network.org/api/states/all";

const CACHE_TTL_MS = 30_000; // 30 seconds
const DAILY_LIMIT = 350;     // stop before 400 to be safe

interface CacheEntry {
  data: GeoJSON.FeatureCollection;
  ts: number;
}

const cache = new Map<string, CacheEntry>();

// Daily counter — resets at midnight UTC
let dailyCount = 0;
let dailyResetDate = new Date().toISOString().split("T")[0];

function checkAndIncrementDaily(): boolean {
  const today = new Date().toISOString().split("T")[0];
  if (today !== dailyResetDate) {
    dailyCount = 0;
    dailyResetDate = today;
  }
  if (dailyCount >= DAILY_LIMIT) return false;
  dailyCount++;
  return true;
}

// OpenSky state vector indices
const ICAO = 0;
const CALLSIGN = 1;
const LON = 5;
const LAT = 6;
const BARO_ALT = 7;
const ON_GROUND = 8;
const VELOCITY = 9;
const HEADING = 10;

export async function fetchAircraftData(
  bbox: BBox,
  citySlug: string,
): Promise<GeoJSON.FeatureCollection> {
  // Check cache
  const cached = cache.get(citySlug);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  // Daily safeguard
  if (!checkAndIncrementDaily()) {
    console.warn("[opensky] daily limit approached, returning cached/empty");
    return cached?.data ?? { type: "FeatureCollection", features: [] };
  }

  const [south, west, north, east] = bbox;

  try {
    const url = `${OPENSKY_API}?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error(`[opensky] API error ${res.status}`);
      return cached?.data ?? { type: "FeatureCollection", features: [] };
    }

    const data = await res.json();
    const states: (string | number | boolean | null)[][] = data.states ?? [];

    const features: GeoJSON.Feature[] = [];

    for (const s of states) {
      const lon = s[LON] as number | null;
      const lat = s[LAT] as number | null;
      if (lon == null || lat == null) continue;

      const altMeters = (s[BARO_ALT] as number | null) ?? 0;
      const altFt = Math.round(altMeters * 3.28084);

      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lon, lat],
        },
        properties: {
          icao24: s[ICAO] ?? "",
          callsign: ((s[CALLSIGN] as string) ?? "").trim(),
          altitudeFt: altFt,
          heading: (s[HEADING] as number | null) ?? 0,
          velocity: (s[VELOCITY] as number | null) ?? 0,
          onGround: !!s[ON_GROUND],
        },
      });
    }

    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    };

    cache.set(citySlug, { data: fc, ts: Date.now() });
    return fc;
  } catch (err) {
    console.error("[opensky] fetch failed:", err);
    return cached?.data ?? { type: "FeatureCollection", features: [] };
  }
}
