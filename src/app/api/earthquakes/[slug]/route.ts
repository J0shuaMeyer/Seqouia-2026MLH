import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/* In-memory cache: 60s TTL per city slug */
const cache = new Map<string, { data: GeoJSON.FeatureCollection; ts: number }>();
const CACHE_TTL = 60_000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }

  // Return cached data if fresh
  const cached = cache.get(slug);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  try {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url =
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
      `&latitude=${city.lat}&longitude=${city.lng}` +
      `&maxradiuskm=500&minmagnitude=2.0` +
      `&orderby=time&limit=100` +
      `&starttime=${start}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`USGS ${res.status}`);

    const geojson = (await res.json()) as GeoJSON.FeatureCollection;
    cache.set(slug, { data: geojson, ts: Date.now() });

    return NextResponse.json(geojson, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    console.error("[earthquakes] fetch error:", err);
    // Return stale cache or empty
    return NextResponse.json(cached?.data ?? EMPTY_FC, {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  }
}
