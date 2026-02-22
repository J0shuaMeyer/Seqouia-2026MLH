import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";
import { fetchWeatherData } from "@/lib/weather";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }

  const weather = await fetchWeatherData(city.lat, city.lng);

  return NextResponse.json(weather, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
