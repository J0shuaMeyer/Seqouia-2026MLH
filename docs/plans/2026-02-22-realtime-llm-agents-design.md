# Real-Time LLM Agent System Design

**Date:** 2026-02-22
**Status:** Approved
**Scope:** Replace rule-based agent decisions with LLM reasoning, move simulation to real-time (1x)

---

## Context

The current agent system runs at 144x speed with purely rule-based decisions (probability dice rolls gated by activity curves, weather modifiers, and personality scores). This produces robotic behavior — agents don't reason about their situation, they just follow probability gates. Moving to real-time LLM-driven decisions creates agents that behave like actual people making contextual choices.

## Architecture Overview

Two loops run in parallel:

```
Server (Next.js API)                    Client (Browser)
┌──────────────────────┐               ┌──────────────────────┐
│  Decision Scheduler   │   SSE/poll   │  Web Worker (10Hz)   │
│  (every 10 min)       │──────────────│                      │
│                       │              │  moveAgent() physics  │
│  1. Collect state     │              │  detectPatterns()     │
│  2. Group by archetype│              │  computeStats()       │
│  3. Batch LLM calls   │              │  Render to map        │
│  4. Return decisions  │              │                      │
└──────────┬───────────┘               └──────────────────────┘
           │
┌──────────▼───────────┐
│   Claude Haiku API    │
│  (~12 parallel calls) │
└──────────────────────┘
```

- **Physics loop (client):** 10Hz tick rate, handles movement, rendering, pattern detection. Unchanged from current system.
- **Decision loop (server):** Every 10 real minutes, groups agents by archetype and makes batched LLM calls. Returns Decision objects identical to the current `decideAction()` output.

## Agent Grouping

Deterministic clustering based on structured persona attributes (no LLM needed for grouping):

```
Group key = occupation_bucket + neighborhood_quadrant + lifestyle_bucket
```

- **Occupation buckets (6):** office, service, gig, remote, retired, student
- **Neighborhood quadrants (4):** NW, NE, SW, SE of city bbox based on homeLat/homeLng
- **Lifestyle buckets (2):** social (extraversion > 0.6) vs reserved

**Max 48 groups, typically ~10-15 non-empty with ~6-10 agents each for a 94-agent city.**

Groups are computed once at simulation init and cached.

## Prompt Structure

Each group gets a batch prompt with shared prefix + per-agent dynamic state:

```
SHARED PREFIX (~200 tokens):
- Group archetype description (occupation, area, lifestyle tendencies)
- Current conditions (time, weather, traffic, nearby busy spots)
- Task instruction + output format (JSON array)

PER-AGENT BLOCKS (~80 tokens each):
- Current location and activity
- Last 3-5 actions (short-term memory)
- Nearby active friends from social graph
```

**Total per batch call:** ~200 + (80 × 8 agents) = ~840 input tokens
**Output per batch call:** ~200 tokens (JSON decisions for 8 agents)

## Short-Term Memory

Each agent maintains a rolling buffer of their last 5 actions:

```typescript
interface AgentMemory {
  actions: Array<{
    time: string;        // "12:30 PM"
    activity: string;    // "dining"
    location: string;    // "Cafe Villarias"
    duration: number;    // 45 minutes
  }>;
}
```

Stored server-side in an in-memory Map keyed by agent ID. Serialized into ~50-80 tokens per agent in the prompt. Enables sequential reasoning ("already ate lunch", "been at work since 8am").

## Decision API

**Route:** `POST /api/agents/decide/[slug]`

```typescript
// Request
{
  agents: AgentState[],
  personas: AgentPersona[],
  environment: CityEnvironment,
  memories: Record<string, AgentMemory>,
  simHour: number
}

// Response
{
  decisions: Decision[],       // one per agent needing a decision
  narratives?: string[]        // optional per-group narrative
}
```

**Flow:**
1. Filter to agents that need decisions (arrived + stay expired)
2. Group by cached archetype clusters
3. Build batch prompts per group
4. Fire all LLM calls in parallel (Promise.all)
5. Parse and validate JSON responses
6. Fallback to rule-based decideAction() if LLM fails or times out (>8s)

## Real-Time (1x Speed) Transition

| Parameter | Current (144x) | Real-Time (1x) |
|-----------|----------------|-----------------|
| speedFactor | 144 | 1 (locked) |
| simMinutesPerTick | 0.24 min | 0.00167 min |
| DECISION_INTERVAL | 60 ticks (6s real) | 6000 ticks (10 min real) |
| simHour initialization | Arbitrary | City timezone actual time |
| Speed controls | 4 buttons (1x-288x) | Removed |
| 1 real second = | 2.4 sim-minutes | 1 real second |

The simulation mirrors reality: if it's 2:35 PM in Mexico City, agents are making 2:35 PM decisions.

## Cost Estimation

```
94 agents / ~8 per group = ~12 groups
Decisions every 10 min = 6/hour
LLM calls: 12 groups x 6/hour = 72 calls/hour

Claude Haiku pricing:
  Input: ~840 tokens x $0.80/MTok = $0.00067/call
  Output: ~200 tokens x $4.00/MTok = $0.0008/call
  Per call: ~$0.0015
  Per hour: 72 x $0.0015 = $0.11/hour
  Per day: ~$2.60/day per city
```

## Fallback Strategy

If an LLM call fails (network error, timeout, malformed response):
1. Log the failure
2. Fall back to the existing rule-based `decideAction()` for that group
3. Retry LLM on the next decision cycle
4. No agent should ever be stuck waiting

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/app/api/agents/decide/[slug]/route.ts` | Create | Decision API endpoint |
| `src/lib/agent-grouping.ts` | Create | Archetype clustering logic |
| `src/lib/agent-prompts.ts` | Create | Prompt building and response parsing |
| `src/lib/agent-memory.ts` | Create | Short-term memory management |
| `src/lib/simulation-engine.ts` | Modify | Lock to 1x, adjust DECISION_INTERVAL, remove speed scaling |
| `src/workers/simulation-worker.ts` | Modify | Remove speed controls, add server decision intake |
| `src/hooks/useSimulation.ts` | Modify | Add server decision polling/SSE, remove speed state |
| `src/components/AgentSidebar.tsx` | Modify | Remove speed controls, add LLM status indicator |
| `src/components/CityMap.tsx` | Modify | Initialize simHour from real timezone |

## Verification

1. Open Mexico City at current local time -> agents start at contextually appropriate activities
2. Wait 10 minutes -> observe LLM decision cycle fire, agents change activities with reasoning
3. Check server logs -> ~12 parallel Haiku calls completing in <3 seconds
4. Kill network -> agents fall back to rule-based decisions, no freezing
5. Check cost -> ~$0.10-0.15 per hour in Anthropic dashboard
