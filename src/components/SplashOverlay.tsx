"use client";

import { useState, useEffect, useRef } from "react";
import { useGlobeData } from "@/context/GlobeDataContext";
import SequoiaLogo from "./SequoiaLogo";

const MIN_DISPLAY_MS = 2000; // Minimum time to show branding
const FADE_MS = 1500;        // Fade-out duration
const MAX_WAIT_MS = 15000;   // Safety cap — fade even if data never loads

export default function SplashOverlay() {
  const { dataLoaded, globeReady } = useGlobeData();
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible");
  const mountTime = useRef(Date.now());

  // When both data + globe are ready (or max timeout), start fading
  useEffect(() => {
    if (phase !== "visible") return;

    const allReady = dataLoaded && globeReady;

    if (allReady) {
      const elapsed = Date.now() - mountTime.current;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      const timer = setTimeout(() => setPhase("fading"), remaining);
      return () => clearTimeout(timer);
    }

    // Safety: don't hold splash forever
    const fallback = setTimeout(() => setPhase("fading"), MAX_WAIT_MS);
    return () => clearTimeout(fallback);
  }, [dataLoaded, globeReady, phase]);

  // After fade completes, remove from DOM
  useEffect(() => {
    if (phase !== "fading") return;
    const timer = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center gap-5"
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: phase === "fading" ? "none" : "auto",
      }}
    >
      {/* Logo + wordmark appear together */}
      <div
        className="flex items-center gap-3"
        style={{
          opacity: 0,
          animation: "fadeIn 0.8s ease-out 0.4s forwards",
        }}
      >
        <SequoiaLogo className="w-8 h-10 text-white/70" />
        <h1 className="text-xl font-semibold tracking-[0.35em] text-white/90">
          SEQUOIA
        </h1>
      </div>
      <p
        className="text-sm font-light tracking-wide text-white/40"
        style={{
          opacity: 0,
          animation: "fadeIn 0.8s ease-out 1.4s forwards",
        }}
      >
        Real-time intelligence, worldwide.
      </p>
    </div>
  );
}
