// ── OpenSky ADS-B — Aircraft Near Airports ────────────────────────
// Fetches live aircraft positions from OpenSky Network.
// Anonymous free tier: 1 request per 10 seconds.
// Global request queue ensures we never exceed the rate limit.

import type { BBox } from "@/data/cities";

const OPENSKY_API = "https://opensky-network.org/api/states/all";

const CACHE_TTL_MS = 120_000;     // 2 minutes — generous cache to stay within rate limits
const MIN_REQUEST_GAP_MS = 11_000; // 11s between requests (10s limit + 1s buffer)
const DAILY_LIMIT = 350;
const RETRY_DELAY_MS = 12_000;     // wait before retrying a 429

interface CacheEntry {
  data: GeoJSON.FeatureCollection;
  ts: number;
}

const cache = new Map<string, CacheEntry>();

// Global throttle — only one OpenSky request at a time, spaced 11s apart
let lastRequestTime = 0;

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

async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - elapsed));
  }
  lastRequestTime = Date.now();
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
  // Check cache — generous TTL to reduce API pressure
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

  // Wait for the global rate limit slot (1 req per 10s)
  await waitForSlot();

  try {
    const url = `${OPENSKY_API}?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });

    // Rate limited — wait and retry once
    if (res.status === 429) {
      console.warn(`[opensky] 429 rate limited for ${citySlug}, retrying in ${RETRY_DELAY_MS / 1000}s`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      lastRequestTime = Date.now();

      const retryRes = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!retryRes.ok) {
        console.error(`[opensky] retry failed ${retryRes.status} for ${citySlug}`);
        return cached?.data ?? { type: "FeatureCollection", features: [] };
      }
      return parseAndCache(await retryRes.json(), citySlug);
    }

    if (!res.ok) {
      console.error(`[opensky] API error ${res.status} for ${citySlug}`);
      return cached?.data ?? { type: "FeatureCollection", features: [] };
    }

    return parseAndCache(await res.json(), citySlug);
  } catch (err) {
    console.error("[opensky] fetch failed:", err);
    return cached?.data ?? { type: "FeatureCollection", features: [] };
  }
}

function parseAndCache(
  data: { states?: (string | number | boolean | null)[][] },
  citySlug: string,
): GeoJSON.FeatureCollection {
  const states = data.states ?? [];
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

  const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
  cache.set(citySlug, { data: fc, ts: Date.now() });
  return fc;
}
