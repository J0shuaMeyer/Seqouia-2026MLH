"use client";

import type { City } from "@/data/cities";

export interface FilterDefinition {
  key: string;
  label: string;
  icon: string;
  layerIds: string[];
  color: string;
  /** Return true if this filter should appear for the given city */
  available: (city: City) => boolean;
}

export const ALL_FILTERS: FilterDefinition[] = [
  { key: "traffic",   icon: "", label: "TRAFFIC",   layerIds: ["waze-jams", "waze-reports"],      color: "#f97316", available: () => true },
  { key: "bikes",     icon: "", label: "BIKES",     layerIds: ["bikeshare", "bikeshare-network"], color: "#a3e635", available: (c) => !!c.bikeNetwork },
  { key: "transit",   icon: "", label: "TRANSIT",   layerIds: ["transit", "transit-network"],     color: "#a78bfa", available: (c) => !!c.transitType },
  { key: "flights",   icon: "", label: "FLIGHTS",   layerIds: ["aircraft"],                       color: "#22d3ee", available: () => true },
  { key: "maritime",  icon: "", label: "MARITIME",  layerIds: ["maritime"],                       color: "#2dd4bf", available: (c) => !!c.isCoastal },
  { key: "quakes",    icon: "", label: "QUAKES",    layerIds: ["earthquakes", "earthquakes-glow", "earthquakes-labels"], color: "#ef4444", available: () => true },
  { key: "places",    icon: "", label: "POI'S",    layerIds: ["pois", "pois-labels", "pois-aura"], color: "#f472b6", available: () => true },
];

export function getAvailableFilters(city: City): FilterDefinition[] {
  return ALL_FILTERS.filter((f) => f.available(city));
}

interface CityFilterBarProps {
  filters: Record<string, boolean>;
  availableFilters: FilterDefinition[];
  onToggle: (key: string) => void;
}

export default function CityFilterBar({ filters, availableFilters, onToggle }: CityFilterBarProps) {
  return (
    <div
      className="fixed top-4 z-10 flex flex-nowrap gap-4 pointer-events-auto max-w-[calc(100vw-256px-2rem)]"
      style={{
        left: "calc(256px + (100vw - 256px) / 2)",
        transform: "translateX(-50%)",
      }}
    >
      {availableFilters.map((f) => {
        const active = filters[f.key] ?? true;
        return (
          <button
            key={f.key}
            onClick={() => onToggle(f.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full border text-[10px] tracking-widest font-medium transition-all duration-200 whitespace-nowrap flex items-center gap-1.5 ${
              active
                ? "bg-white/15 border-white/25 text-white"
                : "bg-white/[0.05] border-white/[0.08] text-white/40 hover:bg-white/[0.08] hover:text-white/55"
            }`}
          >
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0 transition-opacity duration-200"
              style={{ backgroundColor: f.color, opacity: active ? 1 : 0.35 }}
            />
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
