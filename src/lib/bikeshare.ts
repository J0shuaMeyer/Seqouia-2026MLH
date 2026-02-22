import type { BikeNetworkConfig } from "@/data/cities";

// ── Types ──────────────────────────────────────────────────────────

interface GBFSStationInfo {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
}

interface GBFSStationStatus {
  station_id: string;
  num_bikes_available: number;
  num_docks_available: number;
  is_renting: number;
}

interface CityBikesStation {
  name: string;
  latitude: number;
  longitude: number;
  free_bikes: number;
  empty_slots: number;
}

// ── Flow analysis state ────────────────────────────────────────────
// Stores previous bike counts per station, keyed by citySlug

const FLOW_THRESHOLD = 3; // ignore changes smaller than ±3 bikes

const prevSnapshots = new Map<string, Map<string, number>>();

function applyFlowAnalysis(
  features: GeoJSON.Feature[],
  citySlug: string,
): GeoJSON.Feature[] {
  const prev = prevSnapshots.get(citySlug);

  // Build current snapshot: stationName → availableBikes
  const current = new Map<string, number>();
  for (const f of features) {
    const name = f.properties?.name as string;
    const bikes = f.properties?.availableBikes as number;
    if (name != null && bikes != null) {
      current.set(name, bikes);
    }
  }

  // If we have a previous snapshot, compute deltas
  if (prev) {
    for (const f of features) {
      const name = f.properties?.name as string;
      const bikesNow = f.properties?.availableBikes as number;
      const bikesPrev = prev.get(name);

      if (bikesPrev != null && bikesNow != null) {
        const delta = bikesNow - bikesPrev;
        // Only show flow if change exceeds threshold
        if (Math.abs(delta) >= FLOW_THRESHOLD) {
          f.properties!.netFlow = delta;
        } else {
          f.properties!.netFlow = 0;
        }
      }
      // If station is new (not in prev), no flow data — property stays absent
    }
  }

  // Store current as next previous
  prevSnapshots.set(citySlug, current);

  return features;
}

// ── GBFS fetch (Citi Bike, Ecobici, etc.) ──────────────────────────

async function fetchGBFS(
  infoUrl: string,
  statusUrl: string,
): Promise<GeoJSON.FeatureCollection> {
  const [infoRes, statusRes] = await Promise.all([
    fetch(infoUrl, { signal: AbortSignal.timeout(10_000) }),
    fetch(statusUrl, { signal: AbortSignal.timeout(10_000) }),
  ]);

  if (!infoRes.ok || !statusRes.ok) {
    return { type: "FeatureCollection", features: [] };
  }

  const infoData = await infoRes.json();
  const statusData = await statusRes.json();

  const stations: GBFSStationInfo[] = infoData.data?.stations ?? [];
  const statuses: GBFSStationStatus[] = statusData.data?.stations ?? [];

  const statusMap = new Map<string, GBFSStationStatus>();
  for (const s of statuses) statusMap.set(s.station_id, s);

  const features: GeoJSON.Feature[] = [];

  for (const station of stations) {
    const status = statusMap.get(station.station_id);
    const available = status?.num_bikes_available ?? 0;
    const totalDocks = station.capacity || (available + (status?.num_docks_available ?? 0));
    const pctFull = totalDocks > 0 ? available / totalDocks : 0;

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [station.lon, station.lat],
      },
      properties: {
        name: station.name,
        availableBikes: available,
        totalDocks,
        pctFull: Math.round(pctFull * 100) / 100,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

// ── CityBikes API fetch ─────────────────────────────────────────────

async function fetchCityBikes(
  networkId: string,
): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch(
    `https://api.citybik.es/v2/networks/${networkId}`,
    { signal: AbortSignal.timeout(10_000) },
  );

  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }

  const data = await res.json();
  const stations: CityBikesStation[] = data.network?.stations ?? [];

  const features: GeoJSON.Feature[] = stations.map((s) => {
    const totalDocks = (s.free_bikes ?? 0) + (s.empty_slots ?? 0);
    const pctFull = totalDocks > 0 ? s.free_bikes / totalDocks : 0;

    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [s.longitude, s.latitude],
      },
      properties: {
        name: s.name,
        availableBikes: s.free_bikes ?? 0,
        totalDocks,
        pctFull: Math.round(pctFull * 100) / 100,
      },
    };
  });

  return { type: "FeatureCollection", features };
}

// ── Public API ──────────────────────────────────────────────────────

export async function fetchBikeShareData(
  config: BikeNetworkConfig,
  citySlug?: string,
): Promise<GeoJSON.FeatureCollection> {
  try {
    let fc: GeoJSON.FeatureCollection;

    if (config.type === "gbfs" && config.infoUrl && config.statusUrl) {
      fc = await fetchGBFS(config.infoUrl, config.statusUrl);
    } else if (config.type === "citybikes" && config.networkId) {
      fc = await fetchCityBikes(config.networkId);
    } else {
      return { type: "FeatureCollection", features: [] };
    }

    // Apply flow analysis if citySlug provided
    if (citySlug) {
      fc.features = applyFlowAnalysis(fc.features, citySlug);
    }

    return fc;
  } catch (err) {
    console.error("[bikeshare] fetch failed:", err);
    return { type: "FeatureCollection", features: [] };
  }
}
