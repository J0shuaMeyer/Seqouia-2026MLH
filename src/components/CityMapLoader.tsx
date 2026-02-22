"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { City } from "@/data/cities";
import SequoiaLogo from "@/components/SequoiaLogo";

const CityMap = dynamic(() => import("@/components/CityMap"), {
  ssr: false,
  loading: () => null,
});

export default function CityMapLoader({ city }: { city: City }) {
  const [ready, setReady] = useState(false);
  const onMapReady = useCallback(() => setReady(true), []);

  return (
    <>
      {!ready && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-black gap-4">
          <div className="flex items-center gap-3">
            <SequoiaLogo className="w-4 h-5 text-white/70" />
            <span className="text-lg font-semibold tracking-[0.25em] text-white/90">
              SEQUOIA
            </span>
            <span className="text-white/20">|</span>
            <span className="text-lg font-medium text-white/60">
              {city.name}, {city.countryCode}
            </span>
          </div>
          <p className="text-white/30 text-xs tracking-widest uppercase">
            Loading map...
          </p>
        </div>
      )}
      <CityMap city={city} onMapReady={onMapReady} />
    </>
  );
}
