import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";
import { fetchPOIData } from "@/lib/wikidata";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }

  const geojson = await fetchPOIData(city.lat, city.lng, city.slug);

  return NextResponse.json(geojson, {
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}
