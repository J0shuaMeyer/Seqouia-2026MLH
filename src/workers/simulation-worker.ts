/**
 * Web Worker running the agent simulation loop at 10 Hz.
 * Communicates with main thread via postMessage.
 */
import type {
  AgentPersona,
  AgentState,
  CityEnvironment,
  SocialEdge,
  WorkerInMessage,
  WorkerOutMessage,
  SimTickResult,
} from "../lib/agent-types";
import {
  initAgents,
  simulateTick,
  makeDecisions,
  resolveInteractions,
  detectPatterns,
  buildSpatialGrid,
  computeStats,
  simMinutesPerTick,
  seedRng,
  DECISION_INTERVAL,
  RENDER_INTERVAL,
} from "../lib/simulation-engine";
import { buildAdjacency } from "../lib/social-graph";

/* ── State ──────────────────────────────────────────────────────── */

let personas: AgentPersona[] = [];
let agents: AgentState[] = [];
let environment: CityEnvironment = null!;
let bbox: [number, number, number, number] = [0, 0, 0, 0];
let adjacency: Map<string, SocialEdge[]> = new Map();
let simHour = 0;
let speedFactor = 144;
let tick = 0;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

let prevStats: { drivingPct: number; transitPct: number; activePct: number } | null = null;
let prevPatternTypes = new Set<string>();

const TICK_INTERVAL = 100; // ms (10 Hz)

/* ── Message Handler ────────────────────────────────────────────── */

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      personas = msg.personas;
      environment = msg.environment;
      bbox = msg.bbox;
      adjacency = buildAdjacency(msg.socialEdges ?? []);
      simHour = msg.startHour;
      tick = 0;
      prevStats = null;
      prevPatternTypes.clear();
      seedRng(Date.now());
      agents = initAgents(personas);
      makeDecisions(agents, personas, environment, simHour, adjacency);
      running = true;
      post({ type: "ready" });
      loop();
      break;

    case "updateEnvironment":
      environment = msg.environment;
      break;

    case "setSpeed":
      speedFactor = msg.factor;
      break;

    case "pause":
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      break;

    case "resume":
      if (!running) { running = true; loop(); }
      break;

    case "reset":
      simHour = msg.startHour;
      tick = 0;
      prevStats = null;
      prevPatternTypes.clear();
      agents = initAgents(personas);
      makeDecisions(agents, personas, environment, simHour, adjacency);
      break;
  }
};

/* ── Main Loop ──────────────────────────────────────────────────── */

function loop(): void {
  if (!running) return;

  // Advance simulation
  simulateTick(agents);
  tick++;
  simHour = (simHour + simMinutesPerTick(speedFactor) / 60) % 24;

  // Update environment rush hour flag based on sim time
  environment.isRushHour =
    (simHour >= 7 && simHour <= 9) || (simHour >= 17 && simHour <= 19);

  // Agent decisions at DECISION_INTERVAL
  if (tick % DECISION_INTERVAL === 0) {
    makeDecisions(agents, personas, environment, simHour, adjacency);

    const grid = buildSpatialGrid(agents, bbox);
    resolveInteractions(agents, personas, grid, environment, adjacency);

    const patterns = detectPatterns(agents, personas, simHour, prevStats, grid, adjacency);

    // Update prevStats for next comparison
    const total = agents.length || 1;
    const active = agents.filter(
      (a) => a.activity !== "sleeping" && a.activity !== "home_active",
    );
    prevStats = {
      drivingPct: agents.filter((a) => a.transportMode === "driving").length / total,
      transitPct: agents.filter((a) => a.transportMode === "transit").length / total,
      activePct: active.length / total,
    };

    // Post patterns if any new types appeared
    if (patterns.length > 0) {
      const newTypes = patterns.filter((p) => !prevPatternTypes.has(p.type));
      if (newTypes.length > 0 || patterns.length !== prevPatternTypes.size) {
        post({ type: "pattern", patterns });
      }
      prevPatternTypes = new Set(patterns.map((p) => p.type));
    } else {
      prevPatternTypes.clear();
    }
  }

  // Post tick result at RENDER_INTERVAL
  if (tick % RENDER_INTERVAL === 0) {
    const stats = computeStats(agents);
    const result: SimTickResult = {
      tick,
      simHour,
      agents: agents.map((a) => ({ ...a })),
      patterns: [],
      stats,
    };
    post({ type: "tick", result });
  }

  timer = setTimeout(loop, TICK_INTERVAL);
}

/* ── Typed postMessage ──────────────────────────────────────────── */

function post(msg: WorkerOutMessage): void {
  (self as unknown as { postMessage(msg: WorkerOutMessage): void }).postMessage(msg);
}
