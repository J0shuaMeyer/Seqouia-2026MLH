"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { City } from "@/data/cities";

interface CityMapProps {
  city: City;
}

const WAZE_REFRESH_MS = 120_000;    // 2 minutes
const BIKESHARE_REFRESH_MS = 60_000; // 1 minute
const TRANSIT_REFRESH_MS = 30_000;   // 30 seconds
const WEATHER_REFRESH_MS = 300_000;  // 5 minutes
const AIRCRAFT_REFRESH_MS = 30_000;  // 30 seconds

const REPORT_COLOR = "#e8853b";

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

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
  const [updating, setUpdating] = useState(false);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const initialFetchDone = useRef(false);

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

      const src = m.getSource("bikeshare") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);
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

      const src = m.getSource("transit") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);
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
    if (!city.airportBbox) return;
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
  }, [city.slug, city.airportBbox]);

  // ── POI data (one-time fetch) ─────────────────────────────────

  const fetchPOIData = useCallback(async () => {
    try {
      const res = await fetch(`/api/pois/${city.slug}`);
      if (!res.ok) return;
      const geojson = await res.json();

      const m = mapRef.current;
      if (!m) return;

      const src = m.getSource("pois") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);
    } catch (err) {
      console.error("[CityMap] pois fetch error:", err);
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

    // ── GeoJSON sources (all start empty) ──
    m.addSource("pois", { type: "geojson", data: EMPTY_FC });
    m.addSource("aircraft", { type: "geojson", data: EMPTY_FC });
    m.addSource("bikeshare", { type: "geojson", data: EMPTY_FC });
    m.addSource("transit", { type: "geojson", data: EMPTY_FC });
    m.addSource("waze", { type: "geojson", data: EMPTY_FC });

    // ── Layers in explicit order (bottom → top) ──

    // POIs: small circles colored by type
    m.addLayer({
      id: "pois",
      type: "circle",
      source: "pois",
      paint: {
        "circle-radius": 3,
        "circle-color": [
          "match", ["get", "poiType"],
          "airport", "#60a5fa",
          "seaport", "#38bdf8",
          "train_station", "#a78bfa",
          "stadium", "#34d399",
          "#888888",
        ],
        "circle-opacity": 0.6,
      },
    });

    // POI labels: visible at zoom 11+
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

    // Aircraft: circles colored by altitude (amber low → cyan high)
    m.addLayer({
      id: "aircraft",
      type: "circle",
      source: "aircraft",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          8, 2,
          16, 6,
        ],
        "circle-color": [
          "interpolate", ["linear"], ["get", "altitudeFt"],
          0, "#ff8c00",       // amber at low altitude
          10000, "#00d4ff",   // mid
          40000, "#00bfff",   // cyan at cruise
        ],
        "circle-opacity": 0.85,
      },
    });

    // Bike share: circles colored by flow (red losing → green stable → blue gaining)
    m.addLayer({
      id: "bikeshare",
      type: "circle",
      source: "bikeshare",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"],
          ["abs", ["coalesce", ["get", "netFlow"], 0]],
          0, 3,
          10, 7,
        ],
        "circle-color": [
          "case",
          // Has flow data (netFlow exists and is non-null)
          ["has", "netFlow"],
          [
            "interpolate", ["linear"], ["get", "netFlow"],
            -10, "#ef4444",   // red — losing bikes
            -3, "#f97316",    // orange
            0, "#22c55e",     // green — stable
            3, "#38bdf8",     // light blue
            10, "#3b82f6",    // blue — gaining bikes
          ],
          // No flow data yet — fall back to availability coloring
          [
            "case",
            [">", ["get", "availableBikes"], 0], "#22c55e",
            "#444444",
          ],
        ],
        "circle-opacity": 0.7,
      },
    });

    // Transit: colored by route
    m.addLayer({
      id: "transit",
      type: "circle",
      source: "transit",
      paint: {
        "circle-radius": 5,
        "circle-color": ["coalesce", ["get", "color"], "#888888"],
        "circle-opacity": 0.9,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.2,
      },
    });

    // Waze jams: lines
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
        "line-color": "#c23030",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          8, 1.5,
          12, 3,
          16, 5,
        ],
        "line-opacity": 0.8,
      },
    });

    // Waze reports: dots on top
    m.addLayer({
      id: "waze-reports",
      type: "circle",
      source: "waze",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 4,
        "circle-color": REPORT_COLOR,
        "circle-opacity": 0.75,
        "circle-stroke-width": 0.5,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.15,
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
    ];
    if (city.bikeNetwork) fetches.push(fetchBikeData());
    if (city.transitType) fetches.push(fetchTransitData());
    if (city.airportBbox) fetches.push(fetchAircraftData());

    Promise.allSettled(fetches).then(() => {
      window.dispatchEvent(
        new CustomEvent("city-data-ready", { detail: { slug: city.slug } })
      );
    });
  }, [mapLoaded, city.slug, city.bikeNetwork, city.transitType, city.airportBbox, fetchWazeData, fetchWeatherInfo, fetchPOIData, fetchBikeData, fetchTransitData, fetchAircraftData]);

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
    if (!mapLoaded || !city.airportBbox) return;
    const id = setInterval(fetchAircraftData, AIRCRAFT_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchAircraftData, city.airportBbox]);

  return (
    <>
      {/* Map container — inline styles because MapLibre overrides CSS position */}
      <div
        ref={mapContainer}
        style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh" }}
      />

      {/* City info overlay */}
      <div className="fixed top-4 left-4 z-10 pointer-events-none">
        <div className="bg-black/70 backdrop-blur-sm rounded-lg px-4 py-3 border border-white/10">
          <h2 className="text-xl font-bold text-white">{city.name}</h2>
          <p className="text-xs text-white/50 mt-0.5">
            {city.country} &middot; {city.timezone}
          </p>
          {weather && (
            <p className="text-xs text-white/50 mt-0.5">
              {weather.tempF}°F &middot; AQI {weather.aqi} {weather.aqiLabel}
            </p>
          )}
          <p className="text-xs text-white/40 mt-1">
            {reportCount === null
              ? "Loading reports…"
              : updating
                ? "Updating…"
                : `${reportCount.toLocaleString()} reports${aircraftCount && aircraftCount > 0 ? ` · ${aircraftCount} aircraft` : ""}`}
          </p>
        </div>
      </div>
    </>
  );
}
