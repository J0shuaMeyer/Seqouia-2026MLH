import { NextResponse } from "next/server";

const CELESTRAK_URL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json";
const LEO_MIN_MEAN_MOTION = 11.0; // ≥11 rev/day ≈ <2000 km altitude
const SAMPLE_SIZE = 800;
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

interface OMMRecord {
  OBJECT_NAME: string;
  NORAD_CAT_ID: number;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  EPOCH: string;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
}

let cache: { data: OMMRecord[]; ts: number } | null = null;

/** Fisher-Yates shuffle, then take first n */
function sampleArray<T>(arr: T[], n: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export async function GET() {
  // Return cached data if fresh
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data, {
      headers: { "Cache-Control": "public, max-age=43200" },
    });
  }

  try {
    const res = await fetch(CELESTRAK_URL, { next: { revalidate: 43200 } });
    if (!res.ok) throw new Error(`CelesTrak ${res.status}`);
    const all: OMMRecord[] = await res.json();

    const leo = all.filter((r) => r.MEAN_MOTION >= LEO_MIN_MEAN_MOTION);
    const sampled = sampleArray(leo, SAMPLE_SIZE);

    cache = { data: sampled, ts: Date.now() };

    return NextResponse.json(sampled, {
      headers: { "Cache-Control": "public, max-age=43200" },
    });
  } catch {
    // Return stale cache or empty array
    return NextResponse.json(cache?.data ?? [], {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }
}
