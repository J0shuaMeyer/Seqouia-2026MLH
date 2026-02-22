"use client";

import Link from "next/link";
import type { City } from "@/data/cities";
import SequoiaLogo from "@/components/SequoiaLogo";

interface WeatherInfo {
  tempF: number;
  aqi: number;
  aqiLabel: string;
}

interface CitySidebarProps {
  city: City;
  localTime: string;
  weather: WeatherInfo | null;
  reportCount: number | null;
  aircraftCount: number | null;
  bikeStationCount: number | null;
  transitStopCount: number | null;
  poiCount: number | null;
  updating: boolean;
}

function aqiColor(aqi: number): string {
  if (aqi <= 50) return "text-green-400";
  if (aqi <= 100) return "text-yellow-400";
  if (aqi <= 150) return "text-orange-400";
  return "text-red-400";
}

export default function CitySidebar({
  city,
  localTime,
  weather,
  reportCount,
  aircraftCount,
  bikeStationCount,
  transitStopCount,
  poiCount,
  updating,
}: CitySidebarProps) {
  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 z-50 bg-black/80 backdrop-blur-md border-r border-white/[0.06] flex flex-col">
      {/* Section 1 — Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <SequoiaLogo className="w-3.5 h-[18px] text-white/70" />
          <h1 className="text-lg font-semibold tracking-[0.25em] text-white/90">
            SEQUOIA
          </h1>
        </div>
        <p className="text-[10px] text-white/30 mt-1.5 tracking-widest uppercase font-medium">
          Urban Activity Monitor
        </p>
      </div>

      {/* Section 2 — City Identity */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <h2 className="text-xl font-bold text-white">{city.name}</h2>
        <p className="text-xs text-white/50 mt-0.5">{city.country}</p>
        <p className="text-xs text-white/30 italic font-light mt-1">
          &ldquo;{city.tagline}&rdquo;
        </p>
        <p className="text-lg font-light text-white/80 tabular-nums mt-2">
          {localTime}
        </p>
      </div>

      {/* Section 3 — Weather */}
      {weather && (
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <p className="text-[10px] tracking-widest uppercase text-white/30 mb-2">
            Weather
          </p>
          <p className="text-2xl font-light text-white/90">{weather.tempF}°F</p>
          <p className={`text-xs mt-1 ${aqiColor(weather.aqi)}`}>
            AQI {weather.aqi} &middot; {weather.aqiLabel}
          </p>
        </div>
      )}

      {/* Section 4 — Live Data */}
      <div className="px-5 py-4 border-b border-white/[0.06] space-y-1.5">
        <p className="text-[10px] tracking-widest uppercase text-white/30 mb-2">
          Live Data{updating && <span className="ml-2 text-white/20">updating…</span>}
        </p>
        <div className="flex justify-between">
          <span className="text-xs text-white/40">Traffic Reports</span>
          <span className="text-xs text-white/60 tabular-nums">
            {reportCount !== null ? reportCount.toLocaleString() : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-white/40">Aircraft</span>
          <span className="text-xs text-white/60 tabular-nums">
            {aircraftCount !== null ? aircraftCount.toLocaleString() : "—"}
          </span>
        </div>
        {city.bikeNetwork && (
          <div className="flex justify-between">
            <span className="text-xs text-white/40">Bike Stations</span>
            <span className="text-xs text-white/60 tabular-nums">
              {bikeStationCount !== null ? bikeStationCount.toLocaleString() : "—"}
            </span>
          </div>
        )}
        {city.transitType && (
          <div className="flex justify-between">
            <span className="text-xs text-white/40">Transit Stops</span>
            <span className="text-xs text-white/60 tabular-nums">
              {transitStopCount !== null ? transitStopCount.toLocaleString() : "—"}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-xs text-white/40">Points of Interest</span>
          <span className="text-xs text-white/60 tabular-nums">
            {poiCount !== null ? poiCount.toLocaleString() : "—"}
          </span>
        </div>
      </div>

      {/* Section 5 — Footer */}
      <div className="mt-auto px-5 py-4">
        <Link
          href="/"
          className="text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          &larr; Back to Globe
        </Link>
      </div>
    </aside>
  );
}
