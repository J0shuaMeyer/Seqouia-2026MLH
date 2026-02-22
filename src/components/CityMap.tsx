"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { City } from "@/data/cities";

interface CityMapProps {
  city: City;
}

const REFRESH_INTERVAL_MS = 120_000; // 2 minutes

// Subtle warm orange — visible on dark basemap without being loud
const REPORT_COLOR = "#e8853b";

export default function CityMap({ city }: CityMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);

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
