"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cities } from "@/data/cities";
import { useGlobeData } from "@/context/GlobeDataContext";
import { getLocalTime } from "@/lib/activity";
import SequoiaLogo from "@/components/SequoiaLogo";

export default function Sidebar() {
  const { activityMap } = useGlobeData();
  const pathname = usePathname();
  const activeSlug = pathname.startsWith("/city/") ? pathname.split("/")[2] : null;

  const sortedCities = useMemo(() => {
    return [...cities].sort((a, b) => {
      const actA = activityMap[a.slug] ?? 0;
      const actB = activityMap[b.slug] ?? 0;
      return actB - actA;
    });
  }, [activityMap]);

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 z-50 bg-black/80 backdrop-blur-md border-r border-white/[0.06] flex flex-col">
      {/* Header */}
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

      {/* City list */}
      <nav className="flex-1 overflow-y-auto py-1">
        {sortedCities.map((city) => {
          const activity = activityMap[city.slug] ?? 0;
          const pct = Math.round(activity * 100);
          const localTime = getLocalTime(city.timezone);
          const isActive = city.slug === activeSlug;

          // Square-root curve: gentler fade at the bottom, still clear gradient at top
          // 10% activity → 0.54 opacity, 50% → 0.69, 90% → 0.78
          const nameOpacity = 0.42 + Math.sqrt(activity) * 0.38;

          if (isActive) {
            return (
              <Link
                key={city.slug}
                href={`/city/${city.slug}`}
                className="relative block px-5 py-[9px] bg-white transition-all duration-200"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-black truncate">
                    {city.name}
                  </span>
                  <div className="flex items-center gap-3 ml-3 shrink-0">
                    <span className="text-[11px] font-semibold text-black/70 tabular-nums">
                      {pct}%
                    </span>
                    <span className="text-[10px] text-black/40 tabular-nums">
                      {localTime}
                    </span>
                  </div>
                </div>
              </Link>
            );
          }

          return (
            <Link
              key={city.slug}
              href={`/city/${city.slug}`}
              className="group relative block px-5 py-[9px] hover:bg-white/[0.04] transition-all duration-200"
            >
              {/* Activity fill — subtle background bar from left edge */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-white/[0.04] group-hover:bg-white/[0.07] transition-all duration-200"
                style={{ width: `${pct}%` }}
              />

              {/* Content */}
              <div className="relative flex items-center justify-between">
                <span
                  className="text-[13px] font-medium truncate group-hover:!opacity-90 transition-opacity duration-200"
                  style={{ opacity: nameOpacity }}
                >
                  {city.name}
                </span>
                <div className="flex items-center gap-3 ml-3 shrink-0">
                  <span
                    className="text-[11px] font-medium tabular-nums transition-opacity duration-200"
                    style={{ opacity: Math.max(0.30, nameOpacity - 0.10) }}
                  >
                    {pct}%
                  </span>
                  <span className="text-[10px] text-white/25 group-hover:text-white/40 transition-colors duration-200 tabular-nums">
                    {localTime}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
