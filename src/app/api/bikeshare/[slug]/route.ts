import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";
import { fetchBikeShareData } from "@/lib/bikeshare";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city || !city.bikeNetwork) {
    return NextResponse.json({ error: "No bike share data" }, { status: 404 });
  }

  const geojson = await fetchBikeShareData(city.bikeNetwork);

  return NextResponse.json(geojson, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
