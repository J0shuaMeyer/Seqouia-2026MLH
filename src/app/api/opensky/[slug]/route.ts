import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";
import { fetchAircraftData } from "@/lib/opensky";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city || !city.airportBbox) {
    return NextResponse.json(
      { error: "No aircraft data for this city" },
      { status: 404 },
    );
  }

  const geojson = await fetchAircraftData(city.airportBbox, city.slug);

  return NextResponse.json(geojson, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
