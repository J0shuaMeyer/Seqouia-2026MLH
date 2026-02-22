/** Big Five personality traits — each 0.0 to 1.0 */
export interface Personality {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export type OccupationType =
  | "office_worker" | "service_industry" | "student" | "teacher"
  | "healthcare" | "retail" | "construction" | "tech_worker"
  | "gig_driver" | "retired" | "remote_worker" | "government";

/** Static persona — generated once by Claude, immutable during simulation */
export interface AgentPersona {
  id: string;
  name: string;
  age: number;
  occupation: OccupationType;
  homeLat: number;
  homeLng: number;
  workLat: number;
  workLng: number;
  personality: Personality;
  transitAffinity: number;
  bikeAffinity: number;
  carDependency: number;
  weatherSensitivity: number;
  socialActivity: number;
  commuteFlexibility: number;
  /** 24 values (index 0 = midnight), each 0.0–1.0 */
  activityCurve: number[];
}

export type AgentActivity =
  | "sleeping" | "commuting" | "working" | "leisure"
  | "errands" | "dining" | "socializing" | "exercising"
  | "home_active";

export type TransportMode =
  | "walking" | "driving" | "transit" | "cycling" | "stationary";

/** Mutable agent state — updated every simulation tick */
export interface AgentState {
  id: string;
  lat: number;
  lng: number;
  activity: AgentActivity;
  destination: { lat: number; lng: number } | null;
  transportMode: TransportMode;
  heading: number;
  speed: number;
  arrivedAtDest: boolean;
  ticksAtDest: number;
  stayDuration: number;
}

/* ── Short-Term Memory ─────────────────────────────────────── */

/** Single remembered action — stored server-side */
export interface AgentMemoryEntry {
  time: string;
  activity: AgentActivity;
  locationName: string;
  lat: number;
  lng: number;
  durationMin: number;
}

export interface AgentMemory {
  agentId: string;
  actions: AgentMemoryEntry[];
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

/* ── Social Network Graph ──────────────────────────────────── */

export type RelationshipType = "family" | "coworker" | "friend" | "acquaintance";

export interface SocialEdge {
  source: string;
  target: string;
  relationship: RelationshipType;
  /** 0.0–1.0 influence weight */
  strength: number;
}

export interface SocialGraph {
  edges: SocialEdge[];
  adjacency: Map<string, SocialEdge[]>;
}

/** Detected emergent pattern */
export interface EmergentPattern {
  type: "cluster" | "mode_shift" | "rush_hour" | "ghost_town"
      | "weather_exodus" | "nightlife_surge" | "congestion_avoidance"
      | "social_clustering" | "information_cascade";
  description: string;
  location: { lat: number; lng: number } | null;
  agentCount: number;
  confidence: number;
  simHour: number;
}

/** Environment data structured for the simulation worker */
export interface CityEnvironment {
  tempF: number;
  weatherCode: number;
  isRaining: boolean;
  isSnowing: boolean;
  aqi: number;
  alertCount: number;
  avgJamLevel: number;
  trafficHotspots: { lat: number; lng: number; level: number }[];
  hasTransit: boolean;
  hasBikeshare: boolean;
  isRushHour: boolean;
  pois: { lat: number; lng: number; category: string; activity: number }[];
  bikeStations: { lat: number; lng: number; available: number }[];
  upiScore: number;
}

/** Full simulation state transferred from Worker to Main */
export interface SimTickResult {
  tick: number;
  simHour: number;
  agents: AgentState[];
  patterns: EmergentPattern[];
  stats: {
    active: number;
    sleeping: number;
    driving: number;
    transit: number;
    cycling: number;
    walking: number;
    atPOI: number;
  };
}

/* ── Worker message protocol ────────────────────────────────── */

export type WorkerInMessage =
  | { type: "init"; personas: AgentPersona[]; environment: CityEnvironment;
      bbox: [number, number, number, number]; startHour: number;
      socialEdges: SocialEdge[] }
  | { type: "updateEnvironment"; environment: CityEnvironment }
  | { type: "applyDecisions"; decisions: LLMDecision[] }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset"; startHour: number };

export type WorkerOutMessage =
  | { type: "tick"; result: SimTickResult }
  | { type: "pattern"; patterns: EmergentPattern[] }
  | { type: "ready" }
  | { type: "error"; message: string };
