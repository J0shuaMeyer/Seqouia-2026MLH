"use client";

import Link from "next/link";
import { cities } from "@/data/cities";
import { useGlobeData } from "@/context/GlobeDataContext";
import { isDaytime } from "@/lib/sun";
import { activityColor } from "@/lib/activity";

export default function Sidebar() {
  const { sunPosition, activityMap } = useGlobeData();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 z-50 bg-black/80 backdrop-blur-md border-r border-white/10 flex flex-col">
      <div className="p-5 border-b border-white/10">
        <h1 className="text-xl font-bold tracking-[0.3em] text-white">
          SEQUOIA
        </h1>
        <p className="text-[11px] text-white/40 mt-1 tracking-wide">
          Urban Activity Monitor
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {cities.map((city) => {
          const daytime = isDaytime(
            city.lat,
            city.lng,
            sunPosition.lat,
            sunPosition.lng
          );
          const activity = activityMap[city.slug] ?? 0;
          const dotColor = activityColor(activity);

          return (
            <Link
              key={city.slug}
              href={`/city/${city.slug}`}
              className="group flex items-center gap-3 px-5 py-3 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-all duration-200 hover:translate-x-1 border-l-2 border-transparent hover:border-amber-400/60"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0 transition-colors duration-200"
                style={{ backgroundColor: dotColor }}
              />
              <span className="truncate font-medium">{city.name}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="text-[11px]" title={daytime ? "Daytime" : "Nighttime"}>
                  {daytime ? "☀" : "☾"}
                </span>
                <span className="text-[10px] text-white/30">
                  {city.country}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
