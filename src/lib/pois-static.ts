import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ── In-memory cache ─────────────────────────────────────────────────

const cache = new Map<string, GeoJSON.FeatureCollection | null>();

// ── Public API ──────────────────────────────────────────────────────

export function fetchStaticPOIData(
  slug: string,
): GeoJSON.FeatureCollection | null {
  if (cache.has(slug)) return cache.get(slug)!;

  const filePath = join(process.cwd(), "src", "data", "pois", `${slug}.json`);

  if (!existsSync(filePath)) {
    cache.set(slug, null);
    return null;
  }

  const raw = readFileSync(filePath, "utf-8");
  const pois: Array<{
    name: string;
    lat: number;
    lon: number;
    category: string;
    hours: string;
    google_place_id: string;
  }> = JSON.parse(raw);

  const features: GeoJSON.Feature[] = pois.map((poi) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [poi.lon, poi.lat],
    },
    properties: {
      name: poi.name,
      poiType: poi.category,
      hours: poi.hours,
    },
  }));

  const collection: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  cache.set(slug, collection);
  return collection;
}
