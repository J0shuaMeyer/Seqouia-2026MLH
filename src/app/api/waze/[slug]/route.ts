import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";
import { fetchCityWazeData, type WazeAlert, type WazeJam } from "@/lib/waze";

function alertToFeature(a: WazeAlert): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [a.location.x, a.location.y] },
    properties: {
      kind: "alert",
      type: a.type,
      subtype: a.subtype,
      reliability: a.reliability,
      street: a.street ?? null,
      pubMillis: a.pubMillis,
    },
  };
}

function jamToFeature(j: WazeJam): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: j.line.map((p) => [p.x, p.y]),
    },
    properties: {
      kind: "jam",
      level: j.level,
      speed: j.speed,
      delay: j.delay,
      length: j.length,
      street: j.street ?? null,
    },
  };
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

  const { alerts, jams } = await fetchCityWazeData(city.bbox);

  const geojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      ...alerts.map(alertToFeature),
      ...jams.map(jamToFeature),
    ],
  };

  return NextResponse.json(geojson, {
    headers: { "Cache-Control": "public, max-age=120" },
  });
}
