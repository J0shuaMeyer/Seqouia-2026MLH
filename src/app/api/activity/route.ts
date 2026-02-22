import { NextResponse } from "next/server";
import { cities } from "@/data/cities";
import { getLocalHour } from "@/lib/activity";
import { fetchCityWazeData } from "@/lib/waze";
import { fetchWeatherData } from "@/lib/weather";
import { computeUPI, type SignalBundle } from "@/lib/urban-pulse";

/**
 * GET /api/activity
 *
 * Batch UPI scores for ALL 28 cities (drives globe visualization).
 * Uses lightweight signals: Waze traffic + weather only.
 * Response: { [slug]: { score: number, baseline: number } }
 */
export async function GET() {
  // Fetch Waze + weather for all cities in parallel
  const results = await Promise.allSettled(
    cities.map(async (city) => {
      const bundle: SignalBundle = {};

      // Fetch Waze and weather in parallel per city
      const [wazeResult, weatherResult] = await Promise.allSettled([
        fetchCityWazeData(city.bbox, city.country),
        fetchWeatherData(city.lat, city.lng),
      ]);

      if (wazeResult.status === "fulfilled") {
        bundle.traffic = { alertCount: wazeResult.value.alerts.length };
      }

      if (weatherResult.status === "fulfilled") {
        bundle.weather = {
          tempF: weatherResult.value.tempF,
          weatherCode: weatherResult.value.weatherCode,
          aqi: weatherResult.value.aqi,
        };
      }

      const localHour = getLocalHour(city.timezone);
      const upi = computeUPI(bundle, city, localHour);

      return { slug: city.slug, score: upi.score, baseline: upi.baseline };
    }),
  );

  const data: Record<string, { score: number; baseline: number }> = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      data[result.value.slug] = {
        score: result.value.score,
        baseline: result.value.baseline,
      };
    }
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, max-age=120" },
  });
}
