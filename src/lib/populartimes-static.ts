import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ── Types ────────────────────────────────────────────────────────────

export interface PopularTimesEntry {
  google_place_id: string;
  category: string;
  /** 7-day array with { name, data: number[24] } or null if unavailable */
  populartimes: Array<{ name: string; data: number[] }> | null;
  current_popularity: number;
}

// ── In-memory cache ──────────────────────────────────────────────────

const cache = new Map<string, Record<string, PopularTimesEntry> | null>();

// ── Day name mapping ─────────────────────────────────────────────────

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load static popular times data for a city slug.
 * Returns a record keyed by POI name, or null if no file exists.
 */
export function fetchStaticPopularTimes(
  slug: string,
): Record<string, PopularTimesEntry> | null {
  if (cache.has(slug)) return cache.get(slug)!;

  const filePath = join(
    process.cwd(),
    "src",
    "data",
    "populartimes",
    `${slug}.json`,
  );

  if (!existsSync(filePath)) {
    cache.set(slug, null);
    return null;
  }

  const raw = readFileSync(filePath, "utf-8");
  const data: Record<string, PopularTimesEntry> = JSON.parse(raw);

  cache.set(slug, data);
  return data;
}

/**
 * Get the activity level (0-100) for a given day of week and hour
 * from the weekly popular times pattern.
 *
 * @param entry  The popular times entry for a POI
 * @param dayOfWeek  0 = Sunday, 6 = Saturday (JS Date.getDay())
 * @param hour  0-23
 */
export function getCurrentActivity(
  entry: PopularTimesEntry,
  dayOfWeek: number,
  hour: number,
): number {
  if (!entry.populartimes) return -1; // signals "no data"

  const dayName = DAY_NAMES[dayOfWeek];
  const dayData = entry.populartimes.find((d) => d.name === dayName);
  if (!dayData || !dayData.data) return -1;

  const clampedHour = Math.max(0, Math.min(23, Math.floor(hour)));
  return dayData.data[clampedHour] ?? 0;
}

/**
 * Determine if a venue is currently open based on its hours string.
 *
 * Supports:
 *  - "24h"           → always open
 *  - "HH:MM-HH:MM"  → standard range (handles overnight wrap)
 *  - "varies"        → unknown, assume open during daytime (6-23)
 *  - empty/other     → unknown, assume open during daytime
 */
export function isCurrentlyOpen(hours: string, currentHour: number): boolean {
  if (!hours) return currentHour >= 6 && currentHour < 23;

  const trimmed = hours.trim().toLowerCase();

  if (trimmed === "24h") return true;

  if (trimmed === "varies") {
    return currentHour >= 6 && currentHour < 23;
  }

  // Parse "HH:MM-HH:MM"
  const match = hours.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return currentHour >= 6 && currentHour < 23;

  const openHour = parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
  const closeHour = parseInt(match[3], 10) + parseInt(match[4], 10) / 60;

  if (closeHour > openHour) {
    // Normal range (e.g. 10:00-21:00)
    return currentHour >= openHour && currentHour < closeHour;
  } else {
    // Overnight range (e.g. 22:00-06:00)
    return currentHour >= openHour || currentHour < closeHour;
  }
}
