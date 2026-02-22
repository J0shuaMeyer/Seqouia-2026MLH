/**
 * Simulation Engine — pure math, no I/O, no DOM.
 * Safe for Web Worker import.
 */
import type {
  AgentPersona,
  AgentState,
  AgentActivity,
  TransportMode,
  CityEnvironment,
  EmergentPattern,
  SimTickResult,
} from "./agent-types";

/* ── Constants ──────────────────────────────────────────────────── */

/** Degrees per tick per transport mode (at 144× speed) */
const SPEED_TABLE: Record<TransportMode, number> = {
  walking: 0.000006,
  cycling: 0.000018,
  transit: 0.000036,
  driving: 0.000048,
  stationary: 0,
};

export const DECISION_INTERVAL = 60;   // ticks between agent re-evaluation
export const RENDER_INTERVAL = 5;      // ticks between GeoJSON updates
export const GRID_SIZE = 10;           // spatial grid cells per axis
const INTERACTION_RADIUS = 1;          // check ±1 grid cells (3×3 neighborhood)

/* ── Seeded PRNG (xoshiro128**) ─────────────────────────────────── */

let s0 = 123456789;
let s1 = 362436069;
let s2 = 521288629;
let s3 = 88675123;

export function seedRng(seed: number): void {
  s0 = seed | 0 || 123456789;
  s1 = (seed * 1103515245 + 12345) | 0 || 362436069;
  s2 = (s1 * 1103515245 + 12345) | 0 || 521288629;
  s3 = (s2 * 1103515245 + 12345) | 0 || 88675123;
}

function rand(): number {
  const t = s1 << 9;
  let r = s1 * 5;
  r = ((r << 7) | (r >>> 25)) * 9;
  s2 ^= s0;
  s3 ^= s1;
  s1 ^= s2;
  s0 ^= s3;
  s2 ^= t;
  s3 = (s3 << 11) | (s3 >>> 21);
  return (r >>> 0) / 4294967296;
}

/* ── Initialization ─────────────────────────────────────────────── */

export function initAgents(personas: AgentPersona[]): AgentState[] {
  return personas.map((p) => ({
    id: p.id,
    lat: p.homeLat,
    lng: p.homeLng,
    activity: "sleeping" as AgentActivity,
    destination: null,
    transportMode: "stationary" as TransportMode,
    heading: 0,
    speed: 0,
    arrivedAtDest: true,
    ticksAtDest: 0,
    stayDuration: 0,
  }));
}

/* ── Movement Physics ───────────────────────────────────────────── */

export function moveAgent(agent: AgentState): void {
  if (!agent.destination || agent.arrivedAtDest) return;

  const dx = agent.destination.lng - agent.lng;
  const dy = agent.destination.lat - agent.lat;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < agent.speed * 2) {
    agent.lat = agent.destination.lat;
    agent.lng = agent.destination.lng;
    agent.arrivedAtDest = true;
    agent.ticksAtDest = 0;
    agent.speed = 0;
    return;
  }

  agent.heading = Math.atan2(dx, dy) * (180 / Math.PI);
  if (agent.heading < 0) agent.heading += 360;
  agent.lat += (dy / dist) * agent.speed;
  agent.lng += (dx / dist) * agent.speed;
}

export function simulateTick(agents: AgentState[]): void {
  for (const agent of agents) {
    if (agent.arrivedAtDest) {
      agent.ticksAtDest++;
    } else {
      moveAgent(agent);
    }
  }
}

/* ── POI Selection ──────────────────────────────────────────────── */

type POI = CityEnvironment["pois"][number];

