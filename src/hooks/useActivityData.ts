"use client";

import { useState, useEffect, useCallback } from "react";
import { cities } from "@/data/cities";
import { computeActivityLevel } from "@/lib/activity";

/** Returns activity data and a loaded flag indicating first fetch completed. */
export function useActivityData() {
  const [activityMap, setActivityMap] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    // Fetch real data for Tier 1 cities
    let tier1Data: Record<string, { alertCount: number }> = {};
    try {
      const res = await fetch("/api/activity");
      if (res.ok) tier1Data = await res.json();
    } catch {
      // Fall back to simulated data for all
    }

    // Compute activity for every city
    const map: Record<string, number> = {};
    for (const city of cities) {
      const real = tier1Data[city.slug];
      map[city.slug] = computeActivityLevel(city, real?.alertCount);
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
