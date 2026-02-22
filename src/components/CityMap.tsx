"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { City } from "@/data/cities";
import { getLocalTimeWithSeconds } from "@/lib/activity";
import CitySidebar from "@/components/CitySidebar";
import CityFilterBar, { getAvailableFilters } from "@/components/CityFilterBar";

interface CityMapProps {
  city: City;
}

const WAZE_REFRESH_MS = 120_000;    // 2 minutes
const BIKESHARE_REFRESH_MS = 60_000; // 1 minute
const TRANSIT_REFRESH_MS = 30_000;   // 30 seconds
const WEATHER_REFRESH_MS = 300_000;  // 5 minutes
const AIRCRAFT_REFRESH_MS = 30_000;  // 30 seconds
const MARITIME_REFRESH_MS = 60_000;  // 60 seconds
const EARTHQUAKE_REFRESH_MS = 60_000; // 60 seconds
const POI_REFRESH_MS = 300_000;      // 5 minutes (matches server cache TTL)

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** Canvas-rendered SDF airplane silhouette pointing north */
function createAirplaneIcon(size = 32): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const s = size / 32; // scale factor

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  // Fuselage
  ctx.moveTo(16 * s, 2 * s);   // nose (top, pointing north)
  ctx.lineTo(18 * s, 10 * s);
  ctx.lineTo(18 * s, 20 * s);
  ctx.lineTo(16 * s, 30 * s);  // tail
  ctx.lineTo(14 * s, 20 * s);
  ctx.lineTo(14 * s, 10 * s);
  ctx.closePath();
  ctx.fill();
  // Wings
  ctx.beginPath();
  ctx.moveTo(16 * s, 12 * s);
  ctx.lineTo(30 * s, 18 * s);
  ctx.lineTo(29 * s, 20 * s);
  ctx.lineTo(18 * s, 16 * s);
  ctx.lineTo(14 * s, 16 * s);
  ctx.lineTo(3 * s, 20 * s);
  ctx.lineTo(2 * s, 18 * s);
  ctx.closePath();
  ctx.fill();
  // Tail fins
  ctx.beginPath();
  ctx.moveTo(16 * s, 25 * s);
  ctx.lineTo(22 * s, 29 * s);
  ctx.lineTo(21 * s, 30 * s);
  ctx.lineTo(16 * s, 27 * s);
  ctx.lineTo(11 * s, 30 * s);
  ctx.lineTo(10 * s, 29 * s);
  ctx.closePath();
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

/** Build dotted network lines connecting nearby bikeshare stations */
function buildBikeNetworkLines(
  stations: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const coords = stations.features
    .filter((f) => f.geometry.type === "Point")
    .map((f) => (f.geometry as GeoJSON.Point).coordinates);

  const MAX_DIST = 0.02; // ~2km in degrees
  const K = 2;
  const edgeSet = new Set<string>();
  const lines: GeoJSON.Feature[] = [];

  for (let i = 0; i < coords.length; i++) {
    // Find K nearest within MAX_DIST
    const dists: { j: number; d: number }[] = [];
    for (let j = 0; j < coords.length; j++) {
      if (i === j) continue;
      const dx = coords[i][0] - coords[j][0];
      const dy = coords[i][1] - coords[j][1];
      const d = dx * dx + dy * dy;
      if (d < MAX_DIST * MAX_DIST) {
        dists.push({ j, d });
      }
    }
    dists.sort((a, b) => a.d - b.d);

    for (let k = 0; k < Math.min(K, dists.length); k++) {
      const j = dists[k].j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      lines.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [coords[i], coords[j]],
        },
        properties: {},
      });
    }
  }

  return { type: "FeatureCollection", features: lines };
}

