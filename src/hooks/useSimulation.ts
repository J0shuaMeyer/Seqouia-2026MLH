"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { City } from "@/data/cities";
import type {
  AgentPersona,
  SimTickResult,
  EmergentPattern,
  WorkerInMessage,
  WorkerOutMessage,
  CityEnvironment,
} from "@/lib/agent-types";
import { buildCityEnvironment } from "@/lib/agent-environment";
import { getLocalHour } from "@/lib/activity";

/** Pattern insight template fallbacks (no LLM needed) */
const PATTERN_TEMPLATES: Record<string, (p: EmergentPattern, env: CityEnvironment) => string> = {
  rush_hour: (p) => `Morning rush: ${p.agentCount} citizens heading to work.`,
  ghost_town: (_p, env) =>
    `The streets are quiet — ${env.isRaining ? "rain" : "early hours"} keeping people indoors.`,
  nightlife_surge: (p) =>
    `Evening comes alive: ${p.agentCount} citizens at restaurants and social venues.`,
  cluster: (p) =>
    `A crowd of ${p.agentCount} is forming — popular destination drawing people in.`,
  mode_shift: (_p, env) =>
    `Transport shift detected — ${env.isRaining ? "rain pushing commuters to transit" : "changing conditions altering travel patterns"}.`,
  weather_exodus: () => `Weather driving people indoors across the city.`,
  congestion_avoidance: () => `Commuters rerouting around congestion hotspots.`,
};

const ENV_REFRESH_MS = 120_000; // refresh real-world data every 2 min
const NARRATIVE_COOLDOWN_MS = 30_000;

export interface SimulationControls {
  tickResult: SimTickResult | null;
  patterns: EmergentPattern[];
  narrative: string | null;
  isRunning: boolean;
  simHour: number;
  speed: number;
  personas: AgentPersona[] | null;
  setSpeed: (factor: number) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
}

export function useSimulation(
  city: City,
  enabled: boolean,
): SimulationControls {
  const [tickResult, setTickResult] = useState<SimTickResult | null>(null);
  const [patterns, setPatterns] = useState<EmergentPattern[]>([]);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [simHour, setSimHour] = useState(0);
  const [speed, setSpeedState] = useState(144);
  const [personas, setPersonas] = useState<AgentPersona[] | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const envRef = useRef<CityEnvironment | null>(null);
  const lastNarrativeRef = useRef(0);
  const envTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch personas
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    fetch(`/api/agents/generate/${city.slug}`)
      .then((r) => r.json())
      .then((data: AgentPersona[]) => {
        if (!cancelled && Array.isArray(data)) setPersonas(data);
      })
      .catch((err) => console.error("[useSimulation] persona fetch failed:", err));

    return () => { cancelled = true; };
  }, [city.slug, enabled]);

  // Init worker when personas + environment ready
  useEffect(() => {
    if (!enabled || !personas || personas.length === 0) return;

    let cancelled = false;

    async function start() {
      // Build initial environment
      const env = await buildCityEnvironment(city);
      if (cancelled) return;
      envRef.current = env;

      // Create worker
      const worker = new Worker(
        new URL("../workers/simulation-worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
        if (cancelled) return;
        const msg = e.data;
        switch (msg.type) {
          case "ready":
            setIsRunning(true);
            break;
          case "tick":
            setTickResult(msg.result);
            setSimHour(msg.result.simHour);
            break;
          case "pattern":
            setPatterns(msg.patterns);
            generateNarrative(msg.patterns, env, city);
            break;
          case "error":
            console.error("[simulation-worker]", msg.message);
            break;
        }
      };

      const startHour = getLocalHour(city.timezone);

      const initMsg: WorkerInMessage = {
        type: "init",
        personas: personas!,
        environment: env,
        bbox: city.bbox,
        startHour,
      };
      worker.postMessage(initMsg);
    }

    start();

    return () => {
      cancelled = true;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      setIsRunning(false);
      setTickResult(null);
      setPatterns([]);
      setNarrative(null);
    };
  }, [personas, enabled, city]);

  // Refresh environment periodically
  useEffect(() => {
    if (!enabled || !isRunning) return;

    envTimerRef.current = setInterval(async () => {
      try {
        const env = await buildCityEnvironment(city);
        envRef.current = env;
        workerRef.current?.postMessage({
          type: "updateEnvironment",
          environment: env,
        } satisfies WorkerInMessage);
      } catch (err) {
        console.error("[useSimulation] env refresh failed:", err);
      }
    }, ENV_REFRESH_MS);

    return () => {
      if (envTimerRef.current) clearInterval(envTimerRef.current);
    };
  }, [enabled, isRunning, city]);

  // Narrative generation (templates or LLM fallback)
  const generateNarrative = useCallback(
    async (pats: EmergentPattern[], env: CityEnvironment, c: City) => {
      const now = Date.now();
      if (now - lastNarrativeRef.current < NARRATIVE_COOLDOWN_MS) return;
      if (pats.length === 0) return;

      lastNarrativeRef.current = now;

      // Single pattern → use template
      if (pats.length === 1) {
        const tmpl = PATTERN_TEMPLATES[pats[0].type];
        if (tmpl) {
          setNarrative(tmpl(pats[0], env));
          return;
        }
      }

      // Multiple patterns → try LLM narrative
      try {
        const res = await fetch("/api/agents/narrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            city: c.name,
            simHour: pats[0].simHour,
            patterns: pats,
            weather: { tempF: env.tempF, isRaining: env.isRaining, isSnowing: env.isSnowing },
            stats: tickResult?.stats,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.narrative) {
            setNarrative(data.narrative);
            return;
          }
        }
      } catch {
        // Fallback to template
      }

      // Template fallback for the first pattern
      const tmpl = PATTERN_TEMPLATES[pats[0].type];
      if (tmpl) setNarrative(tmpl(pats[0], env));
    },
    [tickResult],
  );

  // Controls
  const setSpeed = useCallback((factor: number) => {
    setSpeedState(factor);
    workerRef.current?.postMessage({ type: "setSpeed", factor } satisfies WorkerInMessage);
  }, []);

  const pause = useCallback(() => {
    setIsRunning(false);
    workerRef.current?.postMessage({ type: "pause" } satisfies WorkerInMessage);
  }, []);

  const resume = useCallback(() => {
    setIsRunning(true);
    workerRef.current?.postMessage({ type: "resume" } satisfies WorkerInMessage);
  }, []);

  const reset = useCallback(() => {
    const startHour = getLocalHour(city.timezone);
    setSimHour(startHour);
    setPatterns([]);
    setNarrative(null);
    workerRef.current?.postMessage({ type: "reset", startHour } satisfies WorkerInMessage);
  }, [city.timezone]);

  return {
    tickResult,
    patterns,
    narrative,
    isRunning,
    simHour,
    speed,
    personas,
    setSpeed,
    pause,
    resume,
    reset,
  };
}