function selectNearestPOI(
  lat: number,
  lng: number,
  pois: POI[],
  categories: string[],
): { lat: number; lng: number } | null {
  let best: POI | null = null;
  let bestDist = Infinity;
  for (const p of pois) {
    if (categories.length > 0 && !categories.some((c) => p.category.includes(c))) continue;
    const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ? { lat: best.lat, lng: best.lng } : null;
}

function selectRandomPOI(
  pois: POI[],
  lat: number,
  lng: number,
  maxDist: number,
): { lat: number; lng: number } | null {
  const nearby = pois.filter(
    (p) => Math.abs(p.lat - lat) < maxDist && Math.abs(p.lng - lng) < maxDist,
  );
  if (nearby.length === 0) return null;
  const pick = nearby[Math.floor(rand() * nearby.length)];
  return { lat: pick.lat, lng: pick.lng };
}

/* ── Transport Mode Selection ───────────────────────────────────── */

function selectTransportMode(
  persona: AgentPersona,
  env: CityEnvironment,
): TransportMode {
  const scores: Record<string, number> = {
    driving: persona.carDependency * (1 + env.avgJamLevel * 0.1),
    transit: persona.transitAffinity * (env.hasTransit ? 1.0 : 0.1)
             * (env.isRushHour ? 1.3 : 0.9),
    cycling: persona.bikeAffinity * (env.hasBikeshare ? 1.0 : 0.3)
             * (env.isRaining ? 0.15 : 1.0)
             * (env.tempF < 32 ? 0.2 : 1.0),
    walking: (1 - persona.carDependency) * 0.5
             * (env.isRaining ? 0.3 : 1.0),
  };

  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  if (total === 0) return "walking";

  let roll = rand() * total;
  for (const [mode, score] of Object.entries(scores)) {
    roll -= score;
    if (roll <= 0) return mode as TransportMode;
  }
  return "walking";
}

/* ── Decision Algorithm ─────────────────────────────────────────── */

export function makeDecisions(
  agents: AgentState[],
  personas: AgentPersona[],
  env: CityEnvironment,
  simHour: number,
): void {
  const personaMap = new Map<string, AgentPersona>();
  for (const p of personas) personaMap.set(p.id, p);

  for (const agent of agents) {
    const persona = personaMap.get(agent.id);
    if (!persona) continue;

    // If still traveling, skip decision
    if (!agent.arrivedAtDest && agent.destination) continue;

    // If at destination and haven't stayed long enough, keep waiting
    if (agent.arrivedAtDest && agent.ticksAtDest < agent.stayDuration) continue;

    const decision = decideAction(agent, persona, env, simHour);
    agent.activity = decision.activity;
    agent.destination = decision.destination;
    agent.transportMode = decision.mode;
    agent.speed = SPEED_TABLE[decision.mode];
    agent.arrivedAtDest = decision.destination === null;
    agent.ticksAtDest = 0;
    agent.stayDuration = decision.stayDuration;
  }
}

interface Decision {
  activity: AgentActivity;
  destination: { lat: number; lng: number } | null;
  mode: TransportMode;
  stayDuration: number; // ticks to stay at destination
}

function decideAction(
  agent: AgentState,
  persona: AgentPersona,
  env: CityEnvironment,
  simHour: number,
): Decision {
  const hourIndex = Math.floor(simHour) % 24;
  const baseActivityProb = persona.activityCurve[hourIndex] ?? 0.3;

  // Weather modifier
  let weatherMod = 1.0;
  if (env.isRaining) weatherMod -= persona.weatherSensitivity * 0.5;
  if (env.isSnowing) weatherMod -= persona.weatherSensitivity * 0.7;
  if (env.tempF < 20) weatherMod -= persona.weatherSensitivity * 0.3;
  if (env.tempF > 105) weatherMod -= persona.weatherSensitivity * 0.3;
  weatherMod = Math.max(0.1, weatherMod);

  const effectiveProb = baseActivityProb * weatherMod;
  const isActive = rand() < effectiveProb;

  const home = { lat: persona.homeLat, lng: persona.homeLng };

  if (!isActive) {
    return {
      activity: simHour < 6 || simHour > 23 ? "sleeping" : "home_active",
      destination: home,
      mode: "stationary",
      stayDuration: Math.floor(DECISION_INTERVAL * (0.8 + rand() * 0.4)),
    };
  }

  const isCommuteHour = (simHour >= 6.5 && simHour <= 9.5) || (simHour >= 16.5 && simHour <= 19.5);
  const isLunchHour = simHour >= 11.5 && simHour <= 13.5;
  const isEveningHour = simHour >= 19 && simHour <= 23;

  // Commute check
  const nonCommuters = new Set(["retired", "remote_worker"]);
  const needsCommute =
    isCommuteHour &&
    !nonCommuters.has(persona.occupation) &&
    rand() > persona.commuteFlexibility * 0.5;

  if (needsCommute) {
    const dest = simHour < 12
      ? { lat: persona.workLat, lng: persona.workLng }
      : home;
    const mode = selectTransportMode(persona, env);
    return {
      activity: "commuting",
      destination: dest,
      mode,
      stayDuration: Math.floor(DECISION_INTERVAL * (3 + rand() * 5)), // stay at work/home
    };
  }

  // Lunch / dining
  if (isLunchHour && rand() < persona.socialActivity * 0.6) {
    const dest = selectNearestPOI(agent.lat, agent.lng, env.pois, ["restaurant", "cafe", "food"]);
    if (dest) {
      return {
        activity: "dining",
        destination: dest,
        mode: "walking",
        stayDuration: Math.floor(DECISION_INTERVAL * (1 + rand() * 2)),
      };
    }
  }

  // Evening social
  if (isEveningHour && rand() < persona.personality.extraversion * 0.7) {
    const dest = selectNearestPOI(agent.lat, agent.lng, env.pois, ["restaurant", "bar", "plaza", "entertainment"]);
    if (dest) {
      const mode = selectTransportMode(persona, env);
      return {
        activity: "socializing",
        destination: dest,
        mode,
        stayDuration: Math.floor(DECISION_INTERVAL * (2 + rand() * 3)),
      };
    }
  }

  // General leisure/errands
  if (rand() < persona.socialActivity * 0.4) {
    const dest = selectRandomPOI(env.pois, agent.lat, agent.lng, 0.02);
    if (dest) {
      const mode = selectTransportMode(persona, env);
      return {
        activity: rand() < 0.5 ? "leisure" : "errands",
        destination: dest,
        mode,
        stayDuration: Math.floor(DECISION_INTERVAL * (1 + rand() * 2)),
      };
    }
  }

  // Default: stay put
  return {
    activity: "home_active",
    destination: home,
    mode: "stationary",
    stayDuration: Math.floor(DECISION_INTERVAL * (1 + rand() * 1)),
  };
}

/* ── Spatial Grid ───────────────────────────────────────────────── */

export type SpatialGrid = Map<string, AgentState[]>;

export function buildSpatialGrid(
  agents: AgentState[],
  bbox: [number, number, number, number],
): SpatialGrid {
  const [south, west, north, east] = bbox;
  const cellW = (east - west) / GRID_SIZE;
  const cellH = (north - south) / GRID_SIZE;
  const grid: SpatialGrid = new Map();

  for (const agent of agents) {
    const cx = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((agent.lng - west) / cellW)));
    const cy = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((agent.lat - south) / cellH)));
    const key = `${cx},${cy}`;
    const arr = grid.get(key);
    if (arr) arr.push(agent);
    else grid.set(key, [agent]);
  }

  return grid;
}

