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
  AgentConversation,
  ConversationLine,
  AgentMemory,
} from "@/lib/agent-types";
import { buildCityEnvironment } from "@/lib/agent-environment";
import { buildSocialGraph } from "@/lib/social-graph";
import { getLocalHour } from "@/lib/activity";
import { detectEnvironmentChanges, maxUrgency, formatChangesForPrompt } from "@/lib/agent-environment-diff";

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
  earthquake_response: (p) => `Earthquake alert: ${p.agentCount} citizens seeking safety.`,
  weather_transition: (_p, env) => `Weather shift — ${env.isRaining ? "rain" : "conditions changing"} altering city behavior.`,
  traffic_surge: (p) => `Traffic surge: ${p.agentCount} commuters rerouting.`,
};

const ENV_REFRESH_MS = 120_000;       // refresh real-world data every 2 min
const DECISION_POLL_MS = 10 * 60_000; // poll for LLM decisions every 10 min
const NARRATIVE_COOLDOWN_MS = 30_000;
const MAX_FEED_SIZE = 50;             // keep last 50 decisions in the feed
const CONVERSE_COOLDOWN_MS = 30_000;  // 30s cooldown per location for conversations
const MAX_CONVERSATIONS = 20;         // keep last 20 conversations
const MAX_EMERGENCY_AGENTS = 30;      // cap agents for emergency re-decisions
const MAX_CONCURRENT_CONVERSE = 3;    // max concurrent conversation API calls

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
  conversations: AgentConversation[];
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
  const [conversations, setConversations] = useState<AgentConversation[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const envRef = useRef<CityEnvironment | null>(null);
  const prevEnvRef = useRef<CityEnvironment | null>(null);
  const lastNarrativeRef = useRef(0);
  const envTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickResultRef = useRef<SimTickResult | null>(null);
  const conversationCooldownRef = useRef<Map<string, number>>(new Map());
  const activeConverseCountRef = useRef(0);

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
          case "socialCluster":
            handleSocialCluster(msg.agentIds, msg.location, msg.simHour);
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
      setConversations([]);
    };
  }, [personas, enabled, city]);

  // Refresh environment periodically + detect changes + trigger emergency re-decisions
  useEffect(() => {
    if (!enabled || !isRunning) return;

    envTimerRef.current = setInterval(async () => {
      try {
        const newEnv = await buildCityEnvironment(city);
        const prevEnv = envRef.current;

        // Detect environment changes
        let changes = prevEnv
          ? detectEnvironmentChanges(prevEnv, newEnv)
          : [];

        // Attach changes to the environment
        newEnv.environmentChanges = changes;
        prevEnvRef.current = prevEnv;
        envRef.current = newEnv;

        workerRef.current?.postMessage({
          type: "updateEnvironment",
          environment: newEnv,
        } satisfies WorkerInMessage);

        // Emergency re-decisions for critical/high urgency changes
        const urgency = maxUrgency(changes);
        if ((urgency === "critical" || urgency === "high") && personas && tickResultRef.current) {
          const result = tickResultRef.current;
          const urgentDesc = formatChangesForPrompt(changes.filter((c) => c.urgency === "critical" || c.urgency === "high"));

          // Filter affected agents (non-sleeping), cap at MAX_EMERGENCY_AGENTS
          const affectedAgents = result.agents
            .filter((a) => a.activity !== "sleeping")
            .slice(0, MAX_EMERGENCY_AGENTS);

          if (affectedAgents.length > 0) {
            console.log(`[useSimulation] Emergency re-decisions for ${affectedAgents.length} agents: ${urgentDesc}`);
            try {
              const res = await fetch(`/api/agents/decide/${city.slug}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  agents: affectedAgents,
                  personas: personas!.filter((p) => affectedAgents.some((a) => a.id === p.id)),
                  environment: newEnv,
                  socialEdges,
                  simHour: result.simHour,
                  urgentContext: urgentDesc,
                }),
              });

              if (res.ok) {
                const data = await res.json();
                if (data.decisions?.length > 0) {
                  workerRef.current?.postMessage({
                    type: "applyDecisions",
                    decisions: data.decisions,
                  } satisfies WorkerInMessage);

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
              console.error("[useSimulation] emergency re-decision failed:", err);
            }
          }
        }
      } catch (err) {
        console.error("[useSimulation] env refresh failed:", err);
      }
    }, ENV_REFRESH_MS);

    return () => {
      if (envTimerRef.current) clearInterval(envTimerRef.current);
    };
  }, [enabled, isRunning, city, personas, socialEdges]);

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

  // Handle social cluster events — orchestrate conversations
  const handleSocialCluster = useCallback(
    async (agentIds: string[], location: { lat: number; lng: number }, clusterSimHour: number) => {
      if (!personas || !envRef.current) return;

      // Check cooldown for this location
      const locationKey = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
      const now = Date.now();
      const lastConverse = conversationCooldownRef.current.get(locationKey) ?? 0;
      if (now - lastConverse < CONVERSE_COOLDOWN_MS) return;

      // Check concurrent request limit
      if (activeConverseCountRef.current >= MAX_CONCURRENT_CONVERSE) return;

      conversationCooldownRef.current.set(locationKey, now);
      activeConverseCountRef.current++;

      try {
        const personaMap = new Map(personas.map((p) => [p.id, p]));
        const participants = agentIds
          .map((id) => {
            const persona = personaMap.get(id);
            if (!persona) return null;
            return {
              persona,
              memory: { agentId: id, actions: [], socialEvents: [] } as AgentMemory,
            };
          })
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .slice(0, 5); // max 5 participants per conversation

        if (participants.length < 2) return;

        // Find a location name from nearby POIs
        const env = envRef.current;
        let locationName = "a gathering spot";
        if (env.pois.length > 0) {
          let closestPOI = env.pois[0];
          let closestDist = Infinity;
          for (const poi of env.pois) {
            const d = (poi.lat - location.lat) ** 2 + (poi.lng - location.lng) ** 2;
            if (d < closestDist) {
              closestDist = d;
              closestPOI = poi;
            }
          }
          locationName = closestPOI.category.replace(/_/g, " ");
        }

        const res = await fetch("/api/agents/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participants,
            environment: env,
            locationName,
            simHour: clusterSimHour,
          }),
        });

        if (res.ok) {
          const data = await res.json() as {
            lines: ConversationLine[];
            topics: string[];
          };

          if (data.lines?.length > 0) {
            const conversation: AgentConversation = {
              id: `conv-${now}`,
              timestamp: now,
              simHour: clusterSimHour,
              locationName,
              location,
              participantIds: participants.map((p) => p.persona.id),
              participantNames: participants.map((p) => p.persona.name),
              lines: data.lines,
              topics: data.topics ?? [],
            };

            setConversations((prev) => [conversation, ...prev].slice(0, MAX_CONVERSATIONS));

            // Record conversation in each participant's social memory (via server)
            // This is sent to the decide API's memory store on next decision
            const topicStr = data.topics?.join(", ") ?? "general";
            const nameMap = new Map(participants.map((p) => [p.persona.id, p.persona.name]));

            // Add conversation to the activity feed as a special entry
            const feedEntries: DecisionFeedEntry[] = participants.map((p) => ({
              agentId: p.persona.id,
              agentName: p.persona.name,
              activity: "socializing" as const,
              destinationLat: location.lat,
              destinationLng: location.lng,
              destinationName: locationName,
              transportMode: "stationary" as const,
              stayMinutes: 0,
              reasoning: `Chatting about ${topicStr} with ${participants.filter((pp) => pp.persona.id !== p.persona.id).map((pp) => pp.persona.name).join(", ")}`,
              timestamp: now,
            }));
            setDecisionFeed((prev) => [...feedEntries, ...prev].slice(0, MAX_FEED_SIZE));

            // Store social memory server-side
            try {
              await fetch(`/api/agents/decide/${city.slug}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Social-Memory": "true" },
                body: JSON.stringify({
                  socialMemory: {
                    participantIds: participants.map((p) => p.persona.id),
                    participantNames: participants.map((p) => p.persona.name),
                    topics: data.topics ?? [],
                    locationName,
                    simHour: clusterSimHour,
                  },
                }),
              });
            } catch {
              // Non-critical — memory will be available next session
            }
          }
        }
      } catch (err) {
        console.error("[useSimulation] conversation failed:", err);
      } finally {
        activeConverseCountRef.current--;
      }
    },
    [personas, city.slug],
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
    setConversations([]);
    conversationCooldownRef.current.clear();
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
    conversations,
    pause,
    resume,
    reset,
  };
}
