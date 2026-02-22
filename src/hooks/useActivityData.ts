"use client";

import { useState, useEffect, useCallback } from "react";
import { cities } from "@/data/cities";
import { computeActivityLevel } from "@/lib/activity";

/** Returns a Record<slug, activity (0-1)> for all cities, refreshed every 2 min. */
export function useActivityData() {
  const [activityMap, setActivityMap] = useState<Record<string, number>>({});

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
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 120_000);
    return () => clearInterval(id);
  }, [refresh]);

  return activityMap;
}
