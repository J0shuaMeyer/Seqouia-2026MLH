#!/usr/bin/env node

/**
 * build-place-ids.mjs
 *
 * Resolves Google Place IDs for every curated POI in src/data/pois/*.json.
 * Uses the "Find Place From Text" API with location bias for accuracy.
 *
 * Usage:  node scripts/build-place-ids.mjs
 * Env:    MAPS_PLATFORM_API_KEY must be set in .env
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, basename } from "path";

const API_KEY = process.env.MAPS_PLATFORM_API_KEY;
if (!API_KEY) {
  // Try loading from .env manually
  const envPath = join(process.cwd(), ".env");
  try {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^MAPS_PLATFORM_API_KEY\s*=\s*(.+)$/);
      if (match) {
        process.env.MAPS_PLATFORM_API_KEY = match[1].trim();
        break;
      }
    }
  } catch {
    // ignore
  }
}

const KEY = process.env.MAPS_PLATFORM_API_KEY;
if (!KEY) {
  console.error("Missing MAPS_PLATFORM_API_KEY in environment or .env");
  process.exit(1);
}

const POIS_DIR = join(process.cwd(), "src", "data", "pois");
const RATE_LIMIT_MS = 100; // 10 QPS max, 100ms between calls

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolvePlaceId(name, lat, lon) {
  const params = new URLSearchParams({
    input: name,
    inputtype: "textquery",
    locationbias: `point:${lat},${lon}`,
    fields: "place_id",
    key: KEY,
  });

  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for "${name}"`);

  const data = await res.json();
  if (data.candidates?.length > 0) {
    return data.candidates[0].place_id;
  }
  return null;
}

async function main() {
  const files = readdirSync(POIS_DIR).filter((f) => f.endsWith(".json"));
  let total = 0;
  let resolved = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = join(POIS_DIR, file);
    const slug = basename(file, ".json");
    const pois = JSON.parse(readFileSync(filePath, "utf-8"));

    console.log(`\n── ${slug} (${pois.length} POIs) ──`);

    let changed = false;

    for (const poi of pois) {
      total++;

      // Skip if already resolved
      if (poi.google_place_id && poi.google_place_id.length > 0) {
        skipped++;
        console.log(`  ✓ ${poi.name} (cached)`);
        continue;
      }

      try {
        const placeId = await resolvePlaceId(poi.name, poi.lat, poi.lon);
        if (placeId) {
          poi.google_place_id = placeId;
          resolved++;
          changed = true;
          console.log(`  ✓ ${poi.name} → ${placeId}`);
        } else {
          failed++;
          console.log(`  ✗ ${poi.name} (no candidates)`);
        }
      } catch (err) {
        failed++;
        console.log(`  ✗ ${poi.name} (${err.message})`);
      }

      await sleep(RATE_LIMIT_MS);
    }

    if (changed) {
      writeFileSync(filePath, JSON.stringify(pois, null, 2) + "\n");
      console.log(`  → Saved ${filePath}`);
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`  Total: ${total}  Resolved: ${resolved}  Skipped: ${skipped}  Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
