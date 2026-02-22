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
    const life = p.personality.extraversion > 0.6 ? "social" : "reserved";
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
