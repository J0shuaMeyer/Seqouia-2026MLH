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

// Subtle warm orange — visible on dark basemap without being loud
const REPORT_COLOR = "#e8853b";

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
  const [updating, setUpdating] = useState(false);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);

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
      if (src) {
        src.setData(geojson);
      } else {
        m.addSource("waze", { type: "geojson", data: geojson });
        addJamLayer(m);     // lines first (below)
        addReportLayer(m);  // dots on top
      }
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
      if (src) {
        src.setData(geojson);
      } else {
        m.addSource("bikeshare", { type: "geojson", data: geojson });
        addBikeShareLayer(m);
      }
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
      if (src) {
        src.setData(geojson);
      } else {
        m.addSource("transit", { type: "geojson", data: geojson });
        addTransitLayer(m, city.transitType!);
      }
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

  // ── Data fetch intervals ────────────────────────────────────────

  // Waze: refresh every 2 min
  useEffect(() => {
    if (!mapLoaded) return;
    fetchWazeData();
    const id = setInterval(fetchWazeData, WAZE_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchWazeData]);

  // Bike share: refresh every 60s (only if city has bike network)
  useEffect(() => {
    if (!mapLoaded || !city.bikeNetwork) return;
    fetchBikeData();
    const id = setInterval(fetchBikeData, BIKESHARE_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchBikeData, city.bikeNetwork]);

  // Transit: refresh every 30s (only if city has transit)
  useEffect(() => {
    if (!mapLoaded || !city.transitType) return;
    fetchTransitData();
    const id = setInterval(fetchTransitData, TRANSIT_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchTransitData, city.transitType]);

  // Weather: refresh every 5 min (all cities)
  useEffect(() => {
    if (!mapLoaded) return;
    fetchWeatherInfo();
    const id = setInterval(fetchWeatherInfo, WEATHER_REFRESH_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchWeatherInfo]);

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
                : `${reportCount.toLocaleString()} reports`}
          </p>
        </div>
      </div>

      {!mapLoaded && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black">
          <p className="text-white/50 text-sm">Loading map...</p>
        </div>
      )}
    </>
  );
}

// ── MapLibre layer setup ──────────────────────────────────────────

// Layer order (bottom to top): bikeshare → transit → waze-jams → waze-reports

function addBikeShareLayer(m: maplibregl.Map) {
  m.addLayer({
    id: "bikeshare",
    type: "circle",
    source: "bikeshare",
    paint: {
      "circle-radius": 3,
      "circle-color": [
        "case",
        [">", ["get", "availableBikes"], 0], "#22c55e",  // green when available
        "#444444",  // dim gray when empty
      ],
      "circle-opacity": 0.7,
    },
  });
}

function addTransitLayer(m: maplibregl.Map, transitType: string) {
  if (transitType === "mta") {
    // MTA subway: colored by route using the color property from the API
    m.addLayer({
      id: "transit",
      type: "circle",
      source: "transit",
      paint: {
        "circle-radius": 5,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.9,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.2,
      },
    });
  } else if (transitType === "lametro") {
    // LA Metro: rail (gold, larger) vs bus (muted blue, smaller)
    m.addLayer({
      id: "transit",
      type: "circle",
      source: "transit",
      paint: {
        "circle-radius": [
          "case",
          ["==", ["get", "vehicleType"], "rail"], 5,
          3,
        ],
        "circle-color": [
          "case",
          ["==", ["get", "vehicleType"], "rail"], "#FDB813",  // LA Metro gold
          "#5B7FA5",  // muted blue for bus
        ],
        "circle-opacity": [
          "case",
          ["==", ["get", "vehicleType"], "rail"], 0.9,
          0.6,
        ],
        "circle-stroke-width": [
          "case",
          ["==", ["get", "vehicleType"], "rail"], 1,
          0,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.2,
      },
    });
  }
}

function addJamLayer(m: maplibregl.Map) {
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
}

function addReportLayer(m: maplibregl.Map) {
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
}
