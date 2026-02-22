import { fetchStaticPOIData } from "@/lib/pois-static";
import {
  fetchStaticPopularTimes,
  getCurrentActivity,
  isCurrentlyOpen,
} from "@/lib/populartimes-static";

// ── Category estimation curves (Tier 2 fallback) ─────────────────────

/** Returns an estimated 0-100 activity for a category given the local hour. */
export function estimateActivity(category: string, hour: number): number {
  switch (category) {
    case "restaurant": {
      if (hour >= 11 && hour < 14) return 50 + ((hour - 11) / 3) * 30;
      if (hour >= 18 && hour < 22) return 60 + ((hour - 18) / 4) * 30;
      if (hour >= 8 && hour < 11) return 20;
      if (hour >= 14 && hour < 18) return 30;
      return 0;
    }
    case "bar": {
      if (hour >= 20) return 60 + ((hour - 20) / 4) * 30;
      if (hour < 3) return 70 + ((3 - hour) / 3) * 20;
      return 0;
    }
    case "museum": {
      if (hour >= 10 && hour < 17) return 30 + ((hour - 10) / 7) * 40;
      return 0;
    }
    case "mall": {
      if (hour >= 10 && hour < 14) return 40 + ((hour - 10) / 4) * 20;
      if (hour >= 14 && hour < 16) return 70;
      if (hour >= 16 && hour < 21) return 60 - ((hour - 16) / 5) * 30;
      return 0;
    }
    case "airport": {
      if (hour >= 6 && hour < 9) return 40 + ((hour - 6) / 3) * 20;
      if (hour >= 16 && hour < 19) return 40 + ((hour - 16) / 3) * 20;
      if (hour >= 9 && hour < 16) return 35;
      return 25;
    }
    case "transit_hub": {
      if (hour >= 7 && hour < 10) return 60 + ((hour - 7) / 3) * 30;
      if (hour >= 17 && hour < 20) return 60 + ((hour - 17) / 3) * 30;
      if (hour >= 10 && hour < 17) return 40;
      return 15;
    }
    case "stadium": {
      if (hour >= 18 && hour < 23) return 25;
      return 10;
    }
    case "hospital": {
      return 40 + Math.sin(((hour - 6) / 12) * Math.PI) * 20;
    }
    case "plaza": {
      if (hour >= 8 && hour < 22)
        return 20 + Math.sin(((hour - 8) / 14) * Math.PI) * 40;
      return 5;
    }
    case "university": {
      if (hour >= 8 && hour < 18)
        return 30 + Math.sin(((hour - 8) / 10) * Math.PI) * 40;
      return 10;
    }
    default: {
      if (hour >= 8 && hour < 22)
        return 20 + Math.sin(((hour - 8) / 14) * Math.PI) * 40;
      return 5;
    }
  }
}

// ── City-wide POI activity aggregation ───────────────────────────────

/**
 * Computes the average POI activity (0-100) for a city at a given time.
 * Uses the three-tier fallback: popular times > category estimation > 0.
 * Returns 0 if no POI data exists for the slug.
 */
export function computeAvgPOIActivity(
  slug: string,
  localHour: number,
  dayOfWeek: number,
): number {
  const staticPois = fetchStaticPOIData(slug);
  if (!staticPois || staticPois.features.length === 0) return 0;

  const popularTimes = fetchStaticPopularTimes(slug);
  const flooredHour = Math.floor(localHour);

  let activitySum = 0;
  let count = 0;

  for (const feature of staticPois.features) {
    const props = feature.properties ?? {};
    const name = props.name as string;
    const hours = (props.hours as string) ?? "";
    const category = (props.poiType as string) ?? "other";

    const open = isCurrentlyOpen(hours, localHour);
    let activity: number;

    if (popularTimes && name && popularTimes[name]) {
      const ptActivity = getCurrentActivity(
        popularTimes[name],
        dayOfWeek,
        flooredHour,
      );
      if (ptActivity >= 0 && open) {
        activity = ptActivity;
      } else if (ptActivity >= 0 && !open) {
        activity = 0;
      } else {
        activity = open ? estimateActivity(category, flooredHour) : 0;
      }
    } else if (open) {
      activity = estimateActivity(category, flooredHour);
    } else {
      activity = 0;
    }

    activitySum += activity;
    count++;
  }

  return count > 0 ? Math.round(activitySum / count) : 0;
}
