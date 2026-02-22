// ── Airplanes.live ADS-B — Live Aircraft Positions ─────────────────
// Fetches real-time aircraft from Airplanes.live (community ADS-B network).
// Free, no API key, rate limit: 1 request per second.
// Replaces OpenSky Network which was too restrictive for production
// (1 req/10s, 350/day cap).

import type { BBox } from "@/data/cities";

const API_BASE = "https://api.airplanes.live/v2";

const CACHE_TTL_MS = 30_000;       // 30 seconds — faster refresh now affordable
const MIN_REQUEST_GAP_MS = 1_100;  // 1.1s between requests (1/sec limit + buffer)

interface CacheEntry {
  data: GeoJSON.FeatureCollection;
  ts: number;
}

const cache = new Map<string, CacheEntry>();

// Global throttle — 1 request per second
let lastRequestTime = 0;

async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

/** Haversine distance in nautical miles between two lat/lng points. */
function haversineNm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Earth radius in nautical miles
  return 3440.065 * c;
}

/** Convert BBox to center point + radius for Airplanes.live API. */
function bboxToPointRadius(bbox: BBox): { lat: number; lon: number; radius: number } {
  const [south, west, north, east] = bbox;
  const lat = (south + north) / 2;
  const lon = (west + east) / 2;
  // Distance from center to corner, capped at 250nm (API max)
  const radius = Math.min(250, Math.ceil(haversineNm(lat, lon, north, east)));
  return { lat, lon, radius };
}

export async function fetchAircraftData(
  bbox: BBox,
  citySlug: string,
): Promise<GeoJSON.FeatureCollection> {
  // Check cache
  const cached = cache.get(citySlug);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const { lat, lon, radius } = bboxToPointRadius(bbox);

  // Wait for global rate limit slot
  await waitForSlot();

  try {
    const url = `${API_BASE}/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radius}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error(`[airplanes-live] API error ${res.status} for ${citySlug}`);
      return cached?.data ?? { type: "FeatureCollection", features: [] };
    }

    const data = await res.json();
    return parseAndCache(data, citySlug);
  } catch (err) {
    console.error("[airplanes-live] fetch failed:", err);
    return cached?.data ?? { type: "FeatureCollection", features: [] };
  }
}

interface AircraftRecord {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string; // number (feet) or "ground"
  track?: number;
  gs?: number;
  r?: string;   // registration
  t?: string;   // aircraft type
}

function parseAndCache(
  data: { ac?: AircraftRecord[] },
  citySlug: string,
): GeoJSON.FeatureCollection {
  const aircraft = data.ac ?? [];
  const features: GeoJSON.Feature[] = [];

  for (const ac of aircraft) {
    if (ac.lat == null || ac.lon == null) continue;

    const onGround = ac.alt_baro === "ground";
    const altitudeFt = typeof ac.alt_baro === "number" ? Math.round(ac.alt_baro) : 0;

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [ac.lon, ac.lat],
      },
      properties: {
        icao24: ac.hex ?? "",
        callsign: (ac.flight ?? "").trim(),
        altitudeFt,
        heading: ac.track ?? 0,
        velocity: ac.gs ?? 0,
        onGround,
      },
    });
  }

  const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
  cache.set(citySlug, { data: fc, ts: Date.now() });
  return fc;
}
