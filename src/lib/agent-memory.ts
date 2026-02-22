import type { AgentMemory, AgentMemoryEntry, SocialMemoryEntry } from "./agent-types";

const MAX_MEMORY = 5;
const MAX_SOCIAL_MEMORY = 3;

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
    mem = { agentId, actions: [], socialEvents: [] };
    store.set(agentId, mem);
  }
  // Backfill socialEvents for memories created before this field existed
  if (!mem.socialEvents) mem.socialEvents = [];
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

export function recordSocialEvent(
  store: Map<string, AgentMemory>,
  agentId: string,
  event: SocialMemoryEntry,
): void {
  const mem = getAgentMemory(store, agentId);
  mem.socialEvents.push(event);
  if (mem.socialEvents.length > MAX_SOCIAL_MEMORY) {
    mem.socialEvents.shift();
  }
}

/** Format memory for inclusion in LLM prompt */
export function formatMemoryForPrompt(mem: AgentMemory): string {
  if (mem.actions.length === 0) return "No recent activity recorded.";
  return mem.actions
    .map((a) => `${a.time}: ${a.activity} at ${a.locationName} (${a.durationMin}min)`)
    .join(" → ");
}

/** Format social memory for inclusion in LLM prompt */
export function formatSocialMemoryForPrompt(mem: AgentMemory): string {
  if (!mem.socialEvents || mem.socialEvents.length === 0) return "";
  return mem.socialEvents
    .map((e) => `${e.time}: ${e.summary} at ${e.locationName}`)
    .join("; ");
}