/** Build dotted network lines connecting transit stops on the same route */
function buildTransitNetworkLines(
  stops: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  // Group stops by route
  const routeStops = new Map<string, [number, number][]>();
  for (const f of stops.features) {
    if (f.geometry.type !== "Point") continue;
    const route = (f.properties?.route ?? "") as string;
    if (!route) continue;
    const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    if (!routeStops.has(route)) routeStops.set(route, []);
    routeStops.get(route)!.push(coords);
  }

  const lines: GeoJSON.Feature[] = [];

  for (const [route, coords] of routeStops) {
    if (coords.length < 2) continue;

    // Sort stops geographically (by longitude, then latitude) to approximate route order
    coords.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    // Greedy nearest-neighbor chain to connect stops in route order
    const ordered: [number, number][] = [coords[0]];
    const used = new Set<number>([0]);
    for (let i = 1; i < coords.length; i++) {
      const last = ordered[ordered.length - 1];
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let j = 0; j < coords.length; j++) {
        if (used.has(j)) continue;
        const dx = coords[j][0] - last[0];
        const dy = coords[j][1] - last[1];
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = j;
        }
      }
      if (bestIdx >= 0) {
        used.add(bestIdx);
        ordered.push(coords[bestIdx]);
      }
    }

    // Get route color from first stop
    const color = stops.features.find(
      (f) => f.properties?.route === route
    )?.properties?.color ?? "#a78bfa";

    // Create line segments between consecutive ordered stops
    for (let i = 0; i < ordered.length - 1; i++) {
      lines.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [ordered[i], ordered[i + 1]],
        },
        properties: { route, color },
      });
    }
  }

  return { type: "FeatureCollection", features: lines };
}

interface WeatherInfo {
  tempF: number;
  aqi: number;
  aqiLabel: string;
}

