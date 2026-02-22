import { readFileSync } from "fs";
import { join } from "path";

// ── Types ───────────────────────────────────────────────────────────

interface StopEntry {
  name: string;
  lat: number;
  lon: number;
}

interface RouteEntry {
  name: string;
  color: string;
  stopIds: string[];
}

type StopsFile = Record<string, StopEntry>;
type RoutesFile = Record<string, RouteEntry>;

// ── In-memory cache ─────────────────────────────────────────────────

const cache = new Map<string, GeoJSON.FeatureCollection>();

// ── Public API ──────────────────────────────────────────────────────

export async function fetchGTFSStaticData(
  slug: string,
): Promise<GeoJSON.FeatureCollection> {
  if (cache.has(slug)) return cache.get(slug)!;

  const dir = join(process.cwd(), "src", "data", "transit");
  const stopsRaw = readFileSync(join(dir, `${slug}-stops.json`), "utf-8");
  const routesRaw = readFileSync(join(dir, `${slug}-routes.json`), "utf-8");

  const stops: StopsFile = JSON.parse(stopsRaw);
  const routes: RoutesFile = JSON.parse(routesRaw);

  const features: GeoJSON.Feature[] = [];
  const seen = new Set<string>();

  for (const [routeId, route] of Object.entries(routes)) {
    for (const stopId of route.stopIds) {
      const key = `${routeId}-${stopId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const stop = stops[stopId];
      if (!stop) continue;

      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [stop.lon, stop.lat],
        },
        properties: {
          route: route.name,
          vehicleType: "rail",
          color: route.color,
          stopName: stop.name,
        },
      });
    }
  }

  const collection: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  cache.set(slug, collection);
  return collection;
}
