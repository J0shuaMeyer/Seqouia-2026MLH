#!/usr/bin/env node
/**
 * build-pois.mjs — Query Overpass API (OpenStreetMap) for Points of Interest.
 *
 * For each configured city:
 *   1. Queries Overpass API for 12 POI categories
 *   2. Ranks results by notability (wikidata tag) then proximity to city center
 *   3. Caps per-category limits to avoid clutter
 *   4. Validates coordinates, removes duplicates
 *   5. Outputs {slug}.json into src/data/pois/
 *
 * Usage: node scripts/build-pois.mjs [slug...]
 *   No arguments → builds all cities
 *   With arguments → builds only named cities
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "src", "data", "pois");

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const RATE_LIMIT_MS = 5000; // 5 seconds between requests
const MAX_RETRIES = 3;

// ── City configurations ─────────────────────────────────────────────

const CITIES = [
  {
    slug: "new-york-city",
    name: "New York City",
    lat: 40.7128,
    lon: -74.0060,
    bbox: [40.40, -74.50, 41.10, -73.50], // [south, west, north, east]
  },
  {
    slug: "los-angeles",
    name: "Los Angeles",
    lat: 34.0522,
    lon: -118.2437,
    bbox: [33.50, -118.80, 34.50, -117.50],
  },
  {
    slug: "mexico-city",
    name: "Mexico City",
    lat: 19.4326,
    lon: -99.1332,
    bbox: [19.00, -99.60, 19.80, -98.70],
  },
  {
    slug: "sao-paulo",
    name: "São Paulo",
    lat: -23.5505,
    lon: -46.6333,
    bbox: [-24.00, -47.20, -23.10, -46.10],
  },
  {
    slug: "buenos-aires",
    name: "Buenos Aires",
    lat: -34.6037,
    lon: -58.3816,
    bbox: [-35.00, -58.80, -34.20, -57.80],
  },
];

// ── Category definitions ────────────────────────────────────────────
// Each category defines the Overpass query filter, search radius, max results,
// and default operating hours (used when OSM lacks opening_hours tag).

const CATEGORIES = [
  {
    id: "stadium",
    query: `nwr["leisure"="stadium"]`,
    radius: 15000,
    limit: 5,
    defaultHours: "varies",
  },
  {
    id: "airport",
    query: `nwr["aeroway"="aerodrome"]["iata"]`,
    radius: 40000,
    limit: 2,
    defaultHours: "24h",
  },
  {
    id: "mall",
    query: `nwr["shop"="mall"]`,
    radius: 15000,
    limit: 5,
    defaultHours: "10:00-22:00",
  },
  {
    id: "theme_park",
    query: `(nwr["tourism"="theme_park"];nwr["leisure"="amusement_park"];)`,
    radius: 20000,
    limit: 3,
    defaultHours: "10:00-18:00",
  },
  {
    id: "restaurant",
    query: `nwr["amenity"="restaurant"]["name"]["cuisine"]`,
    radius: 10000,
    limit: 8,
    defaultHours: "11:00-23:00",
  },
  {
    id: "bar",
    query: `(nwr["amenity"="nightclub"]["name"];nwr["amenity"="bar"]["name"];)`,
    radius: 10000,
    limit: 5,
    defaultHours: "18:00-04:00",
  },
  {
    id: "museum",
    query: `nwr["tourism"="museum"]`,
    radius: 15000,
    limit: 5,
    defaultHours: "09:00-17:00",
  },
  {
    id: "plaza",
    query: `(nwr["place"="square"];nwr["leisure"="park"]["name"]["wikidata"];)`,
    radius: 10000,
    limit: 4,
    defaultHours: "24h",
  },
  {
    id: "university",
    query: `nwr["amenity"="university"]`,
    radius: 15000,
    limit: 3,
    defaultHours: "07:00-22:00",
  },
  {
    id: "transit_hub",
    query: `nwr["railway"="station"]["name"]`,
    radius: 15000,
    limit: 5,
    defaultHours: "05:00-01:00",
  },
  {
    id: "convention_center",
    query: `nwr["amenity"="conference_centre"]`,
    radius: 15000,
    limit: 2,
    defaultHours: "08:00-20:00",
  },
  {
    id: "hospital",
    query: `nwr["amenity"="hospital"]["name"]`,
    radius: 10000,
    limit: 3,
    defaultHours: "24h",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Haversine distance in meters between two lat/lon points.
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Build the Overpass query body properly handling union vs simple queries.
 */
function buildOverpassQuery(category, cityLat, cityLon) {
  const { query, radius } = category;

  if (query.startsWith("(")) {
    // Union query: multiple nwr selectors inside parentheses
    // Parse out each nwr clause and add around filter
    const inner = query.slice(1, -1); // strip outer ( )
    const parts = inner.split(";").filter((p) => p.trim());
    const withAround = parts
      .map((p) => `${p.trim()}(around:${radius},${cityLat},${cityLon})`)
      .join(";");
    return `[out:json][timeout:30];(${withAround};);out center tags;`;
  }

  return `[out:json][timeout:30];${query}(around:${radius},${cityLat},${cityLon});out center tags;`;
}

/**
 * Query Overpass with retry logic for rate limiting (429) and server errors (5xx).
 */