export default function CityMap({ city }: CityMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [aircraftCount, setAircraftCount] = useState<number | null>(null);
  const [vesselCount, setVesselCount] = useState<number | null>(null);
  const [earthquakeCount, setEarthquakeCount] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [localTime, setLocalTime] = useState(() => getLocalTimeWithSeconds(city.timezone));
  const [bikeStationCount, setBikeStationCount] = useState<number | null>(null);
  const [transitStopCount, setTransitStopCount] = useState<number | null>(null);
  const [poiCount, setPoiCount] = useState<number | null>(null);
  const [activePoiCount, setActivePoiCount] = useState<number | null>(null);
  const [avgActivity, setAvgActivity] = useState<number | null>(null);
  const initialFetchDone = useRef(false);

  // ── Filter state ──────────────────────────────────────────────
  const availableFilters = useMemo(() => getAvailableFilters(city), [city]);
  const [filters, setFilters] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(availableFilters.map((f) => [f.key, true]))
  );

  const toggleFilter = useCallback(
    (key: string) => {
      setFilters((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        const m = mapRef.current;
        if (m) {
          const def = availableFilters.find((f) => f.key === key);
          if (def) {
            const vis = next[key] ? "visible" : "none";
            for (const layerId of def.layerIds) {
              if (m.getLayer(layerId)) {
                m.setLayoutProperty(layerId, "visibility", vis);
              }
            }
          }
        }
        return next;
      });
    },
    [availableFilters],
  );

  // ── Waze data ───────────────────────────────────────────────────

  const fetchWazeData = useCallback(async () => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/waze/${city.slug}`);
      if (!res.ok) return;
      const geojson = await res.json();

      setReportCount(geojson.features?.length ?? 0);

      const m = mapRef.current;
      if (!m) return;

      const src = m.getSource("waze") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);
    } catch (err) {
      console.error("[CityMap] waze fetch error:", err);
    } finally {
      setUpdating(false);
    }
  }, [city.slug]);

  // ── Bike share data ─────────────────────────────────────────────

  const fetchBikeData = useCallback(async () => {
    if (!city.bikeNetwork) return;
    try {
      const res = await fetch(`/api/bikeshare/${city.slug}`);
      if (!res.ok) return;
      const geojson = await res.json();

      const m = mapRef.current;
      if (!m) return;

      setBikeStationCount(geojson.features?.length ?? 0);

      const src = m.getSource("bikeshare") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);

      // Compute and set network lines
      const networkSrc = m.getSource("bikeshare-network") as maplibregl.GeoJSONSource | undefined;
      if (networkSrc) networkSrc.setData(buildBikeNetworkLines(geojson));
    } catch (err) {
      console.error("[CityMap] bikeshare fetch error:", err);
    }
  }, [city.slug, city.bikeNetwork]);

  // ── Transit data ────────────────────────────────────────────────

  const fetchTransitData = useCallback(async () => {
    if (!city.transitType) return;
    try {
      const res = await fetch(`/api/transit/${city.slug}`);
      if (!res.ok) return;
      const geojson = await res.json();

      const m = mapRef.current;
      if (!m) return;

      setTransitStopCount(geojson.features?.length ?? 0);

      const src = m.getSource("transit") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);

      // Compute and set transit network lines
      const networkSrc = m.getSource("transit-network") as maplibregl.GeoJSONSource | undefined;
      if (networkSrc) networkSrc.setData(buildTransitNetworkLines(geojson));
    } catch (err) {
      console.error("[CityMap] transit fetch error:", err);
    }
  }, [city.slug, city.transitType]);

  // ── Weather data ────────────────────────────────────────────────

  const fetchWeatherInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/weather/${city.slug}`);
      if (!res.ok) return;
      const data = await res.json();
      setWeather({ tempF: data.tempF, aqi: data.aqi, aqiLabel: data.aqiLabel });
    } catch (err) {
      console.error("[CityMap] weather fetch error:", err);
    }
  }, [city.slug]);

  // ── Aircraft data ───────────────────────────────────────────────

  const fetchAircraftData = useCallback(async () => {
    try {
      const res = await fetch(`/api/opensky/${city.slug}`);
      if (!res.ok) return;
      const geojson = await res.json();

      setAircraftCount(geojson.features?.length ?? 0);

      const m = mapRef.current;
      if (!m) return;

      const src = m.getSource("aircraft") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);
    } catch (err) {
      console.error("[CityMap] aircraft fetch error:", err);
    }
  }, [city.slug]);

  // ── Maritime data ──────────────────────────────────────────────

  const fetchMaritimeData = useCallback(async () => {
    if (!city.isCoastal) return;
    try {
      const res = await fetch(`/api/maritime/${city.slug}`);
      if (!res.ok) return;
      const geojson = await res.json();

      setVesselCount(geojson.features?.length ?? 0);

      const m = mapRef.current;
      if (!m) return;

      const src = m.getSource("maritime") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);
    } catch (err) {
      console.error("[CityMap] maritime fetch error:", err);
    }
  }, [city.slug, city.isCoastal]);

  // ── Earthquake data ──────────────────────────────────────────

  const fetchEarthquakeData = useCallback(async () => {
    try {
      const res = await fetch(`/api/earthquakes/${city.slug}`);
      if (!res.ok) return;
      const geojson = await res.json();

      setEarthquakeCount(geojson.features?.length ?? 0);

      const m = mapRef.current;
      if (!m) return;

      const src = m.getSource("earthquakes") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);
    } catch (err) {
      console.error("[CityMap] earthquake fetch error:", err);
    }
  }, [city.slug]);

  // ── POI + popularity data (5-minute refresh) ──────────────────

  const fetchPOIData = useCallback(async () => {
    try {
      const res = await fetch(`/api/popularity/${city.slug}`);
      if (!res.ok) return;
      const geojson = await res.json();

      const m = mapRef.current;
      if (!m) return;

      const features = geojson.features ?? [];
      setPoiCount(features.length);

      // Compute sidebar metrics
      let openCount = 0;
      let activitySum = 0;
      for (const f of features) {
        if (f.properties?.isOpen) openCount++;
        activitySum += f.properties?.activity ?? 0;
      }
      setActivePoiCount(openCount);
      setAvgActivity(features.length > 0 ? Math.round(activitySum / features.length) : 0);

      const src = m.getSource("pois") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);
    } catch (err) {
      console.error("[CityMap] popularity fetch error:", err);
    }
  }, [city.slug]);

  // ── Initialize map ──────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    mapRef.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [city.lng, city.lat],
      zoom: city.mapZoom,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    mapRef.current.addControl(
      new maplibregl.NavigationControl({ showCompass: true }),
      "bottom-right"
    );

    mapRef.current.on("load", () => setMapLoaded(true));

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [city.lat, city.lng, city.mapZoom]);

  // ── Pre-create all sources + layers on map load ────────────────

  useEffect(() => {
    if (!mapLoaded) return;
    const m = mapRef.current;
    if (!m) return;

    // Compute yesterday's date for GIBS tiles
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const gibsDate = yesterday.toISOString().split("T")[0];

    // ── Satellite raster (bottom of stack) ──
    m.addSource("gibs-satellite", {
      type: "raster",
      tiles: [
        `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${gibsDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      ],
      tileSize: 256,
      maxzoom: 9,
    });
    m.addLayer({
      id: "gibs-satellite",
      type: "raster",
      source: "gibs-satellite",
      paint: {
        "raster-opacity": 0.15,
        "raster-brightness-max": 0.6,
      },
    });

    // ── Register SDF airplane icon ──
    m.addImage("airplane", createAirplaneIcon(32), { sdf: true });

    // ── GeoJSON sources (all start empty) ──
    m.addSource("pois", { type: "geojson", data: EMPTY_FC });
    m.addSource("aircraft", { type: "geojson", data: EMPTY_FC });
    m.addSource("bikeshare", { type: "geojson", data: EMPTY_FC });
    m.addSource("bikeshare-network", { type: "geojson", data: EMPTY_FC });
    m.addSource("transit", { type: "geojson", data: EMPTY_FC });
    m.addSource("transit-network", { type: "geojson", data: EMPTY_FC });
    m.addSource("waze", { type: "geojson", data: EMPTY_FC });
    m.addSource("maritime", { type: "geojson", data: EMPTY_FC });
    m.addSource("earthquakes", { type: "geojson", data: EMPTY_FC });

    // ── Layers (bottom → top) — uniform color palette ──

    // POIs aura glow: soft expanding ring behind busy venues (minzoom 9)
    m.addLayer({
      id: "pois-aura",
      type: "circle",
      source: "pois",
      minzoom: 9,
      filter: [">", ["coalesce", ["get", "activity"], 0], 20],
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["coalesce", ["get", "activity"], 0],
          20, 4,
          50, 10,
          80, 14,
          100, 18,
        ],
        "circle-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "activity"], 0],
          20, "rgba(251, 191, 36, 0.08)",
          60, "rgba(251, 191, 36, 0.15)",
          80, "rgba(245, 158, 11, 0.20)",
          100, "rgba(239, 68, 68, 0.25)",
        ],
        "circle-blur": 1,
        "circle-opacity": 0.8,
      },
    });

    // POIs: data-driven circles — size, color, opacity from activity (minzoom 9)
    m.addLayer({
      id: "pois",
      type: "circle",
      source: "pois",
      minzoom: 9,
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["coalesce", ["get", "activity"], 0],
          0, 2,
          25, 3,
          50, 4.5,
          75, 6,
          100, 7,
        ],
        "circle-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "activity"], 0],
          0, "#52525b",
          20, "#71717a",
          40, "#fbbf24",
          70, "#f59e0b",
          90, "#ef4444",
        ],
        "circle-opacity": [
          "interpolate", ["linear"], ["coalesce", ["get", "activity"], 0],
          0, 0.4,
          50, 0.65,
          100, 0.9,
        ],
      },
    });

    // POI labels (minzoom 11)
    m.addLayer({
      id: "pois-labels",
      type: "symbol",
      source: "pois",
      minzoom: 11,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-max-width": 10,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#000000",
        "text-halo-width": 1.5,
        "text-opacity": 0.8,
      },
    });

    // Bikeshare network lines: dotted lime (minzoom 12)
    m.addLayer({
      id: "bikeshare-network",
      type: "line",
      source: "bikeshare-network",
      minzoom: 12,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-dasharray": [2, 4],
        "line-color": "#a3e635",
        "line-opacity": 0.25,
        "line-width": 1,
      },
    });

    // Bikeshare stations: lime circles (minzoom 10)
    m.addLayer({
      id: "bikeshare",
      type: "circle",
      source: "bikeshare",
      minzoom: 10,
      paint: {
        "circle-radius": 3,
        "circle-color": "#a3e635",
        "circle-opacity": 0.7,
      },
    });

    // Transit network lines: dotted, colored by route (minzoom 9)
    m.addLayer({
      id: "transit-network",
      type: "line",
      source: "transit-network",
      minzoom: 9,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-dasharray": [2, 4],
        "line-color": ["coalesce", ["get", "color"], "#a78bfa"],
        "line-opacity": 0.35,
        "line-width": 1.5,
      },
    });

    // Transit: violet circles with white stroke (minzoom 9)
    m.addLayer({
      id: "transit",
      type: "circle",
      source: "transit",
      minzoom: 9,
      paint: {
        "circle-radius": 2.5,
        "circle-color": "#a78bfa",
        "circle-opacity": 0.9,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.2,
      },
    });

    // Waze jams: red lines (always visible)
    m.addLayer({
      id: "waze-jams",
      type: "line",
      source: "waze",
      filter: ["==", ["geometry-type"], "LineString"],
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#ef4444",
        "line-width": 2.5,
        "line-opacity": 0.8,
      },
    });

    // Waze reports: amber circles (minzoom 10)
    m.addLayer({
      id: "waze-reports",
      type: "circle",
      source: "waze",
      minzoom: 10,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 3.5,
        "circle-color": "#f59e0b",
        "circle-opacity": 0.75,
        "circle-stroke-width": 0.5,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.15,
      },
    });

    // Maritime: blue circles sized by vessel type
    m.addLayer({
      id: "maritime",
      type: "circle",
      source: "maritime",
      paint: {
        "circle-radius": ["match", ["get", "shipCategory"],
          "cargo", 5, "tanker", 5, "passenger", 4,
          "fishing", 2.5, "pleasure", 2, 3],
        "circle-color": "#0ea5e9",
        "circle-opacity": 0.7,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.3,
      },
    });

    // Earthquakes glow: soft red aura behind quakes
    m.addLayer({
      id: "earthquakes-glow",
      type: "circle",
      source: "earthquakes",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["coalesce", ["get", "mag"], 2],
          2, 6, 3, 8, 4, 11, 5, 16, 6, 22, 7, 28,
        ],
        "circle-color": "rgba(239, 68, 68, 0.3)",
        "circle-blur": 1,
        "circle-opacity": 0.3,
      },
    });

    // Earthquakes: circles sized and colored by magnitude
    m.addLayer({
      id: "earthquakes",
      type: "circle",
      source: "earthquakes",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["coalesce", ["get", "mag"], 2],
          2, 3, 3, 4, 4, 5.5, 5, 8, 6, 11, 7, 14,
        ],
        "circle-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "mag"], 2],
          2, "#fbbf24", 4, "#f97316", 6, "#ef4444",
        ],
        "circle-opacity": 0.85,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.2,
      },
    });

    // Earthquake labels: magnitude + place (minzoom 8)
    m.addLayer({
      id: "earthquakes-labels",
      type: "symbol",
      source: "earthquakes",
      minzoom: 8,
      layout: {
        "text-field": ["concat", ["to-string", ["get", "mag"]], " — ", ["get", "place"]],
        "text-size": 10,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-max-width": 14,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#000000",
        "text-halo-width": 1.5,
        "text-opacity": 0.7,
      },
    });

    // Aircraft: cyan airplane icons rotated by heading (always visible)
    m.addLayer({
      id: "aircraft",
      type: "symbol",
      source: "aircraft",
      layout: {
        "icon-image": "airplane",
        "icon-rotate": ["get", "heading"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": 0.55,
      },
      paint: {
        "icon-color": "#22d3ee",
        "icon-halo-color": "#083344",
        "icon-halo-width": 1,
      },
    });
  }, [mapLoaded]);

  // ── Coordinated initial data fetch ────────────────────────────
  // Runs all initial fetches in parallel, signals ready when done.

  useEffect(() => {
    if (!mapLoaded || initialFetchDone.current) return;
    initialFetchDone.current = true;

    const fetches: Promise<void>[] = [
      fetchWazeData(),
      fetchWeatherInfo(),
      fetchPOIData(),
      fetchAircraftData(),
      fetchEarthquakeData(),
    ];
    if (city.bikeNetwork) fetches.push(fetchBikeData());
    if (city.transitType) fetches.push(fetchTransitData());
    if (city.isCoastal) fetches.push(fetchMaritimeData());

    Promise.allSettled(fetches).then(() => {
      window.dispatchEvent(
        new CustomEvent("city-data-ready", { detail: { slug: city.slug } })
      );
    });
  }, [mapLoaded, city.slug, city.bikeNetwork, city.transitType, city.isCoastal, fetchWazeData, fetchWeatherInfo, fetchPOIData, fetchBikeData, fetchTransitData, fetchAircraftData, fetchMaritimeData, fetchEarthquakeData]);

  // ── Refresh intervals (no initial call — coordinated effect handles it) ──

  useEffect(() => {
    if (!mapLoaded) return;
    const id = setInterval(fetchWazeData, WAZE_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchWazeData]);

  useEffect(() => {
    if (!mapLoaded || !city.bikeNetwork) return;
    const id = setInterval(fetchBikeData, BIKESHARE_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchBikeData, city.bikeNetwork]);

  useEffect(() => {
    if (!mapLoaded || !city.transitType) return;
    const id = setInterval(fetchTransitData, TRANSIT_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchTransitData, city.transitType]);

  useEffect(() => {
    if (!mapLoaded) return;
    const id = setInterval(fetchWeatherInfo, WEATHER_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchWeatherInfo]);

  useEffect(() => {
    if (!mapLoaded) return;
    const id = setInterval(fetchAircraftData, AIRCRAFT_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchAircraftData]);

  useEffect(() => {
    if (!mapLoaded || !city.isCoastal) return;
    const id = setInterval(fetchMaritimeData, MARITIME_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchMaritimeData, city.isCoastal]);

  useEffect(() => {
    if (!mapLoaded) return;
    const id = setInterval(fetchEarthquakeData, EARTHQUAKE_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchEarthquakeData]);

  // POI popularity refresh (5 minutes)
  useEffect(() => {
    if (!mapLoaded) return;
    const id = setInterval(fetchPOIData, POI_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchPOIData]);

  // ── Live clock (updates every second) ──
  useEffect(() => {
    const id = setInterval(() => {
      setLocalTime(getLocalTimeWithSeconds(city.timezone));
    }, 1000);
    return () => clearInterval(id);
  }, [city.timezone]);

  return (
    <>
      {/* Map container — inline styles because MapLibre overrides CSS position */}
      <div
        ref={mapContainer}
        style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh" }}
      />

      <CitySidebar
        city={city}
        localTime={localTime}
        weather={weather}
        reportCount={reportCount}
        aircraftCount={aircraftCount}
        vesselCount={vesselCount}
        earthquakeCount={earthquakeCount}
        bikeStationCount={bikeStationCount}
        transitStopCount={transitStopCount}
        poiCount={poiCount}
        activePoiCount={activePoiCount}
        avgActivity={avgActivity}
        updating={updating}
      />

      <CityFilterBar
        filters={filters}
        availableFilters={availableFilters}
        onToggle={toggleFilter}
      />
    </>
  );
}
