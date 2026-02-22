"use client";

import { useState, useEffect, useCallback } from "react";
import { cities } from "@/data/cities";
import { computeActivityLevel } from "@/lib/activity";

/** Returns activity data and a loaded flag indicating first fetch completed. */
export function useActivityData() {
  const [activityMap, setActivityMap] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    // Fetch batch UPI scores for all cities
    let batchData: Record<string, { score: number; baseline: number }> = {};
    try {
      const res = await fetch("/api/activity");
      if (res.ok) batchData = await res.json();
    } catch {
      // Fall back to circadian baseline for all
    }

    // Map UPI scores to 0-1 activity levels
    const map: Record<string, number> = {};
    for (const city of cities) {
      const real = batchData[city.slug];
      map[city.slug] = computeActivityLevel(city, real?.score);
    }
    setActivityMap(map);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 120_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { activityMap, loaded };
}
