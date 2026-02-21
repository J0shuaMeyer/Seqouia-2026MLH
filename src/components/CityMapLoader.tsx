"use client";

import dynamic from "next/dynamic";
import type { City } from "@/data/cities";

const CityMap = dynamic(() => import("@/components/CityMap"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full w-full bg-black">
      <p className="text-white/50 text-sm">Loading map...</p>
    </div>
  ),
});

export default function CityMapLoader({ city }: { city: City }) {
  return <CityMap city={city} />;
}
