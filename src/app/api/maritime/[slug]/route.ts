import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";
import { fetchMaritimeData } from "@/lib/maritime";

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city) {
    return NextResponse.json(
      { error: "City not found" },
      { status: 404 },
    );
  }

  // Inland cities get an empty response with long cache — no API call
  if (!city.isCoastal) {
    return NextResponse.json(EMPTY_FC, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  const geojson = await fetchMaritimeData(city.bbox, city.slug);

  return NextResponse.json(geojson, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