async function fetchCategory(category, cityLat, cityLon) {
  const body = buildOverpassQuery(category, cityLat, cityLon);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = 10_000 * attempt; // 10s, 20s, 30s
      console.log(`    Retry ${attempt}/${MAX_RETRIES} after ${backoff / 1000}s backoff...`);
      await sleep(backoff);
    }

    const res = await fetch(OVERPASS_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(body)}`,
      signal: AbortSignal.timeout(60_000),
    });

    if (res.status === 429 || res.status >= 500) {
      if (attempt < MAX_RETRIES) continue;
      throw new Error(`Overpass HTTP ${res.status} after ${MAX_RETRIES} retries`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Overpass HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    return json.elements ?? [];
  }

  return [];
}

/**
 * Extract lat/lon from an Overpass element.
 * Nodes have lat/lon directly; ways/relations have center.lat/center.lon.
 */
function getCoords(el) {
  if (el.lat !== undefined && el.lon !== undefined) {
    return { lat: el.lat, lon: el.lon };
  }
  if (el.center) {
    return { lat: el.center.lat, lon: el.center.lon };
  }
  return null;
}

/**
 * Rank elements by notability: prefer those with a wikidata tag,
 * then sort by proximity to city center.
 */
function rankElements(elements, cityLat, cityLon) {
  return elements
    .map((el) => {
      const coords = getCoords(el);
      if (!coords) return null;
      const dist = haversineMeters(cityLat, cityLon, coords.lat, coords.lon);
      const hasWikidata = !!el.tags?.wikidata;
      return { el, coords, dist, hasWikidata };
    })
    .filter(Boolean)
    .sort((a, b) => {
      // Wikidata-tagged venues first, then by distance
      if (a.hasWikidata !== b.hasWikidata) return a.hasWikidata ? -1 : 1;
      return a.dist - b.dist;
    });
}

/**
 * Check if coordinates fall within a city's bounding box.
 */
function isInBbox(lat, lon, bbox) {
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lon >= west && lon <= east;
}

// ── Main processing ─────────────────────────────────────────────────

async function processCity(city) {
  const { slug, name, lat, lon, bbox } = city;
  console.log(`\n=== ${name} (${slug}) ===`);

  const allPois = [];
  let requestCount = 0;

  for (const category of CATEGORIES) {
    try {
      if (requestCount > 0) await sleep(RATE_LIMIT_MS);

      console.log(`  Querying ${category.id}...`);
      const elements = await fetchCategory(category, lat, lon);
      requestCount++;

      const ranked = rankElements(elements, lat, lon);

      // Take top N by limit
      const top = ranked.slice(0, category.limit);

      for (const item of top) {
        const tags = item.el.tags ?? {};
        allPois.push({
          name: tags.name ?? tags["name:en"] ?? "",
          lat: Math.round(item.coords.lat * 10000) / 10000,
          lon: Math.round(item.coords.lon * 10000) / 10000,
          category: category.id,
          hours: tags.opening_hours ?? category.defaultHours,
          google_place_id: "",
        });
      }

      console.log(`    Found ${elements.length} → kept ${top.length}`);
    } catch (err) {
      console.error(`    ERROR on ${category.id}: ${err.message}`);
    }
  }

  // ── Validation ──────────────────────────────────────────────────
  const beforeCount = allPois.length;
  let removedEmpty = 0;
  let removedBbox = 0;
  let removedDuplicates = 0;

  // Remove entries with empty/missing names
  const named = allPois.filter((p) => {
    if (!p.name || p.name.trim() === "") {
      removedEmpty++;
      return false;
    }
    return true;
  });

  // Remove entries outside city bbox
  const inBounds = named.filter((p) => {
    if (!isInBbox(p.lat, p.lon, bbox)) {
      removedBbox++;
      return false;
    }
    return true;
  });

  // Remove duplicates (same name within 200m)
  const deduped = [];
  for (const poi of inBounds) {
    const isDupe = deduped.some(
      (existing) =>
        existing.name === poi.name &&
        haversineMeters(existing.lat, existing.lon, poi.lat, poi.lon) < 200,
    );
    if (isDupe) {
      removedDuplicates++;
    } else {
      deduped.push(poi);
    }
  }

  console.log(`  Validation: ${beforeCount} raw → ${deduped.length} final`);
  if (removedEmpty) console.log(`    Removed ${removedEmpty} with empty names`);
  if (removedBbox) console.log(`    Removed ${removedBbox} outside bbox`);
  if (removedDuplicates)
    console.log(`    Removed ${removedDuplicates} duplicates`);

  // ── Write output ────────────────────────────────────────────────
  const outPath = join(OUT_DIR, `${slug}.json`);
  writeFileSync(outPath, JSON.stringify(deduped, null, 2));
  console.log(`  Wrote ${outPath} (${deduped.length} POIs)`);

  return { slug, count: deduped.length };
}

// ── Entry point ─────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const requestedSlugs = process.argv.slice(2);
  const citiesToProcess =
    requestedSlugs.length > 0
      ? CITIES.filter((c) => requestedSlugs.includes(c.slug))
      : CITIES;

  if (citiesToProcess.length === 0) {
    console.error("No matching cities found for:", requestedSlugs);
    process.exit(1);
  }

  console.log(`Processing ${citiesToProcess.length} cities...`);

  const results = [];
  for (const city of citiesToProcess) {
    const result = await processCity(city);
    results.push(result);
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.slug}: ${r.count} POIs`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
