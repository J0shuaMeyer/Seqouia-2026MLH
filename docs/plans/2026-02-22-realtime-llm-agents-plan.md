# Real-Time LLM Agent System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace rule-based agent decisions with batched LLM reasoning and lock the simulation to real-time (1x speed).

**Architecture:** Server-side decision loop (Next.js API route) calls Claude Haiku every 10 minutes with batched group prompts. Client Web Worker continues running 10Hz physics/rendering. Agent memory (last 5 actions) stored server-side in-memory. Fallback to rule-based `decideAction()` on LLM failure.

**Tech Stack:** Next.js 15, Anthropic SDK (v0.78.0, already installed), TypeScript, Web Workers

**Design doc:** `docs/plans/2026-02-22-realtime-llm-agents-design.md`

---

## Task 1: Add New Types (AgentMemory, Decision protocol, Worker messages)

**Files:**
- Modify: `src/lib/agent-types.ts:44-57` (add memory type), `src/lib/agent-types.ts:125-139` (add worker messages)

**Step 1: Add AgentMemory and LLM decision types to agent-types.ts**

After the `AgentState` interface (line 57), add:

```typescript
/** Short-term memory — last 5 actions, stored server-side */
export interface AgentMemoryEntry {
  time: string;           // "12:30 PM"
  activity: AgentActivity;
  locationName: string;   // "Cafe Villarias" or "Home"
  lat: number;
  lng: number;
  durationMin: number;    // planned stay in minutes
}

export interface AgentMemory {
  agentId: string;
  actions: AgentMemoryEntry[];  // max 5, most recent last
}

/** LLM decision result for a single agent */
export interface LLMDecision {
  agentId: string;
  activity: AgentActivity;
  destinationLat: number;
  destinationLng: number;
  destinationName: string;
  transportMode: TransportMode;
  stayMinutes: number;
  reasoning: string;
}
```

**Step 2: Add `applyDecisions` worker message type**

Add to `WorkerInMessage` union (line 125):

```typescript
  | { type: "applyDecisions"; decisions: LLMDecision[] }
```

Remove from `WorkerInMessage`:

```typescript
  | { type: "setSpeed"; factor: number }
```

**Step 3: Commit**

```
git add src/lib/agent-types.ts
git commit -m "feat: add AgentMemory, LLMDecision types and applyDecisions worker message"
```

---

## Task 2: Create Agent Grouping Module

**Files:**
- Create: `src/lib/agent-grouping.ts`

**Step 1: Write the grouping module**

```typescript
import type { AgentPersona, OccupationType } from "./agent-types";

/** Archetype group — agents with similar static attributes */
export interface AgentGroup {
  key: string;
  description: string;
  occupationBucket: string;
  quadrant: string;
  lifestyle: string;
  agentIds: string[];
}

const OCCUPATION_BUCKETS: Record<OccupationType, string> = {
  office_worker: "office",
  tech_worker: "office",
  government: "office",
  teacher: "office",
  service_industry: "service",
  retail: "service",
  healthcare: "service",
  construction: "service",
  gig_driver: "gig",
  remote_worker: "remote",
  retired: "retired",
  student: "student",
};

function getQuadrant(
  lat: number,
  lng: number,
  bbox: [number, number, number, number],
): string {
  const midLat = (bbox[0] + bbox[2]) / 2;
  const midLng = (bbox[1] + bbox[3]) / 2;
  const ns = lat >= midLat ? "N" : "S";
  const ew = lng >= midLng ? "E" : "W";
  return `${ns}${ew}`;
}

function getLifestyle(persona: AgentPersona): string {
  return persona.personality.extraversion > 0.6 ? "social" : "reserved";
}

/**
 * Cluster personas into archetype groups for batch LLM prompting.
 * Deterministic — same personas always produce same groups.
 */
export function buildAgentGroups(
  personas: AgentPersona[],
  bbox: [number, number, number, number],
): AgentGroup[] {
  const groupMap = new Map<string, AgentGroup>();

  for (const p of personas) {
    const occ = OCCUPATION_BUCKETS[p.occupation] ?? "service";
    const quad = getQuadrant(p.homeLat, p.homeLng, bbox);
    const life = getLifestyle(p);
    const key = `${occ}-${quad}-${life}`;

    let group = groupMap.get(key);
    if (!group) {
      group = {
        key,
        description: `${life} ${occ} workers in ${quad} quadrant`,
        occupationBucket: occ,
        quadrant: quad,
        lifestyle: life,
        agentIds: [],
      };
      groupMap.set(key, group);
    }
    group.agentIds.push(p.id);
  }

  return Array.from(groupMap.values());
}
```

