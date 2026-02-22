import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";
import { getLocalHour, parseTimezoneOffset } from "@/lib/activity";
import { fetchCityWazeData } from "@/lib/waze";
import { fetchWeatherData } from "@/lib/weather";
import { fetchAircraftData } from "@/lib/opensky";
import { fetchMaritimeData } from "@/lib/maritime";
import { fetchBikeShareData } from "@/lib/bikeshare";
import { computeAvgPOIActivity } from "@/lib/poi-activity";
import { computeUPI, type SignalBundle } from "@/lib/urban-pulse";

/**
 * GET /api/pulse/[slug]
 *
 * Full Urban Pulse Index for a single city.
 * Fetches ALL available signals in parallel, computes UPI with quality
 * assessment and per-signal breakdown.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }

  const localHour = getLocalHour(city.timezone);
  const utcOffset = parseTimezoneOffset(city.timezone);
  const now = new Date();
  const utcTotalHours = now.getUTCHours() + utcOffset;
  const utcDay = now.getUTCDay();
  const dayOfWeek =
    utcTotalHours >= 24 ? (utcDay + 1) % 7 :
    utcTotalHours < 0 ? (utcDay + 6) % 7 :
    utcDay;

  // Fetch all available signals in parallel
  const [wazeResult, weatherResult, aircraftResult, maritimeResult, bikeResult] =
    await Promise.allSettled([
      fetchCityWazeData(city.bbox, city.country),
      fetchWeatherData(city.lat, city.lng),
      fetchAircraftData(city.bbox, city.slug),
      city.isCoastal
        ? fetchMaritimeData(city.bbox, city.slug)
        : Promise.reject("not coastal"),
      city.bikeNetwork
        ? fetchBikeShareData(city.bikeNetwork, city.slug)
        : Promise.reject("no bike network"),
    ]);

  // POI activity is synchronous (reads from static files)
  const avgPOIActivity = computeAvgPOIActivity(slug, localHour, dayOfWeek);

  // Build signal bundle from fulfilled results
  const bundle: SignalBundle = {};

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

  if (aircraftResult.status === "fulfilled") {
    bundle.air = { aircraftCount: aircraftResult.value.features.length };
  }

  if (maritimeResult.status === "fulfilled") {
    bundle.maritime = { vesselCount: maritimeResult.value.features.length };
  }

  if (bikeResult.status === "fulfilled") {
    const features = bikeResult.value.features;
    if (features.length > 0) {
      // Compute average utilization: 1 - mean(availableBikes / totalDocks)
      let utilizationSum = 0;
      let stationCount = 0;
      for (const f of features) {
        const available = (f.properties?.availableBikes as number) ?? 0;
        const total = (f.properties?.totalDocks as number) ?? 0;
        if (total > 0) {
          utilizationSum += 1 - available / total;
          stationCount++;
        }
      }
      if (stationCount > 0) {
        bundle.bike = { avgUtilization: utilizationSum / stationCount };
      }
    }
  }

  if (avgPOIActivity > 0) {
    bundle.poi = { avgActivity: avgPOIActivity };
  }

  const result = computeUPI(bundle, city, localHour);

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=120" },
  });
}
