import type {
  AgentPersona,
  AgentState,
  AgentActivity,
  TransportMode,
  CityEnvironment,
  SocialEdge,
  LLMDecision,
  AgentMemory,
} from "./agent-types";
import { formatMemoryForPrompt, getAgentMemory } from "./agent-memory";
import type { AgentGroup } from "./agent-grouping";

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

function findNearbyActiveFriends(
  agentId: string,
  agents: AgentState[],
  socialEdges: SocialEdge[],
): string[] {
  const names: string[] = [];
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  for (const edge of socialEdges) {
    const peerId = edge.source === agentId ? edge.target
                 : edge.target === agentId ? edge.source
                 : null;
    if (!peerId || edge.strength < 0.4) continue;

    const peer = agentMap.get(peerId);
    if (peer && peer.activity !== "sleeping" && peer.activity !== "home_active") {
      names.push(peerId);
    }
  }
  return names.slice(0, 3);
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

    const mem = getAgentMemory(memoryStore, agentId);
    const friends = findNearbyActiveFriends(agentId, agents, socialEdges);

    prompt += `
- ${persona.name} (ID: ${agentId})
  Age: ${persona.age}, Occupation: ${persona.occupation.replace(/_/g, " ")}
  Home: (${persona.homeLat.toFixed(4)}, ${persona.homeLng.toFixed(4)})
  Work: (${persona.workLat.toFixed(4)}, ${persona.workLng.toFixed(4)})
  Currently at: (${state.lat.toFixed(4)}, ${state.lng.toFixed(4)}), doing: ${state.activity}
  Recent history: ${formatMemoryForPrompt(mem)}
  ${friends.length > 0 ? `Active friends nearby: ${friends.join(", ")}` : "No friends currently active nearby"}
`;
  }

  prompt += `\nReturn a JSON array with one decision per agent listed above.`;
  return prompt;
}

/** Parse and validate LLM response into typed decisions */
export function parseDecisions(raw: string, validAgentIds: Set<string>): LLMDecision[] {
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