**Step 2: Commit**

```
git add src/lib/agent-grouping.ts
git commit -m "feat: add deterministic agent archetype grouping for batch LLM prompts"
```

---

## Task 3: Create Agent Memory Module

**Files:**
- Create: `src/lib/agent-memory.ts`

**Step 1: Write the memory module**

```typescript
import type { AgentMemory, AgentMemoryEntry, AgentActivity } from "./agent-types";

const MAX_MEMORY = 5;

/** Server-side in-memory store — keyed by city slug */
const cityMemories = new Map<string, Map<string, AgentMemory>>();

export function getMemoryStore(citySlug: string): Map<string, AgentMemory> {
  let store = cityMemories.get(citySlug);
  if (!store) {
    store = new Map();
    cityMemories.set(citySlug, store);
  }
  return store;
}

export function getAgentMemory(store: Map<string, AgentMemory>, agentId: string): AgentMemory {
  let mem = store.get(agentId);
  if (!mem) {
    mem = { agentId, actions: [] };
    store.set(agentId, mem);
  }
  return mem;
}

export function recordAction(
  store: Map<string, AgentMemory>,
  agentId: string,
  entry: AgentMemoryEntry,
): void {
  const mem = getAgentMemory(store, agentId);
  mem.actions.push(entry);
  if (mem.actions.length > MAX_MEMORY) {
    mem.actions.shift();
  }
}

/** Format memory for inclusion in LLM prompt */
export function formatMemoryForPrompt(mem: AgentMemory): string {
  if (mem.actions.length === 0) return "No recent activity recorded.";
  return mem.actions
    .map((a) => `${a.time}: ${a.activity} at ${a.locationName} (${a.durationMin}min)`)
    .join(" → ");
}
```

**Step 2: Commit**

```
git add src/lib/agent-memory.ts
git commit -m "feat: add server-side agent short-term memory store"
```

---

## Task 4: Create Prompt Builder and Response Parser

**Files:**
- Create: `src/lib/agent-prompts.ts`

**Step 1: Write the prompt builder**

This is the core LLM integration. Builds batch prompts per group and parses responses.

```typescript
import type {
  AgentPersona,
  AgentState,
  AgentActivity,
  TransportMode,
  CityEnvironment,
  SocialEdge,
  LLMDecision,
} from "./agent-types";
import { formatMemoryForPrompt, getAgentMemory } from "./agent-memory";
import type { AgentGroup } from "./agent-grouping";
import type { AgentMemory } from "./agent-types";

const VALID_ACTIVITIES: Set<string> = new Set([
  "sleeping", "commuting", "working", "leisure",
  "errands", "dining", "socializing", "exercising", "home_active",
]);
const VALID_MODES: Set<string> = new Set([
  "walking", "driving", "transit", "cycling", "stationary",
]);

export const DECISION_SYSTEM_PROMPT = `You simulate realistic daily life for people in a city. Given a group of similar people and their current situations, decide what each person does next.

RULES:
- Decisions must be realistic for the time of day, weather, and each person's recent activity
- People should not repeat the same activity they just did unless it makes sense (e.g., staying at work)
- Use real reasoning: weather, social connections, fatigue, hunger, time pressure
- Sleeping people stay home. Working people stay at work during work hours.
- Return ONLY a valid JSON array. No markdown, no explanation.

