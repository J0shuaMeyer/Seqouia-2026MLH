import type { City } from "@/data/cities";

export interface RingParams {
  maxRadius: number;
  propagationSpeed: number;
  repeatPeriod: number;
}

/**
 * Computes a 0-1 normalized activity level for a city.
 * - Tier 1 with real alertCount: normalized from Waze data
 * - Tier 2/3 or no data: simulated from local time-of-day
 */
export function computeActivityLevel(
  city: City,
  alertCount?: number
): number {
  if (alertCount !== undefined && alertCount >= 0) {
    // Real data: 0 alerts → 0.1, 500+ alerts → 1.0
    return Math.min(1.0, 0.1 + (alertCount / 500) * 0.9);
  }

  // Simulate based on local time and tier
  const localHour = getLocalHour(city.timezone);
  // Sine curve: peaks around 12-14 (afternoon rush), lowest around 3-5 AM
  const timeFactor = Math.sin(((localHour - 5) / 12) * Math.PI);
  const clampedTime = Math.max(0, timeFactor);
  const tierFactor = city.dataTier === 1 ? 0.8 : city.dataTier === 2 ? 0.7 : 0.4;
  return Math.max(0.1, clampedTime * tierFactor);
}

/** Maps a 0-1 activity level to ring visual parameters. */
export function activityToRingParams(activity: number): RingParams {
  return {
    maxRadius: 1 + activity * 3,
    propagationSpeed: 2 + activity * 6,
    repeatPeriod: 2000 - activity * 1500,
  };
}

/** Returns an activity color for sidebar display (green → amber → red). */
export function activityColor(activity: number): string {
  if (activity < 0.35) return "#22c55e"; // green
  if (activity < 0.65) return "#f59e0b"; // amber
  return "#ef4444"; // red
}

/** Parses a GMT offset timezone string and returns the current local hour (0-23). */
function getLocalHour(timezone: string): number {
  const now = new Date();
  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;

  // Parse offset from "GMT+5:30", "GMT-3", "GMT+9", etc.
  const match = timezone.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) return utcHour;

  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) * Math.sign(hours) : 0;
  const offset = hours + minutes / 60;

  return ((utcHour + offset) % 24 + 24) % 24;
}
