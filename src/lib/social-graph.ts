/**
 * Social Network Graph — deterministic construction from persona data.
 * Produces a small-world graph (high clustering + short average path)
 * that exhibits six-degrees-of-separation dynamics.
 *
 * No I/O, no LLM calls — pure math. Safe for main thread or worker.
 */
import type { AgentPersona, SocialEdge, SocialGraph } from "./agent-types";

/* ── Seeded PRNG (separate from simulation engine to keep deterministic) ── */

let _s0 = 987654321;
let _s1 = 123456789;

function seedGraphRng(seed: number): void {
  _s0 = seed | 0 || 987654321;
  _s1 = (seed * 1103515245 + 12345) | 0 || 123456789;
}

function gRand(): number {
  _s1 ^= _s1 << 13;
  _s1 ^= _s1 >> 17;
  _s1 ^= _s1 << 5;
  _s0 = (_s0 + _s1) | 0;
  return (_s0 >>> 0) / 4294967296;
}

/* ── Helpers ──────────────────────────────────────────────────── */

function geoDist(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = a.lng - b.lng;
  const dy = a.lat - b.lat;
  return Math.sqrt(dx * dx + dy * dy);
}

function personalitySimilarity(a: AgentPersona, b: AgentPersona): number {
  const traits: (keyof AgentPersona["personality"])[] = [
    "openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism",
  ];
  let sumSq = 0;
  for (const t of traits) {
    const diff = a.personality[t] - b.personality[t];
    sumSq += diff * diff;
  }
  return 1 - Math.sqrt(sumSq / traits.length);
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/* ── Graph Construction ───────────────────────────────────────── */

export function buildSocialGraph(personas: AgentPersona[]): SocialGraph {
  seedGraphRng(personas.length * 7919 + 42);

  const edges: SocialEdge[] = [];
  const seen = new Set<string>();

  function addEdge(
    source: string,
    target: string,
    relationship: SocialEdge["relationship"],
    strength: number,
  ): boolean {
    const key = edgeKey(source, target);
    if (seen.has(key) || source === target) return false;
    seen.add(key);
    edges.push({ source, target, relationship, strength });
    return true;
  }

  // Step 1: Family clusters — agents sharing home neighborhood
  const homeBuckets = new Map<string, AgentPersona[]>();
  for (const p of personas) {
    const key = `${Math.round(p.homeLat * 200)},${Math.round(p.homeLng * 200)}`;
    const arr = homeBuckets.get(key);
    if (arr) arr.push(p);
    else homeBuckets.set(key, [p]);
  }

  for (const bucket of homeBuckets.values()) {
    if (bucket.length < 2) continue;
    // Within each home-neighborhood bucket, connect up to 4 agents as family
    const familyGroup = bucket.slice(0, 4);
    for (let i = 0; i < familyGroup.length; i++) {
      for (let j = i + 1; j < familyGroup.length; j++) {
        addEdge(familyGroup[i].id, familyGroup[j].id, "family", 0.8 + gRand() * 0.2);
      }
    }
  }

  // If few family edges formed, create some by pairing agents with close homes and similar ages
  const familyCount = edges.filter((e) => e.relationship === "family").length;
  const targetFamilyEdges = Math.floor(personas.length * 0.3);
  if (familyCount < targetFamilyEdges) {
    const sorted = [...personas].sort((a, b) => a.homeLat - b.homeLat);
    for (let i = 0; i < sorted.length - 1 && edges.filter((e) => e.relationship === "family").length < targetFamilyEdges; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (geoDist(
        { lat: a.homeLat, lng: a.homeLng },
        { lat: b.homeLat, lng: b.homeLng },
      ) < 0.005 && Math.abs(a.age - b.age) < 25) {
        addEdge(a.id, b.id, "family", 0.8 + gRand() * 0.2);
      }
    }
  }

  // Step 2: Coworker links — same occupation + nearby work location
  const occBuckets = new Map<string, AgentPersona[]>();
  for (const p of personas) {
    const arr = occBuckets.get(p.occupation);
    if (arr) arr.push(p);
    else occBuckets.set(p.occupation, [p]);
  }

  for (const group of occBuckets.values()) {
    if (group.length < 2) continue;
    const coworkerLinks = new Map<string, number>();

    for (let i = 0; i < group.length; i++) {
      if ((coworkerLinks.get(group[i].id) ?? 0) >= 3) continue;
      for (let j = i + 1; j < group.length; j++) {
        if ((coworkerLinks.get(group[j].id) ?? 0) >= 3) continue;
        const dist = geoDist(
          { lat: group[i].workLat, lng: group[i].workLng },
          { lat: group[j].workLat, lng: group[j].workLng },
        );
        if (dist < 0.01) {
          if (addEdge(group[i].id, group[j].id, "coworker", 0.5 + gRand() * 0.2)) {
            coworkerLinks.set(group[i].id, (coworkerLinks.get(group[i].id) ?? 0) + 1);
            coworkerLinks.set(group[j].id, (coworkerLinks.get(group[j].id) ?? 0) + 1);
          }
        }
      }
    }
  }

  // Step 3: Friend links — personality-driven homophily within spatial radius
  for (let i = 0; i < personas.length; i++) {
    const a = personas[i];
    const maxFriends = Math.floor(1 + a.personality.extraversion * 4);
    const candidates: { idx: number; score: number }[] = [];

    for (let j = 0; j < personas.length; j++) {
      if (i === j) continue;
      const b = personas[j];
      const dist = geoDist(
        { lat: a.homeLat, lng: a.homeLng },
        { lat: b.homeLat, lng: b.homeLng },
      );
      if (dist > 0.03) continue;
      const sim = personalitySimilarity(a, b);
      candidates.push({ idx: j, score: sim });
    }

    candidates.sort((x, y) => y.score - x.score);
    let added = 0;
    for (const c of candidates) {
      if (added >= maxFriends) break;
      if (addEdge(a.id, personas[c.idx].id, "friend", 0.4 + gRand() * 0.2)) {
        added++;
      }
    }
  }

  // Step 4: Acquaintance bridges (Watts-Strogatz weak ties)
  // These long-range links create the small-world / six-degrees property
  for (const p of personas) {
    const bridgeCount = 2 + Math.floor(gRand() * 2); // 2-3 bridges
    for (let b = 0; b < bridgeCount; b++) {
      const targetIdx = Math.floor(gRand() * personas.length);
      const target = personas[targetIdx];
      addEdge(p.id, target.id, "acquaintance", 0.1 + gRand() * 0.2);
    }
  }

  return {
    edges,
    adjacency: buildAdjacency(edges),
  };
}

/** Reconstruct adjacency map from flat edge array (used after postMessage) */
export function buildAdjacency(edges: SocialEdge[]): Map<string, SocialEdge[]> {
  const adj = new Map<string, SocialEdge[]>();
  for (const e of edges) {
    let arr = adj.get(e.source);
    if (!arr) { arr = []; adj.set(e.source, arr); }
    arr.push(e);

    let arr2 = adj.get(e.target);
    if (!arr2) { arr2 = []; adj.set(e.target, arr2); }
    arr2.push(e);
  }
  return adj;
}

/** Get the other agent ID from an edge */
export function edgePeer(edge: SocialEdge, selfId: string): string {
  return edge.source === selfId ? edge.target : edge.source;
}