Each decision object must have exactly these fields:
- agentId: string (the agent's ID)
- activity: one of "sleeping"|"commuting"|"working"|"leisure"|"errands"|"dining"|"socializing"|"exercising"|"home_active"
- destinationLat: number (latitude)
- destinationLng: number (longitude)
- destinationName: string (short place name)
- transportMode: one of "walking"|"driving"|"transit"|"cycling"|"stationary"
- stayMinutes: number (how long they'll stay, 10-480)
- reasoning: string (one sentence explaining why)`;

function formatTime(simHour: number): string {
  const h = Math.floor(simHour);
  const m = Math.floor((simHour - h) * 60);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function formatWeather(env: CityEnvironment): string {
  const parts: string[] = [`${Math.round(env.tempF)}°F`];
  if (env.isRaining) parts.push("raining");
  if (env.isSnowing) parts.push("snowing");
  if (env.aqi > 150) parts.push(`poor air quality (AQI ${env.aqi})`);
  return parts.join(", ");
}

function findNearbyFriends(
  agentId: string,
  agents: AgentState[],
  socialEdges: SocialEdge[],
): string[] {
  const friendNames: string[] = [];
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  for (const edge of socialEdges) {
    const peerId = edge.source === agentId ? edge.target : edge.target === agentId ? edge.source : null;
    if (!peerId) continue;
    if (edge.strength < 0.4) continue;

    const peer = agentMap.get(peerId);
    if (peer && peer.activity !== "sleeping" && peer.activity !== "home_active") {
      friendNames.push(peerId);
    }
  }
  return friendNames.slice(0, 3); // max 3 to keep prompt small
}

export function buildGroupPrompt(
  group: AgentGroup,
  personas: Map<string, AgentPersona>,
  agents: AgentState[],
  memoryStore: Map<string, AgentMemory>,
  env: CityEnvironment,
  socialEdges: SocialEdge[],
  simHour: number,
  cityName: string,
): string {
  const time = formatTime(simHour);
  const weather = formatWeather(env);
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Shared group context
  let prompt = `CITY: ${cityName}
TIME: ${time}
WEATHER: ${weather}
TRAFFIC: ${env.avgJamLevel > 2 ? "Heavy congestion" : env.avgJamLevel > 1 ? "Moderate traffic" : "Light traffic"}
TRANSIT AVAILABLE: ${env.hasTransit ? "Yes" : "No"}
BIKESHARE AVAILABLE: ${env.hasBikeshare ? "Yes" : "No"}

GROUP: ${group.description}

AGENTS NEEDING DECISIONS:\n`;

  for (const agentId of group.agentIds) {
    const persona = personas.get(agentId);
    const state = agentMap.get(agentId);
    if (!persona || !state) continue;

    // Skip agents that don't need decisions yet
    if (!state.arrivedAtDest && state.destination) continue;
    if (state.arrivedAtDest && state.ticksAtDest < state.stayDuration) continue;

    const mem = getAgentMemory(memoryStore, agentId);
    const friends = findNearbyFriends(agentId, agents, socialEdges);

    prompt += `
- ${persona.name} (ID: ${agentId})
  Age: ${persona.age}, Occupation: ${persona.occupation.replace("_", " ")}
  Home: (${persona.homeLat.toFixed(4)}, ${persona.homeLng.toFixed(4)})
  Work: (${persona.workLat.toFixed(4)}, ${persona.workLng.toFixed(4)})
  Current location: (${state.lat.toFixed(4)}, ${state.lng.toFixed(4)}), doing: ${state.activity}
  Recent history: ${formatMemoryForPrompt(mem)}
  ${friends.length > 0 ? `Active friends nearby: ${friends.join(", ")}` : "No friends currently active nearby"}
`;
  }

  prompt += `\nReturn a JSON array with one decision per agent listed above.`;
  return prompt;
}

/** Parse and validate LLM response into typed decisions */
export function parseDecisions(raw: string, validAgentIds: Set<string>): LLMDecision[] {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: unknown[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("[parseDecisions] Failed to parse JSON:", cleaned.slice(0, 200));
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const decisions: LLMDecision[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const d = item as Record<string, unknown>;

    // Validate required fields
    if (typeof d.agentId !== "string" || !validAgentIds.has(d.agentId)) continue;
    if (typeof d.activity !== "string" || !VALID_ACTIVITIES.has(d.activity)) continue;
    if (typeof d.transportMode !== "string" || !VALID_MODES.has(d.transportMode)) continue;
    if (typeof d.destinationLat !== "number" || typeof d.destinationLng !== "number") continue;
    if (typeof d.stayMinutes !== "number") continue;

    decisions.push({
      agentId: d.agentId,
      activity: d.activity as AgentActivity,
      destinationLat: d.destinationLat,
      destinationLng: d.destinationLng,
      destinationName: typeof d.destinationName === "string" ? d.destinationName : "Unknown",
      transportMode: d.transportMode as TransportMode,
      stayMinutes: Math.max(10, Math.min(480, d.stayMinutes)),
      reasoning: typeof d.reasoning === "string" ? d.reasoning : "",
    });
  }

  return decisions;
}
```

**Step 2: Commit**

```
git add src/lib/agent-prompts.ts
git commit -m "feat: add LLM prompt builder and response parser for batch agent decisions"
```

---

## Task 5: Create the Decision API Route

**Files:**
- Create: `src/app/api/agents/decide/[slug]/route.ts`

**Step 1: Write the API route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCityBySlug } from "@/data/cities";
import type {
  AgentPersona,
  AgentState,
  CityEnvironment,
  LLMDecision,
  SocialEdge,
} from "@/lib/agent-types";
import { buildAgentGroups } from "@/lib/agent-grouping";
import { buildGroupPrompt, parseDecisions, DECISION_SYSTEM_PROMPT } from "@/lib/agent-prompts";
import { getMemoryStore, recordAction, getAgentMemory } from "@/lib/agent-memory";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface DecideRequest {
  agents: AgentState[];
  personas: AgentPersona[];
  environment: CityEnvironment;
  socialEdges: SocialEdge[];
  simHour: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);
  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }

  const body: DecideRequest = await request.json();
  const { agents, personas, environment, socialEdges, simHour } = body;

  if (!agents?.length || !personas?.length) {
    return NextResponse.json({ error: "Missing agents or personas" }, { status: 400 });
  }

  const personaMap = new Map(personas.map((p) => [p.id, p]));
  const memoryStore = getMemoryStore(slug);
  const groups = buildAgentGroups(personas, city.bbox);

  // Build prompts for each group (only agents needing decisions)
  const groupPrompts: Array<{ group: typeof groups[0]; prompt: string; agentIds: string[] }> = [];

  for (const group of groups) {
    const needsDecision = group.agentIds.filter((id) => {
      const a = agents.find((ag) => ag.id === id);
      if (!a) return false;
      if (!a.arrivedAtDest && a.destination) return false;
      if (a.arrivedAtDest && a.ticksAtDest < a.stayDuration) return false;
      return true;
    });

    if (needsDecision.length === 0) continue;

    const prompt = buildGroupPrompt(
      { ...group, agentIds: needsDecision },
      personaMap,
      agents,
      memoryStore,
      environment,
      socialEdges,
      simHour,
      city.name,
    );

    groupPrompts.push({ group, prompt, agentIds: needsDecision });
  }

  if (groupPrompts.length === 0) {
    return NextResponse.json({ decisions: [] });
  }

  // Fire all LLM calls in parallel
  const allDecisions: LLMDecision[] = [];
  const validIds = new Set(agents.map((a) => a.id));

  const results = await Promise.allSettled(
    groupPrompts.map(async ({ prompt, agentIds }) => {
      try {
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: DECISION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });

        const text = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");

        return parseDecisions(text, new Set(agentIds));
      } catch (err) {
        console.error(`[decide] LLM call failed for group:`, err);
        return [];
      }
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.length > 0) {
      allDecisions.push(...result.value);
    }
  }

  // Record decisions in memory
  const timeStr = formatSimHour(simHour);
  for (const d of allDecisions) {
    recordAction(memoryStore, d.agentId, {
      time: timeStr,
      activity: d.activity,
      locationName: d.destinationName,
      lat: d.destinationLat,
      lng: d.destinationLng,
      durationMin: d.stayMinutes,
    });
  }

  return NextResponse.json({ decisions: allDecisions });
}

