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

// ── Category estimation curves (Tier 2 fallback) ─────────────────────

/** Returns an estimated 0-100 activity for a category given the local hour. */
function estimateActivity(category: string, hour: number): number {
  switch (category) {
    case "restaurant": {
      // Lunch peak 11-14, dinner peak 18-22
      if (hour >= 11 && hour < 14) return 50 + ((hour - 11) / 3) * 30;
      if (hour >= 18 && hour < 22) return 60 + ((hour - 18) / 4) * 30;
      if (hour >= 8 && hour < 11) return 20;
      if (hour >= 14 && hour < 18) return 30;
      return 0;
    }
    case "bar": {
      // Ramp 20-03, dead during day
      if (hour >= 20) return 60 + ((hour - 20) / 4) * 30;
      if (hour < 3) return 70 + ((3 - hour) / 3) * 20;
      return 0;
    }
    case "museum": {
      // Steady 10-17
      if (hour >= 10 && hour < 17) return 30 + ((hour - 10) / 7) * 40;
      return 0;
    }
    case "mall": {
      // Rise to 14-16 peak
      if (hour >= 10 && hour < 14) return 40 + ((hour - 10) / 4) * 20;
      if (hour >= 14 && hour < 16) return 70;
      if (hour >= 16 && hour < 21) return 60 - ((hour - 16) / 5) * 30;
      return 0;
    }
    case "airport": {
      // Bimodal 6-9 and 16-19, always moderate
      if (hour >= 6 && hour < 9) return 40 + ((hour - 6) / 3) * 20;
      if (hour >= 16 && hour < 19) return 40 + ((hour - 16) / 3) * 20;
      if (hour >= 9 && hour < 16) return 35;
      return 25;
    }
    case "transit_hub": {
      // Rush hours 7-10 and 17-20
      if (hour >= 7 && hour < 10) return 60 + ((hour - 7) / 3) * 30;
      if (hour >= 17 && hour < 20) return 60 + ((hour - 17) / 3) * 30;
      if (hour >= 10 && hour < 17) return 40;
      return 15;
    }
    case "stadium": {
      // Low baseline unless event
      if (hour >= 18 && hour < 23) return 25;
      return 10;
    }
    case "hospital": {
      // Always moderate
      return 40 + Math.sin(((hour - 6) / 12) * Math.PI) * 20;
    }
    case "plaza": {
      // Daytime 8-22
      if (hour >= 8 && hour < 22)
        return 20 + Math.sin(((hour - 8) / 14) * Math.PI) * 40;
      return 5;
    }
    case "university": {
      // Weekday 8-18
      if (hour >= 8 && hour < 18)
        return 30 + Math.sin(((hour - 8) / 10) * Math.PI) * 40;
      return 10;
    }
    default: {
      // Generic daytime curve
      if (hour >= 8 && hour < 22)
        return 20 + Math.sin(((hour - 8) / 14) * Math.PI) * 40;
      return 5;
    }
  }
}

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
