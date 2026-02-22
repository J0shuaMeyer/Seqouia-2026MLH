"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  json2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from "satellite.js";
import type { SatRec } from "satellite.js";

interface SatPosition {
  lat: number;
  lng: number;
  alt: number; // Earth-radius fraction (altKm / 6371)
}

const EARTH_RADIUS_KM = 6371;
const PROPAGATION_INTERVAL = 30_000; // 30 seconds

export function useSatellites() {
  const [positions, setPositions] = useState<SatPosition[]>([]);
  const [targetPositions, setTargetPositions] = useState<SatPosition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const satrecsRef = useRef<SatRec[]>([]);

  const propagateAll = useCallback((): SatPosition[] => {
    const now = new Date();
    const gmst = gstime(now);

    return satrecsRef.current.map((satrec) => {
      try {
        const pv = propagate(satrec, now);
        if (
          !pv ||
          typeof pv.position === "boolean" ||
          !pv.position
        ) {
          return { lat: 0, lng: 0, alt: 0 };
        }
        const geo = eciToGeodetic(pv.position, gmst);
        return {
          lat: degreesLat(geo.latitude),
          lng: degreesLong(geo.longitude),
          alt: geo.height / EARTH_RADIUS_KM,
        };
      } catch {
        return { lat: 0, lng: 0, alt: 0 };
      }
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const res = await fetch("/api/satellites");
        if (!res.ok) return;
        const records = await res.json();

        const satrecs: SatRec[] = [];
        for (const rec of records) {
          try {
            satrecs.push(json2satrec(rec));
          } catch {
            // skip malformed records
          }
        }
        if (!mounted) return;
        satrecsRef.current = satrecs;

        const initial = propagateAll();
        setPositions(initial);
        setTargetPositions(initial);
        setLoaded(true);
      } catch {
        // API unavailable — satellites just won't render
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, [propagateAll]);

  // Re-propagate every 30s
  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => {
      setTargetPositions(propagateAll());
    }, PROPAGATION_INTERVAL);
    return () => clearInterval(id);
  }, [loaded, propagateAll]);

  return { positions, targetPositions, loaded };
}
