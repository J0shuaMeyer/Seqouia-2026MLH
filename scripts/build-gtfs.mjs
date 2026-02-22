#!/usr/bin/env node
/**
 * build-gtfs.mjs — Download GTFS feeds and extract metro/rail station data.
 *
 * For each configured city:
 *   1. Downloads the GTFS .zip
 *   2. Parses routes.txt → filters by route_type 0 (Tram), 1 (Subway), 2 (Rail)
 *   3. Parses trips.txt → picks one representative trip per route (longest stop sequence)
 *   4. Parses stop_times.txt → gets ordered stop IDs per representative trip
 *   5. Parses stops.txt → resolves coordinates
 *   6. Outputs {slug}-stops.json and {slug}-routes.json into src/data/transit/
 *
 * Usage: node scripts/build-gtfs.mjs [slug...]
 *   No arguments → builds all cities
 *   With arguments → builds only named cities
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "src", "data", "transit");

// ── City feed configurations ────────────────────────────────────────

const FEEDS = [
  {
    slug: "mexico-city",
    url: "https://transitfeeds.com/p/metro-de-la-ciudad-de-mexico/70/latest/download",
    lineOverrides: {
      "1": { name: "Line 1", color: "#F54D9E" },
      "2": { name: "Line 2", color: "#0072BC" },
      "3": { name: "Line 3", color: "#AEC90B" },
      "4": { name: "Line 4", color: "#6EC8BD" },
      "5": { name: "Line 5", color: "#FFCF00" },
      "6": { name: "Line 6", color: "#D81E05" },
      "7": { name: "Line 7", color: "#F68E1F" },
      "8": { name: "Line 8", color: "#009A44" },
      "9": { name: "Line 9", color: "#532921" },
      "A": { name: "Line A", color: "#951B81" },
      "B": { name: "Line B", color: "#BAC616" },
      "12": { name: "Line 12", color: "#B29164" },
    },
  },
  {
    slug: "buenos-aires",
    url: "https://transitfeeds.com/p/subterraneos-de-buenos-aires-s-e-sbase/1189/latest/download",
    lineOverrides: {
      "A": { name: "Línea A", color: "#18cccc" },
      "B": { name: "Línea B", color: "#eb0909" },
      "C": { name: "Línea C", color: "#233aa8" },
      "D": { name: "Línea D", color: "#178a4e" },
      "E": { name: "Línea E", color: "#6d2d8e" },
      "H": { name: "Línea H", color: "#ffdd00" },
    },
  },
  {
    slug: "sao-paulo",
    url: "https://transitfeeds.com/p/sptrans/1049/latest/download",
    lineOverrides: {
      "1": { name: "Line 1 - Blue", color: "#0055A4" },
      "2": { name: "Line 2 - Green", color: "#007E5E" },
      "3": { name: "Line 3 - Red", color: "#EE3124" },
      "4": { name: "Line 4 - Yellow", color: "#FFD700" },
      "5": { name: "Line 5 - Lilac", color: "#9B59B6" },
      "15": { name: "Line 15 - Silver", color: "#9E9E9E" },
    },
  },
  {
    slug: "moscow",
    url: "https://transitfeeds.com/p/mosgortrans/237/latest/download",
    lineOverrides: {
      "1": { name: "Sokolnicheskaya", color: "#EF1E25" },
      "2": { name: "Zamoskvoretskaya", color: "#2DBE2C" },
      "3": { name: "Arbatsko-Pokrovskaya", color: "#0078C9" },
      "4": { name: "Filyovskaya", color: "#019CDC" },
      "5": { name: "Koltsevaya", color: "#894E35" },
      "6": { name: "Kaluzhsko-Rizhskaya", color: "#F58631" },
      "7": { name: "Tagansko-Krasnopresnenskaya", color: "#8E479C" },
      "8": { name: "Kalininskaya", color: "#FFD803" },
      "9": { name: "Serpukhovsko-Timiryazevskaya", color: "#ADACAC" },
      "10": { name: "Lyublinskaya", color: "#B2D233" },
      "11": { name: "Bolshaya Koltsevaya", color: "#79CDCD" },
      "12": { name: "Butovskaya", color: "#ACB5BD" },
      "14": { name: "MCC", color: "#DA4981" },
      "15": { name: "Nekrasovskaya", color: "#DE62BE" },
    },
  },
  {
    slug: "delhi",
    url: "https://transitfeeds.com/p/delhi-metro-rail-corporation-ltd/1017/latest/download",
    lineOverrides: {
      "RD": { name: "Red Line", color: "#EE1C25" },
      "YL": { name: "Yellow Line", color: "#FFCB08" },
      "BL": { name: "Blue Line", color: "#0B56A7" },
      "GR": { name: "Green Line", color: "#00A651" },
      "VL": { name: "Violet Line", color: "#8B569F" },
      "OR": { name: "Orange Line", color: "#F58220" },
      "MG": { name: "Magenta Line", color: "#E4007C" },
      "PK": { name: "Pink Line", color: "#FF69B4" },
      "GY": { name: "Grey Line", color: "#808080" },
      "RB": { name: "Rapid Metro", color: "#0099D8" },
      "AE": { name: "Airport Express", color: "#F58220" },
      "AQ": { name: "Aqua Line", color: "#00CED1" },
    },
  },
  {
    slug: "istanbul",
    url: "https://transitfeeds.com/p/istanbul-electric-tramway-and-tunnel-company/820/latest/download",
    lineOverrides: {
      "M1": { name: "M1", color: "#E4002B" },
      "M2": { name: "M2", color: "#009739" },
      "M3": { name: "M3", color: "#0072CE" },
      "M4": { name: "M4", color: "#E876A1" },
      "M5": { name: "M5", color: "#8246AF" },
      "M6": { name: "M6", color: "#A0522D" },
      "M7": { name: "M7", color: "#F05A22" },
      "M9": { name: "M9", color: "#FFD700" },
      "T1": { name: "T1 Tram", color: "#0072CE" },
      "T4": { name: "T4 Tram", color: "#DA1884" },
    },
  },
  {
    slug: "seoul",
    url: "https://transitfeeds.com/p/seoul-metro/593/latest/download",
    lineOverrides: {
      "1": { name: "Line 1", color: "#0052A4" },
      "2": { name: "Line 2", color: "#00A84D" },
      "3": { name: "Line 3", color: "#EF7C1C" },
      "4": { name: "Line 4", color: "#00A5DE" },
      "5": { name: "Line 5", color: "#996CAC" },
      "6": { name: "Line 6", color: "#CD7C2F" },
      "7": { name: "Line 7", color: "#747F00" },
      "8": { name: "Line 8", color: "#E6186C" },
      "9": { name: "Line 9", color: "#BDB092" },
    },
  },
  {
    slug: "osaka",
    url: "https://transitfeeds.com/p/osaka-municipal-transportation-bureau/871/latest/download",
    lineOverrides: {
      "M": { name: "Midosuji", color: "#E5171F" },
      "T": { name: "Tanimachi", color: "#522886" },
      "Y": { name: "Yotsubashi", color: "#0078BA" },
      "C": { name: "Chuo", color: "#009944" },
      "S": { name: "Sennichimae", color: "#E44D93" },
      "K": { name: "Sakaisuji", color: "#814721" },
      "N": { name: "Nagahori Tsurumi-ryokuchi", color: "#A9CC51" },
      "I": { name: "Imazatosuji", color: "#F2A200" },
      "P": { name: "New Tram", color: "#2BAFC3" },
    },
  },
  {
    slug: "tokyo",
    url: "https://transitfeeds.com/p/tokyo-metro/1269/latest/download",
    lineOverrides: {
      "G": { name: "Ginza", color: "#FF9500" },
      "M": { name: "Marunouchi", color: "#F62E36" },
      "H": { name: "Hibiya", color: "#B5B5AC" },
      "T": { name: "Tozai", color: "#009BBF" },
      "C": { name: "Chiyoda", color: "#00BB85" },
      "Y": { name: "Yurakucho", color: "#C1A470" },
      "Z": { name: "Hanzomon", color: "#8F76D6" },
      "N": { name: "Namboku", color: "#00AC9B" },
      "F": { name: "Fukutoshin", color: "#9C5E31" },
    },
  },
  {
    slug: "bangkok",
    url: "https://transitfeeds.com/p/bangkok-metro/981/latest/download",
    lineOverrides: {
      "BTS-S": { name: "BTS Silom", color: "#00A651" },
      "BTS-N": { name: "BTS Sukhumvit", color: "#00A651" },
      "MRT-B": { name: "MRT Blue", color: "#1E3A8A" },
      "MRT-P": { name: "MRT Purple", color: "#7B2D8E" },
      "ARL": { name: "Airport Rail Link", color: "#D22630" },
    },
  },
];

// ── Default line colors for feeds that lack route_color ─────────────

const DEFAULT_COLORS = [
  "#E53935", "#1E88E5", "#43A047", "#FB8C00", "#8E24AA",
  "#00ACC1", "#FFB300", "#6D4C41", "#546E7A", "#D81B60",
  "#3949AB", "#00897B", "#7CB342", "#F4511E", "#5C6BC0",
];

// ── Helpers ─────────────────────────────────────────────────────────

function parseCsv(text) {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  });
}

async function downloadZip(url) {
  console.log(`  Downloading ${url}`);
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
    headers: { "User-Agent": "SequoiaGTFS/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new AdmZip(buf);
}

function readEntry(zip, name) {
  const entry = zip.getEntries().find((e) => e.entryName.endsWith(name));
  if (!entry) return null;
  return entry.getData().toString("utf-8");
}

function normalizeRouteId(id) {
  return id?.toString().trim() ?? "";
}

// ── Main processing ─────────────────────────────────────────────────

async function processFeed(config) {
  const { slug, url, lineOverrides } = config;
  console.log(`\n=== ${slug} ===`);

  let zip;
  try {
    zip = await downloadZip(url);
  } catch (err) {
    console.error(`  SKIP: Could not download — ${err.message}`);
    return false;
  }

  // 1. Parse routes.txt — filter to rail types only
  const routesCsv = readEntry(zip, "routes.txt");
  if (!routesCsv) {
    console.error("  SKIP: No routes.txt found");
    return false;
  }

  const allRoutes = parseCsv(routesCsv);
  const railRoutes = allRoutes.filter((r) => {
    const type = parseInt(r.route_type, 10);
    return type === 0 || type === 1 || type === 2;
  });

  if (railRoutes.length === 0) {
    // If no rail routes found, try using ALL routes (some small metro feeds
    // don't set route_type correctly)
    console.warn("  WARNING: No route_type 0/1/2 found, using all routes");
    railRoutes.push(...allRoutes);
  }

  const railRouteIds = new Set(railRoutes.map((r) => normalizeRouteId(r.route_id)));
  console.log(`  Found ${railRoutes.length} rail routes: ${[...railRouteIds].join(", ")}`);

  // 2. Parse trips.txt — find representative trips per route
  const tripsCsv = readEntry(zip, "trips.txt");
  if (!tripsCsv) {
    console.error("  SKIP: No trips.txt found");
    return false;
  }

  const allTrips = parseCsv(tripsCsv);
  const railTrips = allTrips.filter((t) => railRouteIds.has(normalizeRouteId(t.route_id)));

  // Group trips by route
  const tripsByRoute = new Map();
  for (const trip of railTrips) {
    const rid = normalizeRouteId(trip.route_id);
    if (!tripsByRoute.has(rid)) tripsByRoute.set(rid, []);
    tripsByRoute.get(rid).push(trip.trip_id);
  }

  // 3. Parse stop_times.txt — get stop sequences for all rail trips
  const stopTimesCsv = readEntry(zip, "stop_times.txt");
  if (!stopTimesCsv) {
    console.error("  SKIP: No stop_times.txt found");
    return false;
  }

  const allStopTimes = parseCsv(stopTimesCsv);

  // Index stop_times by trip_id
  const stopTimesByTrip = new Map();
  for (const st of allStopTimes) {
    const tid = st.trip_id;
    if (!stopTimesByTrip.has(tid)) stopTimesByTrip.set(tid, []);
    stopTimesByTrip.get(tid).push(st);
  }

  // Pick the longest trip per route
  const representativeTrips = new Map(); // routeId → [ordered stop IDs]
  for (const [routeId, tripIds] of tripsByRoute) {
    let bestStops = [];
    for (const tripId of tripIds) {
      const sts = stopTimesByTrip.get(tripId);
      if (!sts) continue;
      sts.sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
      const stopIds = sts.map((s) => s.stop_id);
      if (stopIds.length > bestStops.length) bestStops = stopIds;
    }
    if (bestStops.length > 0) {
      representativeTrips.set(routeId, bestStops);
    }
  }

  console.log(`  Representative trips: ${representativeTrips.size} routes`);

  // 4. Parse stops.txt — get coordinates for used stops
  const stopsCsv = readEntry(zip, "stops.txt");
  if (!stopsCsv) {
    console.error("  SKIP: No stops.txt found");
    return false;
  }

  const allStops = parseCsv(stopsCsv);
  const usedStopIds = new Set();
  for (const stopIds of representativeTrips.values()) {
    for (const id of stopIds) usedStopIds.add(id);
  }

  // Build stops map
  const stopsMap = {};
  for (const stop of allStops) {
    if (!usedStopIds.has(stop.stop_id)) continue;
    const lat = parseFloat(stop.stop_lat);
    const lon = parseFloat(stop.stop_lon);
    if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) continue;
    stopsMap[stop.stop_id] = {
      name: stop.stop_name?.trim() || `Stop ${stop.stop_id}`,
      lat,
      lon,
    };
  }

  // Also resolve parent stations for stops that reference them
  const parentStops = new Map();
  for (const stop of allStops) {
    parentStops.set(stop.stop_id, stop);
  }

  // Resolve any stops that are missing by checking parent_station
  for (const stopId of usedStopIds) {
    if (stopsMap[stopId]) continue;
    const stop = parentStops.get(stopId);
    if (stop?.parent_station) {
      const parent = parentStops.get(stop.parent_station);
      if (parent) {
        const lat = parseFloat(parent.stop_lat);
        const lon = parseFloat(parent.stop_lon);
        if (!isNaN(lat) && !isNaN(lon)) {
          stopsMap[stopId] = {
            name: parent.stop_name?.trim() || `Stop ${stopId}`,
            lat,
            lon,
          };
        }
      }
    }
  }

  console.log(`  Resolved ${Object.keys(stopsMap).length} stops`);

  // 5. Build routes output
  const routesMap = {};
  let colorIdx = 0;
  for (const [routeId, stopIds] of representativeTrips) {
    // Find route info from CSV
    const routeRow = railRoutes.find((r) => normalizeRouteId(r.route_id) === routeId);

    // Determine name and color
    let name, color;
    const override = lineOverrides?.[routeId];
    if (override) {
      name = override.name;
      color = override.color;
    } else {
      name = routeRow?.route_long_name || routeRow?.route_short_name || `Route ${routeId}`;
      color =
        routeRow?.route_color && routeRow.route_color !== ""
          ? `#${routeRow.route_color.replace("#", "")}`
          : DEFAULT_COLORS[colorIdx++ % DEFAULT_COLORS.length];
    }

    // Filter to stops that we actually have coordinates for
    const resolvedStopIds = stopIds.filter((id) => stopsMap[id]);
    if (resolvedStopIds.length === 0) continue;

    routesMap[routeId] = { name, color, stopIds: resolvedStopIds };
  }

  console.log(`  Output: ${Object.keys(routesMap).length} routes, ${Object.keys(stopsMap).length} stops`);

  if (Object.keys(routesMap).length === 0) {
    console.error("  SKIP: No valid routes produced");
    return false;
  }

  // 6. Write output files
  const stopsPath = join(OUT_DIR, `${slug}-stops.json`);
  const routesPath = join(OUT_DIR, `${slug}-routes.json`);

  writeFileSync(stopsPath, JSON.stringify(stopsMap, null, 2));
  writeFileSync(routesPath, JSON.stringify(routesMap, null, 2));

  console.log(`  Wrote ${stopsPath}`);
  console.log(`  Wrote ${routesPath}`);
  return true;
}

// ── Entry point ─────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const requestedSlugs = process.argv.slice(2);
  const feedsToProcess =
    requestedSlugs.length > 0
      ? FEEDS.filter((f) => requestedSlugs.includes(f.slug))
      : FEEDS;

  if (feedsToProcess.length === 0) {
    console.error("No matching feeds found for:", requestedSlugs);
    process.exit(1);
  }

  console.log(`Processing ${feedsToProcess.length} feeds...`);

  const results = [];
  for (const feed of feedsToProcess) {
    const ok = await processFeed(feed);
    results.push({ slug: feed.slug, ok });
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.ok ? "OK" : "FAIL"} ${r.slug}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.warn(`\n${failed.length} feed(s) failed — these cities will need manual JSON data.`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
