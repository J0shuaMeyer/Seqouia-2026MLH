"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useSunPosition } from "@/hooks/useSunPosition";
import { useActivityData } from "@/hooks/useActivityData";

interface GlobeDataContextValue {
  sunPosition: { lat: number; lng: number };
  activityMap: Record<string, number>;
  /** Activity API has responded at least once */
  dataLoaded: boolean;
  /** Three.js globe scene is initialized */
  globeReady: boolean;
  /** Called by GlobeView when the scene is ready */
  setGlobeReady: () => void;
}

const GlobeDataContext = createContext<GlobeDataContextValue>({
  sunPosition: { lat: 0, lng: 0 },
  activityMap: {},
  dataLoaded: false,
  globeReady: false,
  setGlobeReady: () => {},
});

export function GlobeDataProvider({ children }: { children: ReactNode }) {
  const sunPosition = useSunPosition();
  const { activityMap, loaded } = useActivityData();
  const [globeReady, setGlobeReadyState] = useState(false);

  const setGlobeReady = useCallback(() => setGlobeReadyState(true), []);

  return (
    <GlobeDataContext.Provider
      value={{ sunPosition, activityMap, dataLoaded: loaded, globeReady, setGlobeReady }}
    >
      {children}
    </GlobeDataContext.Provider>
  );
}

export function useGlobeData() {
  return useContext(GlobeDataContext);
}