function getNeighborAgents(
  grid: SpatialGrid,
  cx: number,
  cy: number,
): AgentState[] {
  const result: AgentState[] = [];
  for (let dx = -INTERACTION_RADIUS; dx <= INTERACTION_RADIUS; dx++) {
    for (let dy = -INTERACTION_RADIUS; dy <= INTERACTION_RADIUS; dy++) {
      const key = `${cx + dx},${cy + dy}`;
      const arr = grid.get(key);
      if (arr) result.push(...arr);
    }
  }
  return result;
}

/* ── Interaction Resolution ─────────────────────────────────────── */

export function resolveInteractions(
  agents: AgentState[],
  personas: AgentPersona[],
  grid: SpatialGrid,
  env: CityEnvironment,
): void {
  const personaMap = new Map<string, AgentPersona>();
  for (const p of personas) personaMap.set(p.id, p);

  for (const [key, cellAgents] of grid) {
    const [cxStr, cyStr] = key.split(",");
    const cx = Number(cxStr);
    const cy = Number(cyStr);
    const nearby = getNeighborAgents(grid, cx, cy);
    if (nearby.length < 2) continue;

    // Social clustering: high-extraversion agents attract others
    const socialAgents = nearby.filter((a) => {
      const p = personaMap.get(a.id);
      return p && p.personality.extraversion > 0.6 && a.activity !== "sleeping";
    });
    if (socialAgents.length >= 3 && socialAgents[0].destination) {
      const attractDest = socialAgents[0].destination;
      for (const agent of cellAgents) {
        if (agent.activity === "sleeping" || agent.activity === "commuting") continue;
        if (agent.arrivedAtDest && rand() < 0.15) {
          agent.destination = { ...attractDest };
          agent.arrivedAtDest = false;
          agent.speed = SPEED_TABLE[agent.transportMode];
        }
      }
    }

    // Congestion avoidance: too many drivers → some switch to transit
    const drivers = nearby.filter((a) => a.transportMode === "driving");
    if (drivers.length > 5 && env.avgJamLevel > 2) {
      for (const driver of drivers) {
        const p = personaMap.get(driver.id);
        if (p && p.personality.agreeableness > 0.5 && rand() < 0.2) {
          driver.transportMode = "transit";
          driver.speed = SPEED_TABLE.transit;
        }
      }
    }
  }
}

