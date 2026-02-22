import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";
import { fetchPOIData } from "@/lib/wikidata";
import { fetchStaticPOIData } from "@/lib/pois-static";

/**
 * Haversine distance in meters between two [lon, lat] coordinate pairs.
 */
function haversineMeters(
  coords1: [number, number],
  coords2: [number, number],
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }

  // 1. Load static POIs (null if no file for this city)
  const staticPois = fetchStaticPOIData(slug);

  // 2. Fetch Wikidata POIs (airports, stations, stadiums)
  const wikidataPois = await fetchPOIData(city.lat, city.lng, city.slug);

  // 3. Merge: static first, then non-duplicate Wikidata features
  if (!staticPois) {
    // No static file — return Wikidata only (non-Americas cities)
    return NextResponse.json(wikidataPois, {
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  }

  const merged: GeoJSON.Feature[] = [...staticPois.features];

  for (const wdFeature of wikidataPois.features) {
    const wdCoords = (wdFeature.geometry as GeoJSON.Point)
      .coordinates as [number, number];

    // Check if any static POI is within 100m
    const isDuplicate = merged.some((existing) => {
      const existingCoords = (existing.geometry as GeoJSON.Point)
        .coordinates as [number, number];
      return haversineMeters(wdCoords, existingCoords) < 100;
    });

    if (!isDuplicate) {
      merged.push(wdFeature);
    }
  }

  const geojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: merged,
  };

  return NextResponse.json(geojson, {
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}
