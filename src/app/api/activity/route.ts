import { NextResponse } from "next/server";
import { cities } from "@/data/cities";
import { fetchCityWazeData } from "@/lib/waze";

/**
 * GET /api/activity
 * Returns alert counts for all Tier 1 cities in a single batch request.
 * Response: { [slug]: { alertCount: number } }
 */
export async function GET() {
  const tier1 = cities.filter((c) => c.dataTier === 1);

  const results = await Promise.allSettled(
    tier1.map(async (city) => {
      const { alerts } = await fetchCityWazeData(city.bbox, city.country);
      return { slug: city.slug, alertCount: alerts.length };
    })
  );

  const data: Record<string, { alertCount: number }> = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      data[result.value.slug] = { alertCount: result.value.alertCount };
    }
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, max-age=120" },
  });
}
