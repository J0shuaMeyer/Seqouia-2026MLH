/**
 * Web Worker running the agent simulation loop at 10 Hz (real-time).
 * Decisions come from the server via LLM; this worker handles physics,
 * interactions, and pattern detection only.
 */
import type {
  AgentPersona,
  AgentState,
  CityEnvironment,
  SocialEdge,
  WorkerInMessage,
  WorkerOutMessage,
  SimTickResult,
  LLMDecision,
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

/* ── Constants ─────────────────────────────────────────────────── */

const SPEED_FACTOR = 1;          // Real-time: locked to 1x
const TICK_INTERVAL = 100;       // ms (10 Hz)

/** Degrees per tick per transport mode (calibrated at 144× speed) */
const SPEED_TABLE: Record<string, number> = {
  walking: 0.000006,
  cycling: 0.000018,
  transit: 0.000036,
  driving: 0.000048,
  stationary: 0,
};

/* ── State ──────────────────────────────────────────────────────── */

let personas: AgentPersona[] = [];
let agents: AgentState[] = [];
let environment: CityEnvironment = null!;
let bbox: [number, number, number, number] = [0, 0, 0, 0];
let adjacency: Map<string, SocialEdge[]> = new Map();
let simHour = 0;
let tick = 0;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

let prevStats: { drivingPct: number; transitPct: number; activePct: number } | null = null;
let prevPatternTypes = new Set<string>();

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
      // Rule-based initial placement while waiting for first LLM decisions
      makeDecisions(agents, personas, environment, simHour, adjacency);
      running = true;
      post({ type: "ready" });
      loop();
      break;

    case "updateEnvironment":
      environment = msg.environment;
      break;

    case "applyDecisions":
      applyLLMDecisions(msg.decisions);
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

/* ── Apply LLM Decisions ───────────────────────────────────────── */

function applyLLMDecisions(decisions: LLMDecision[]): void {
  for (const d of decisions) {
    const agent = agents.find((a) => a.id === d.agentId);
    if (!agent) continue;

    agent.activity = d.activity;
    agent.destination = { lat: d.destinationLat, lng: d.destinationLng };
    agent.transportMode = d.transportMode;
    agent.speed = SPEED_TABLE[d.transportMode] ?? 0;
    agent.ticksAtDest = 0;
    // Convert stayMinutes to ticks: minutes × 60 seconds × 10 ticks/sec
    agent.stayDuration = Math.round(d.stayMinutes * 60 * 10);

    // Snap inactive agents to home immediately
    if (d.activity === "sleeping" || d.activity === "home_active") {
      agent.lat = d.destinationLat;
      agent.lng = d.destinationLng;
      agent.arrivedAtDest = true;
    } else {
      agent.arrivedAtDest = false;
    }
  }
}

/* ── Main Loop ──────────────────────────────────────────────────── */

function loop(): void {
  if (!running) return;

  // Advance simulation at real-time speed
  simulateTick(agents, SPEED_FACTOR);
  tick++;
  simHour = (simHour + simMinutesPerTick(SPEED_FACTOR) / 60) % 24;

  // Update environment rush hour flag based on sim time
  environment.isRushHour =
    (simHour >= 7 && simHour <= 9) || (simHour >= 17 && simHour <= 19);

  // Local interactions and pattern detection at DECISION_INTERVAL
  // (Actual decisions come from the server via applyDecisions)
  if (tick % DECISION_INTERVAL === 0) {
    const grid = buildSpatialGrid(agents, bbox);
    resolveInteractions(agents, personas, grid, environment, adjacency);

    const patterns = detectPatterns(agents, personas, simHour, prevStats, grid, adjacency);

    const total = agents.length || 1;
    const active = agents.filter(
      (a) => a.activity !== "sleeping" && a.activity !== "home_active",
    );
    prevStats = {
      drivingPct: agents.filter((a) => a.transportMode === "driving").length / total,
      transitPct: agents.filter((a) => a.transportMode === "transit").length / total,
      activePct: active.length / total,
    };

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