function formatSimHour(h: number): string {
  const hr = Math.floor(h);
  const min = Math.floor((h - hr) * 60);
  const period = hr >= 12 ? "PM" : "AM";
  const h12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
  return `${h12}:${min.toString().padStart(2, "0")} ${period}`;
}
```

**Step 2: Commit**

```
git add src/app/api/agents/decide/
git commit -m "feat: add /api/agents/decide/[slug] route with batched LLM group prompting"
```

---

## Task 6: Lock Simulation to Real-Time (1x Speed)

**Files:**
- Modify: `src/lib/simulation-engine.ts:17-30` (constants), `src/lib/simulation-engine.ts:700-706` (simMinutesPerTick)
- Modify: `src/workers/simulation-worker.ts` (remove speed, add applyDecisions, lock to 1x)

**Step 1: Update simulation-engine.ts constants**

Change line 19 comment and line 28:
```typescript
/** Degrees per tick per transport mode (at 1× real-time speed) */
```

Update DECISION_INTERVAL (line 28):
```typescript
export const DECISION_INTERVAL = 6000;  // ticks = 10 real minutes at 10Hz
```

The SPEED_TABLE values don't need changing — with `speedFactor = 1` and `speedScale = 1/144`, agents already move at correct real-time speeds thanks to the Fix 2 changes we made earlier.

**Step 2: Update simulation-worker.ts**

Lock speedFactor to 1 (line 37):
```typescript
const speedFactor = 1;  // Real-time: locked to 1x
```

Remove the `setSpeed` case from the message handler (lines 73-75).

Add `applyDecisions` case to the message handler:
```typescript
    case "applyDecisions": {
      const SPEED_TABLE: Record<string, number> = {
        walking: 0.000006,
        cycling: 0.000018,
        transit: 0.000036,
        driving: 0.000048,
        stationary: 0,
      };
      for (const d of msg.decisions) {
        const agent = agents.find((a) => a.id === d.agentId);
        if (!agent) continue;
        agent.activity = d.activity;
        agent.destination = { lat: d.destinationLat, lng: d.destinationLng };
        agent.transportMode = d.transportMode;
        agent.speed = SPEED_TABLE[d.transportMode] ?? 0;
        agent.ticksAtDest = 0;
        // Convert stayMinutes to ticks: minutes * 60 seconds * 10 ticks/sec
        agent.stayDuration = Math.round(d.stayMinutes * 60 * 10);
        if (d.activity === "sleeping" || d.activity === "home_active") {
          if (d.destinationLat && d.destinationLng) {
            agent.lat = d.destinationLat;
            agent.lng = d.destinationLng;
          }
          agent.arrivedAtDest = true;
        } else {
          agent.arrivedAtDest = false;
        }
      }
      break;
    }
