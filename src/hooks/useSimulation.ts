"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { City } from "@/data/cities";
import type {
  AgentPersona,
  SocialEdge,
  SimTickResult,
  EmergentPattern,
  WorkerInMessage,
  WorkerOutMessage,
  CityEnvironment,
  LLMDecision,
} from "@/lib/agent-types";
import { buildCityEnvironment } from "@/lib/agent-environment";
import { buildSocialGraph } from "@/lib/social-graph";
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
  social_clustering: (p) => `A group of ${p.agentCount} friends and family gathering at the same venue.`,
  information_cascade: (p) => `Word-of-mouth spreading: ${p.agentCount} commuters rerouting through social connections.`,
};

const ENV_REFRESH_MS = 120_000;       // refresh real-world data every 2 min
const DECISION_POLL_MS = 10 * 60_000; // poll for LLM decisions every 10 min
const NARRATIVE_COOLDOWN_MS = 30_000;
const MAX_FEED_SIZE = 50;             // keep last 50 decisions in the feed

/** A timestamped LLM decision for the activity feed */
export interface DecisionFeedEntry extends LLMDecision {
  timestamp: number;
  agentName: string;
}

export interface SimulationControls {
  tickResult: SimTickResult | null;
  patterns: EmergentPattern[];
  narrative: string | null;
  isRunning: boolean;
  simHour: number;
  personas: AgentPersona[] | null;
  socialEdges: SocialEdge[];
  decisionFeed: DecisionFeedEntry[];
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
  const [personas, setPersonas] = useState<AgentPersona[] | null>(null);
  const [socialEdges, setSocialEdges] = useState<SocialEdge[]>([]);
  const [decisionFeed, setDecisionFeed] = useState<DecisionFeedEntry[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const envRef = useRef<CityEnvironment | null>(null);
  const lastNarrativeRef = useRef(0);
  const envTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickResultRef = useRef<SimTickResult | null>(null);

  // Keep tickResultRef in sync for use in decision polling
  useEffect(() => { tickResultRef.current = tickResult; }, [tickResult]);

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
      // Build social graph from persona data
      const graph = buildSocialGraph(personas!);
      if (cancelled) return;
      setSocialEdges(graph.edges);

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
        socialEdges: graph.edges,
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
      setDecisionFeed([]);
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

  // LLM decision polling (every 10 real minutes)
  useEffect(() => {
    if (!enabled || !isRunning || !personas) return;

    async function fetchDecisions() {
      const result = tickResultRef.current;
      if (!result || !personas) return;

      try {
        const res = await fetch(`/api/agents/decide/${city.slug}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agents: result.agents,
            personas,
            environment: envRef.current,
            socialEdges,
            simHour: result.simHour,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.decisions?.length > 0) {
            workerRef.current?.postMessage({
              type: "applyDecisions",
              decisions: data.decisions,
            } satisfies WorkerInMessage);

            // Build a name lookup and add to the activity feed
            const nameMap = new Map(personas!.map((p) => [p.id, p.name]));
            const now = Date.now();
            const entries: DecisionFeedEntry[] = (data.decisions as LLMDecision[]).map((d) => ({
              ...d,
              timestamp: now,
              agentName: nameMap.get(d.agentId) ?? d.agentId,
            }));
            setDecisionFeed((prev) => [...entries, ...prev].slice(0, MAX_FEED_SIZE));
          }
        }
      } catch (err) {
        console.error("[useSimulation] decision fetch failed:", err);
      }
    }

    // Fetch immediately on first run, then every 10 minutes
    fetchDecisions();
    const id = setInterval(fetchDecisions, DECISION_POLL_MS);

    return () => clearInterval(id);
  }, [enabled, isRunning, city.slug, personas, socialEdges]);

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
            stats: tickResultRef.current?.stats,
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
    [],
  );

  // Controls
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
    setDecisionFeed([]);
    workerRef.current?.postMessage({ type: "reset", startHour } satisfies WorkerInMessage);
  }, [city.timezone]);

  return {
    tickResult,
    patterns,
    narrative,
    isRunning,
    simHour,
    personas,
    socialEdges,
    decisionFeed,
    pause,
    resume,
    reset,
  };
}
