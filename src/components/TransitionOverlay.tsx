"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import SequoiaLogo from "./SequoiaLogo";
import { getCityBySlug, type City } from "@/data/cities";

const MIN_DISPLAY_MS = 800;  // Minimum time to show city name
const FADE_MS = 800;          // Fade-out duration
const MAX_WAIT_MS = 12000;    // Safety cap

export default function TransitionOverlay() {
  const pathname = usePathname();
  const prevPath = useRef(pathname);

  const [transition, setTransition] = useState<{
    city: City;
    key: number;
  } | null>(null);
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("gone");
  const mountTime = useRef(0);

  // Start transition on city navigation
  useEffect(() => {
    if (pathname === prevPath.current) return;
    prevPath.current = pathname;

    const match = pathname.match(/^\/city\/(.+)$/);
    if (!match) return;

    const city = getCityBySlug(match[1]);
    if (!city) return;

    mountTime.current = Date.now();
    setTransition({ city, key: Date.now() });
    setPhase("visible");
  }, [pathname]);

  // Start fade — called when data is ready or max timeout
  const startFade = useCallback(() => {
    setPhase((current) => {
      if (current !== "visible") return current;
      return "fading";
    });
  }, []);

  // Listen for city-data-ready event from CityMap
  useEffect(() => {
    if (phase !== "visible" || !transition) return;

    const handleReady = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.slug !== transition.city.slug) return;

      const elapsed = Date.now() - mountTime.current;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(startFade, remaining);
    };

    window.addEventListener("city-data-ready", handleReady);

    // Safety: don't hold overlay forever
    const fallback = setTimeout(startFade, MAX_WAIT_MS);

    return () => {
      window.removeEventListener("city-data-ready", handleReady);
      clearTimeout(fallback);
    };
  }, [phase, transition, startFade]);

  // After fade completes, remove from DOM
  useEffect(() => {
    if (phase !== "fading") return;
    const timer = setTimeout(() => {
      setPhase("gone");
      setTransition(null);
    }, FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === "gone" || !transition) return null;

  return (
    <div
      key={transition.key}
      className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center gap-4"
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: phase === "fading" ? "none" : "auto",
      }}
    >
      <div
        className="flex items-center gap-3"
        style={{
          opacity: 0,
          animation: "fadeIn 0.5s ease-out 0.1s forwards",
        }}
      >
        <SequoiaLogo className="w-5 h-6 text-white/50" />
        <span className="text-xs font-medium tracking-[0.3em] text-white/50 uppercase">
          Sequoia
        </span>
      </div>
      <h2
        className="text-2xl font-semibold tracking-wide text-white/90"
        style={{
          opacity: 0,
          animation: "fadeIn 0.5s ease-out 0.3s forwards",
        }}
      >
        {transition.city.name}
      </h2>
    </div>
  );
}
