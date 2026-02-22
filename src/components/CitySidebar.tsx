"use client";

import { useState } from "react";
import Link from "next/link";
import type { City } from "@/data/cities";
import type { UPIResult } from "@/lib/urban-pulse";
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
  pulse: UPIResult | null;
  reportCount: number | null;
  aircraftCount: number | null;
  vesselCount: number | null;
  earthquakeCount: number | null;
  bikeStationCount: number | null;
  transitStopCount: number | null;
  poiCount: number | null;
  activePoiCount: number | null;
  avgActivity: number | null;
  updating: boolean;
}

function aqiColor(aqi: number): string {
  if (aqi <= 50) return "text-green-400";
  if (aqi <= 100) return "text-yellow-400";
  if (aqi <= 150) return "text-orange-400";
  return "text-red-400";
}

function pulseColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  if (score >= 20) return "text-orange-400";
  return "text-white/60";
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-xs text-white/60 tabular-nums">{value}</span>
    </div>
  );
}

export default function CitySidebar({
  city,
  localTime,
  weather,
  pulse,
  reportCount,
  aircraftCount,
  vesselCount,
  earthquakeCount,
  bikeStationCount,
  transitStopCount,
  poiCount,
  activePoiCount,
  avgActivity,
  updating,
}: CitySidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const density = Math.round(city.population / city.areaSqMi).toLocaleString();

  // Weather damping display
  const weatherPenalty = pulse && pulse.damping < 0.95
    ? `-${Math.round((1 - pulse.damping) * 100)}%`
    : null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed left-4 top-4 z-50 px-3 py-2 bg-black/70 backdrop-blur-sm border border-white/20 rounded-full text-[10px] tracking-widest text-white/60 hover:bg-white/10 hover:text-white/80 transition-all"
      >
        SEQUOIA &rsaquo;
      </button>
    );
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 z-50 bg-black/80 backdrop-blur-md border-r border-white/[0.06] flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SequoiaLogo className="w-3.5 h-[18px] text-white/70" />
            <h1 className="text-lg font-semibold tracking-[0.25em] text-white/90">
              SEQUOIA
            </h1>
          </div>
          <button
            onClick={() => setCollapsed(true)}
            className="text-white/25 hover:text-white/60 transition-colors text-sm"
            title="Collapse panel"
          >
            &lsaquo;
          </button>
        </div>
      </div>

      {/* City Identity */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <h2 className="text-xl font-bold text-white">
          {city.name}, {city.countryCode}
        </h2>
        <p className="text-lg font-light text-white/80 tabular-nums mt-2">
          {localTime}
        </p>
      </div>

      {/* Urban Pulse */}
      {pulse && (
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <p className="text-[10px] tracking-widest uppercase text-white/50 font-bold mb-2">
            Urban Pulse
          </p>
          <p className={`text-2xl font-light ${pulseColor(pulse.score)}`}>
            {pulse.score}%
          </p>
          <div className="mt-2 space-y-1">
            <DataRow label="Baseline" value={`${pulse.baseline}%`} />
            <DataRow label="Signals" value={`${pulse.signalCount} active`} />
            {weatherPenalty && (
              <DataRow label="Weather" value={weatherPenalty} />
            )}
          </div>
        </div>
      )}

      {/* Weather */}
      {weather && (
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <p className="text-[10px] tracking-widest uppercase text-white/50 font-bold mb-2">
            Weather
          </p>
          <p className="text-2xl font-light text-white/90">{weather.tempF}°F</p>
          <p className={`text-xs mt-1 ${aqiColor(weather.aqi)}`}>
            AQI {weather.aqi} &middot; {weather.aqiLabel}
          </p>
        </div>
      )}

      {/* Live Data */}
      <div className="px-5 py-4 border-b border-white/[0.06] space-y-1.5">
        <p className="text-[10px] tracking-widest uppercase text-white/50 font-bold mb-2">
          Live Data{updating && <span className="ml-2 text-white/20 font-normal">updating…</span>}
        </p>
        <DataRow label="Traffic Reports" value={reportCount !== null ? reportCount.toLocaleString() : "—"} />
        <DataRow label="Aircraft" value={aircraftCount !== null ? aircraftCount.toLocaleString() : "—"} />
        <DataRow label="Earthquakes (24h)" value={earthquakeCount !== null ? earthquakeCount.toLocaleString() : "—"} />
        {city.isCoastal && (
          <DataRow label="Vessels" value={vesselCount !== null ? vesselCount.toLocaleString() : "—"} />
        )}
        {city.bikeNetwork && (
          <DataRow label="Bike Stations" value={bikeStationCount !== null ? bikeStationCount.toLocaleString() : "—"} />
        )}
        {city.transitType && (
          <DataRow label="Transit Stops" value={transitStopCount !== null ? transitStopCount.toLocaleString() : "—"} />
        )}
        <DataRow label="Points of Interest" value={poiCount !== null ? poiCount.toLocaleString() : "—"} />
        <DataRow label="Active Places" value={activePoiCount !== null && poiCount !== null ? `${activePoiCount} / ${poiCount}` : "—"} />
      </div>

      {/* City Profile */}
      <div className="px-5 py-4 border-b border-white/[0.06] space-y-1.5">
        <p className="text-[10px] tracking-widest uppercase text-white/50 font-bold mb-2">
          City Profile
        </p>
        <DataRow label="Population" value={city.population.toLocaleString()} />
        <DataRow label="Area" value={`${city.areaSqMi.toLocaleString()} mi\u00B2`} />
        <DataRow label="Density" value={`${density} / mi\u00B2`} />
      </div>

      {/* Mobility */}
      <div className="px-5 py-4 border-b border-white/[0.06] space-y-1.5">
        <p className="text-[10px] tracking-widest uppercase text-white/50 font-bold mb-2">
          Mobility
        </p>
        <DataRow label="Walk Score" value={`${city.walkScore} / 100`} />
        <DataRow label="Vehicles / 1,000" value={city.vehiclesPer1000.toLocaleString()} />
        <DataRow label="Avg Commute" value={`${city.avgCommuteMin} min`} />
      </div>

      {/* Footer */}
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