```

Remove from the main loop the call to `makeDecisions` at `DECISION_INTERVAL` — decisions now come from the server. Keep `resolveInteractions` and `detectPatterns` since they're local analysis.

In the loop function, replace the decision block (lines 112-113) with just interactions/patterns:
```typescript
  if (tick % DECISION_INTERVAL === 0) {
    // Decisions now come from server via applyDecisions message
    // Only run local interaction resolution and pattern detection
    const grid = buildSpatialGrid(agents, bbox);
    resolveInteractions(agents, personas, grid, environment, adjacency);
    // ... rest stays the same
  }
```

**Step 3: Commit**

```
git add src/lib/simulation-engine.ts src/workers/simulation-worker.ts
git commit -m "feat: lock simulation to real-time 1x, add applyDecisions worker message, remove speed controls"
```

---

## Task 7: Update useSimulation Hook (Server Decision Polling)

**Files:**
- Modify: `src/hooks/useSimulation.ts`

**Step 1: Add decision polling loop**

Add a new `useEffect` that polls the decision API every 10 minutes. Insert after the environment refresh effect (after line 179):

```typescript
  // LLM decision polling (every 10 minutes)
  useEffect(() => {
    if (!enabled || !isRunning || !personas) return;

    async function fetchDecisions() {
      const result = tickResult;
      if (!result) return;

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
          }
        }
      } catch (err) {
        console.error("[useSimulation] decision fetch failed:", err);
      }
    }

    // Fetch immediately on first run, then every 10 minutes
    fetchDecisions();
    const id = setInterval(fetchDecisions, 10 * 60 * 1000);

    return () => clearInterval(id);
  }, [enabled, isRunning, city.slug, personas, socialEdges]);
