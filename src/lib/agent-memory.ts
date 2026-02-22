import type { AgentMemory, AgentMemoryEntry } from "./agent-types";

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
