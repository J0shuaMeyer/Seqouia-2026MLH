import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";
import { fetchMTASubwayData } from "@/lib/mta";
import { fetchLAMetroData } from "@/lib/lametro";
import { fetchGTFSStaticData } from "@/lib/gtfs-static";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city || !city.transitType) {
    return NextResponse.json({ error: "No transit data" }, { status: 404 });
  }

  let geojson: GeoJSON.FeatureCollection;

  switch (city.transitType) {
    case "mta":
      geojson = await fetchMTASubwayData();
      break;
    case "lametro":
      geojson = await fetchLAMetroData();
      break;
    case "gtfs-static":
      geojson = await fetchGTFSStaticData(slug);
      break;
    default:
      return NextResponse.json({ error: "Unknown transit type" }, { status: 404 });
  }

  const cacheHeader =
    city.transitType === "gtfs-static"
      ? "public, max-age=3600"
      : "no-store";

  return NextResponse.json(geojson, {
    headers: { "Cache-Control": cacheHeader },
  });
}