/* ── Pattern Detection ──────────────────────────────────────────── */

interface PrevStats {
  drivingPct: number;
  transitPct: number;
  activePct: number;
}

export function detectPatterns(
  agents: AgentState[],
  _personas: AgentPersona[],
  simHour: number,
  prevStats: PrevStats | null,
  grid: SpatialGrid,
): EmergentPattern[] {
  const patterns: EmergentPattern[] = [];
  const total = agents.length || 1;
  const active = agents.filter(
    (a) => a.activity !== "sleeping" && a.activity !== "home_active",
  );

  // 1. Cluster detection: 6+ active agents in a grid cell
  for (const [, cellAgents] of grid) {
    const cellActive = cellAgents.filter(
      (a) => a.activity !== "sleeping" && a.activity !== "home_active",
    );
    if (cellActive.length >= 6) {
      const latSum = cellActive.reduce((s, a) => s + a.lat, 0);
      const lngSum = cellActive.reduce((s, a) => s + a.lng, 0);
      patterns.push({
        type: "cluster",
        description: `${cellActive.length} citizens gathering`,
        location: { lat: latSum / cellActive.length, lng: lngSum / cellActive.length },
        agentCount: cellActive.length,
        confidence: Math.min(1, cellActive.length / 10),
        simHour,
      });
    }
  }

  // 2. Rush hour: >55% commuting
  const commutingPct = agents.filter((a) => a.activity === "commuting").length / total;
  if (commutingPct > 0.55) {
    patterns.push({
      type: "rush_hour",
      description: `${Math.round(commutingPct * 100)}% of citizens commuting`,
      location: null,
      agentCount: Math.round(commutingPct * total),
      confidence: commutingPct,
      simHour,
    });
  }

  // 3. Ghost town: <15% active during daytime
  if (simHour >= 8 && simHour <= 22) {
    const activePct = active.length / total;
    if (activePct < 0.15) {
      patterns.push({
        type: "ghost_town",
        description: `Only ${active.length} citizens outside`,
        location: null,
        agentCount: active.length,
        confidence: 1 - activePct,
        simHour,
      });
    }
  }

  // 4. Mode shift: >20% change in driving ratio
  if (prevStats) {
    const currentDrivingPct = agents.filter((a) => a.transportMode === "driving").length / total;
    const driveDelta = Math.abs(currentDrivingPct - prevStats.drivingPct);
    if (driveDelta > 0.20) {
      patterns.push({
        type: "mode_shift",
        description: `Transport shift: driving ${currentDrivingPct > prevStats.drivingPct ? "up" : "down"} ${Math.round(driveDelta * 100)}%`,
        location: null,
        agentCount: Math.round(currentDrivingPct * total),
        confidence: Math.min(1, driveDelta / 0.3),
        simHour,
      });
    }
  }

  // 5. Nightlife surge: after 20:00, >40% active at social/dining POIs
  if (simHour >= 20) {
    const nightlifeCount = agents.filter(
      (a) => a.activity === "socializing" || a.activity === "dining",
    ).length;
    const nightlifePct = nightlifeCount / Math.max(1, active.length);
    if (nightlifePct > 0.4) {
      patterns.push({
        type: "nightlife_surge",
        description: `${Math.round(nightlifePct * 100)}% of active citizens at social venues`,
        location: null,
        agentCount: nightlifeCount,
        confidence: nightlifePct,
        simHour,
      });
    }
  }

  return patterns;
}

/* ── Stats ──────────────────────────────────────────────────────── */

export function computeStats(agents: AgentState[]): SimTickResult["stats"] {
  let active = 0, sleeping = 0, driving = 0, transit = 0;
  let cycling = 0, walking = 0, atPOI = 0;

  for (const a of agents) {
    if (a.activity === "sleeping") { sleeping++; continue; }
    if (a.activity !== "home_active") active++;

    switch (a.transportMode) {
      case "driving": driving++; break;
      case "transit": transit++; break;
      case "cycling": cycling++; break;
      case "walking": walking++; break;
    }

    if (a.activity === "dining" || a.activity === "socializing" ||
        a.activity === "leisure" || a.activity === "errands" ||
        a.activity === "exercising") {
      atPOI++;
    }
  }

  return { active, sleeping, driving, transit, cycling, walking, atPOI };
}

/* ── Sim-hour helper ────────────────────────────────────────────── */

export function simMinutesPerTick(speedFactor: number): number {
  return (100 / 1000) * (speedFactor / 60);
}
