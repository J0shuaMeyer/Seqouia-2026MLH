"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSunPosition } from "@/hooks/useSunPosition";
import { useActivityData } from "@/hooks/useActivityData";

interface GlobeDataContextValue {
  sunPosition: { lat: number; lng: number };
  activityMap: Record<string, number>;
}

const GlobeDataContext = createContext<GlobeDataContextValue>({
  sunPosition: { lat: 0, lng: 0 },
  activityMap: {},
});

export function GlobeDataProvider({ children }: { children: ReactNode }) {
  const sunPosition = useSunPosition();
  const activityMap = useActivityData();

  return (
    <GlobeDataContext.Provider value={{ sunPosition, activityMap }}>
      {children}
    </GlobeDataContext.Provider>
  );
}

export function useGlobeData() {
  return useContext(GlobeDataContext);
}