```

**Step 2: Remove speed state and controls**

- Remove `speed` state (line 62): delete `const [speed, setSpeedState] = useState(144);`
- Remove `setSpeed` callback (lines 231-234)
- Remove `speed` and `setSpeed` from the returned object (lines 260, 263)
- Update `SimulationControls` interface (lines 38-51): remove `speed` and `setSpeed`

**Step 3: Update initial worker message**

The init message still uses `getLocalHour` for startHour (line 131) — this is correct for real-time since it starts at the actual local time.

**Step 4: Commit**

```
git add src/hooks/useSimulation.ts
git commit -m "feat: add server decision polling every 10min, remove speed controls from hook"
```

---

## Task 8: Update AgentSidebar (Remove Speed Controls, Add LLM Indicator)

**Files:**
- Modify: `src/components/AgentSidebar.tsx`

**Step 1: Remove speed controls section**

Delete the speed buttons block (the `<div className="flex gap-1">` with the `[{ factor: 1, label: "0.01x" }, ...]` mapping that we added earlier in this session).

Remove the speed display in the header (the `<span>` showing `{speed === 144 ? ...}`).

**Step 2: Remove speed from SimulationControls usage**

Update the destructuring (current line 110):
```typescript
  const { tickResult, patterns, narrative, isRunning, simHour, personas, socialEdges } = simulation;
```

Remove `speed` from this destructuring.

**Step 3: Add a real-time indicator in the header**

Where the speed display was, add a simple live indicator:
```tsx
<span className="text-[10px] text-emerald-400/60 ml-auto flex items-center gap-1">
  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />
  Live
</span>
```

**Step 4: Commit**

```
git add src/components/AgentSidebar.tsx
git commit -m "feat: remove speed controls, add real-time 'Live' indicator"
```

---

## Task 9: Update CityMap (Remove Speed Dependencies)

**Files:**
- Modify: `src/components/CityMap.tsx`

**Step 1: Verify no speed-dependent code remains**

The CityMap already doesn't reference speed directly — it only consumes `simulation.tickResult`. The speed controls were only in AgentSidebar. Verify this is the case and no changes are needed.

**Step 2: Commit (if changes needed)**

Only commit if actual changes were made.

---

## Task 10: Wire Up Initial Rule-Based Decisions for First Render

**Files:**
- Modify: `src/workers/simulation-worker.ts`

**Step 1: Keep initial makeDecisions call**

The worker's `init` handler (line 63) currently calls `makeDecisions()` to give agents their first positions. This should remain — it provides immediate agent placement while waiting for the first server LLM decision cycle (up to 10 minutes away).

Ensure the init handler still has:
```typescript
      agents = initAgents(personas);
      makeDecisions(agents, personas, environment, simHour, adjacency);
```

This way agents start with rule-based decisions and then transition to LLM-driven decisions after the first polling cycle.

**Step 2: Commit**

```
git add src/workers/simulation-worker.ts
git commit -m "fix: ensure initial rule-based decisions for immediate agent placement on load"
```

---

## Task 11: Integration Test — Full End-to-End Verification

**No files to create — manual verification:**

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Open Mexico City**

Navigate to `http://localhost:3000/city/mexico-city`

**Step 3: Verify initial state**

- Agents should appear on the map immediately (rule-based first decisions)
- simHour should match Mexico City's actual current time (UTC-6)
- No speed controls visible in sidebar
- "Live" indicator visible in sidebar header

**Step 4: Check server logs for first LLM decision cycle**

Within ~30 seconds of page load (the immediate fetch), you should see:
- Parallel Haiku API calls in the server console
- Decision responses parsed and applied
- Agent behaviors should become more contextual

**Step 5: Monitor for 10+ minutes**

- Observe the second decision cycle fire at the 10-minute mark
- Agents should smoothly transition between activities
- No console errors in browser or server
- Agent memory building up (visible in decision reasoning)

**Step 6: Test fallback**

- Temporarily invalidate `ANTHROPIC_API_KEY`
- Verify agents continue operating on rule-based decisions
- No freezing or crashes

---

## Summary of Files

| File | Action | Task |
|------|--------|------|
| `src/lib/agent-types.ts` | Modify | Task 1 |
| `src/lib/agent-grouping.ts` | Create | Task 2 |
| `src/lib/agent-memory.ts` | Create | Task 3 |
| `src/lib/agent-prompts.ts` | Create | Task 4 |
| `src/app/api/agents/decide/[slug]/route.ts` | Create | Task 5 |
| `src/lib/simulation-engine.ts` | Modify | Task 6 |
| `src/workers/simulation-worker.ts` | Modify | Task 6, 10 |
| `src/hooks/useSimulation.ts` | Modify | Task 7 |
| `src/components/AgentSidebar.tsx` | Modify | Task 8 |
| `src/components/CityMap.tsx` | Verify | Task 9 |
