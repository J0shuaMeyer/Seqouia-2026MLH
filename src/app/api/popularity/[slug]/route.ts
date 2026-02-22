import { NextResponse } from "next/server";
import { getCityBySlug } from "@/data/cities";
import { fetchPOIData } from "@/lib/wikidata";
import { fetchStaticPOIData } from "@/lib/pois-static";
import {
  fetchStaticPopularTimes,
  getCurrentActivity,
  isCurrentlyOpen,
} from "@/lib/populartimes-static";
import { parseTimezoneOffset } from "@/lib/activity";
import { estimateActivity } from "@/lib/poi-activity";

// ── Haversine dedup (shared with pois route) ──────────────────────────

function haversineMeters(
  coords1: [number, number],
  coords2: [number, number],
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Route handler ─────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }

  // 1. Load static POIs
  const staticPois = fetchStaticPOIData(slug);

  // 2. Fetch Wikidata POIs
  const wikidataPois = await fetchPOIData(city.lat, city.lng, city.slug);

  // 3. Load popular times data
  const popularTimes = fetchStaticPopularTimes(slug);

  // 4. Compute local time
  const utcOffset = parseTimezoneOffset(city.timezone);
  const now = new Date();
  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const localHour = ((utcHour + utcOffset) % 24 + 24) % 24;
  const localDayOfWeek = (() => {
    const utcDay = now.getUTCDay();
    const utcTotalHours = now.getUTCHours() + utcOffset;
    if (utcTotalHours >= 24) return (utcDay + 1) % 7;
    if (utcTotalHours < 0) return (utcDay + 6) % 7;
    return utcDay;
  })();

  // 5. Merge static + wikidata features
  let merged: GeoJSON.Feature[];

  if (!staticPois) {
    merged = [...wikidataPois.features];
  } else {
    merged = [...staticPois.features];
    for (const wdFeature of wikidataPois.features) {
      const wdCoords = (wdFeature.geometry as GeoJSON.Point)
        .coordinates as [number, number];
      const isDuplicate = merged.some((existing) => {
        const existingCoords = (existing.geometry as GeoJSON.Point)
          .coordinates as [number, number];
        return haversineMeters(wdCoords, existingCoords) < 100;
      });
      if (!isDuplicate) merged.push(wdFeature);
    }
  }

  // 6. Enrich each feature with activity + isOpen
  for (const feature of merged) {
    const props = feature.properties ?? {};
    const name = props.name as string;
    const hours = (props.hours as string) ?? "";
    const category = (props.poiType as string) ?? "other";

    // Determine if open
    const open = isCurrentlyOpen(hours, localHour);

    // Compute activity (three-tier)
    let activity: number;

    if (popularTimes && name && popularTimes[name]) {
      // Tier 1: real popular times data
      const ptEntry = popularTimes[name];
      const ptActivity = getCurrentActivity(
        ptEntry,
        localDayOfWeek,
        Math.floor(localHour),
      );

      if (ptActivity >= 0 && open) {
        activity = ptActivity;
      } else if (ptActivity >= 0 && !open) {
        activity = 0;
      } else {
        // populartimes returned -1 (no weekly data), fall through to tier 2
        activity = open ? estimateActivity(category, Math.floor(localHour)) : 0;
      }
    } else if (open) {
      // Tier 2: category estimation
      activity = estimateActivity(category, Math.floor(localHour));
    } else {
      // Tier 3: closed
      activity = 0;
    }

    feature.properties = {
      ...props,
      activity: Math.round(activity),
      isOpen: open,
    };
  }

  const geojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: merged,
  };

  return NextResponse.json(geojson, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
