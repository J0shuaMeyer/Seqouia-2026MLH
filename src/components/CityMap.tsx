"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { City } from "@/data/cities";

interface CityMapProps {
  city: City;
}

const REFRESH_INTERVAL_MS = 120_000; // 2 minutes

// Alert type → color
const ALERT_COLORS: [string, string][] = [
  ["ACCIDENT", "#ef4444"],        // red
  ["JAM", "#f97316"],             // orange
  ["WEATHERHAZARD", "#eab308"],   // yellow
  ["ROAD_CLOSED", "#6b7280"],     // gray
  ["POLICE", "#3b82f6"],          // blue
];
const ALERT_COLOR_DEFAULT = "#9ca3af"; // gray-400

// Jam level → color (0=free flow … 5=blocked)
const JAM_COLORS: [number, string][] = [
  [0, "#22c55e"],   // green
  [1, "#84cc16"],   // lime
  [2, "#eab308"],   // yellow
  [3, "#f97316"],   // orange
  [4, "#ef4444"],   // red
  [5, "#991b1b"],   // dark red
];

export default function CityMap({ city }: CityMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [alertCount, setAlertCount] = useState<number | null>(null);
  const [jamCount, setJamCount] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);

  const fetchWazeData = useCallback(async () => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/waze/${city.slug}`);
      if (!res.ok) return;
      const geojson = await res.json();

      // Count alerts and jams
      let alerts = 0;
      let jams = 0;
      for (const f of geojson.features ?? []) {
        if (f.properties?.kind === "alert") alerts++;
        else if (f.properties?.kind === "jam") jams++;
      }
      setAlertCount(alerts);
      setJamCount(jams);

      // Update or add the MapLibre source
      const m = mapRef.current;
      if (!m) return;

      const src = m.getSource("waze") as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(geojson);
      } else {
        m.addSource("waze", { type: "geojson", data: geojson });
        addWazeLayers(m);
      }
    } catch (err) {
      console.error("[CityMap] waze fetch error:", err);
    } finally {
      setUpdating(false);
    }
  }, [city.slug]);

  // Initialize map
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

  // Fetch Waze data once map is loaded, then refresh every 2 min
  useEffect(() => {
    if (!mapLoaded) return;

    fetchWazeData();
    const id = setInterval(fetchWazeData, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [mapLoaded, fetchWazeData]);

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
          <p className="text-xs text-white/40 mt-1">
            {alertCount === null
              ? "Loading traffic data…"
              : updating
                ? "Updating…"
                : `${alertCount} alerts · ${jamCount} jams`}
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

function addWazeLayers(m: maplibregl.Map) {
  // Circle layer for alerts (Point geometry)
  m.addLayer({
    id: "waze-alerts",
    type: "circle",
    source: "waze",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5,
      "circle-opacity": 0.8,
      "circle-color": [
        "match",
        ["get", "type"],
        ...ALERT_COLORS.flat(),
        ALERT_COLOR_DEFAULT,
      ] as unknown as maplibregl.ExpressionSpecification,
    },
  });

  // Line layer for jams (LineString geometry)
  m.addLayer({
    id: "waze-jams",
    type: "line",
    source: "waze",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-width": 3,
      "line-opacity": 0.7,
      "line-color": [
        "interpolate",
        ["linear"],
        ["get", "level"],
        ...JAM_COLORS.flat(),
      ] as unknown as maplibregl.ExpressionSpecification,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });
}
