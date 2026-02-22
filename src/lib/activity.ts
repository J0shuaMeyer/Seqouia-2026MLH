import type { City } from "@/data/cities";
import { circadianBaseline } from "@/lib/urban-pulse";

export interface RingParams {
  maxRadius: number;
  propagationSpeed: number;
  repeatPeriod: number;
}

/**
 * Computes a 0-1 normalized activity level for a city.
 * - With UPI score: directly maps 0-100 → 0.05-1.0
 * - Without UPI: uses circadian baseline from Gaussian mixture model
 */
export function computeActivityLevel(
  city: City,
  upiScore?: number,
): number {
  if (upiScore !== undefined && upiScore >= 0) {
    return Math.min(1.0, Math.max(0.05, upiScore / 100));
  }

  // Fallback: circadian baseline (Gaussian mixture)
  const localHour = getLocalHour(city.timezone);
  return circadianBaseline(localHour);
}

/** Maps a 0-1 activity level to ring visual parameters. */
export function activityToRingParams(activity: number): RingParams {
  return {
    maxRadius: 1 + activity * 3,
    propagationSpeed: 2 + activity * 6,
    repeatPeriod: 2000 - activity * 1500,
  };
}

/** Returns the local time as "HH:MM" for a GMT-offset timezone string. */
export function getLocalTime(timezone: string): string {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const match = timezone.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) return "--:--";

  const offsetHours = parseInt(match[1], 10);
  const offsetMins = match[2] ? parseInt(match[2], 10) * Math.sign(offsetHours) : 0;
  const totalOffset = offsetHours * 60 + offsetMins;

  const localMinutes = ((utcMinutes + totalOffset) % 1440 + 1440) % 1440;
  const h = Math.floor(localMinutes / 60);
  const m = localMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Returns the local time as "HH:MM:SS" for a GMT-offset timezone string. */
export function getLocalTimeWithSeconds(timezone: string): string {
  const now = new Date();
  const utcSeconds =
    now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();

  const match = timezone.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) return "--:--:--";

  const offsetHours = parseInt(match[1], 10);
  const offsetMins = match[2] ? parseInt(match[2], 10) * Math.sign(offsetHours) : 0;
  const totalOffsetSec = (offsetHours * 60 + offsetMins) * 60;

  const localSeconds = ((utcSeconds + totalOffsetSec) % 86400 + 86400) % 86400;
  const h = Math.floor(localSeconds / 3600);
  const m = Math.floor((localSeconds % 3600) / 60);
  const s = localSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Parses a GMT offset timezone string and returns the current local hour (0-23). */
export function getLocalHour(timezone: string): number {
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

/** Parses a GMT offset string to a numeric hour offset. */
export function parseTimezoneOffset(timezone: string): number {
  const match = timezone.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) * Math.sign(hours) : 0;
  return hours + minutes / 60;
}

/**
 * Computes approximate sunrise and sunset times for a given latitude/longitude.
 * Uses the simplified NOAA solar position equations — accurate to ~5 minutes.
 */
export function getSunTimes(
  lat: number,
  lng: number,
  utcOffsetHours: number,
): { sunrise: string; sunset: string; isDaytime: boolean } {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (now.getTime() - start.getTime()) / 86_400_000,
  );

  const rad = Math.PI / 180;
  const declination = -23.45 * Math.cos(rad * (360 / 365) * (dayOfYear + 10));

  const cosHA = -Math.tan(lat * rad) * Math.tan(declination * rad);
  // Polar edge cases
  if (cosHA > 1) return { sunrise: "--:--", sunset: "--:--", isDaytime: false };
  if (cosHA < -1) return { sunrise: "00:00", sunset: "23:59", isDaytime: true };

  const hourAngle = Math.acos(cosHA) / rad;
  const solarNoon = 12 - lng / 15; // UTC hours
  const sunriseUTC = solarNoon - hourAngle / 15;
  const sunsetUTC = solarNoon + hourAngle / 15;

  const toLocal = (h: number) =>
    ((h + utcOffsetHours) % 24 + 24) % 24;

  const sunriseLocal = toLocal(sunriseUTC);
  const sunsetLocal = toLocal(sunsetUTC);

  const format = (h: number) => {
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    const ampm = hrs >= 12 ? "PM" : "AM";
    const h12 = hrs % 12 || 12;
    return `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
  };

  // Check if current local time is between sunrise and sunset
  const utcSeconds =
    now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const localHour =
    ((utcSeconds / 3600 + utcOffsetHours) % 24 + 24) % 24;
  const isDaytime = localHour >= sunriseLocal && localHour < sunsetLocal;

  return { sunrise: format(sunriseLocal), sunset: format(sunsetLocal), isDaytime };
}
