"use client";

import { useState } from "react";
import type { City } from "@/data/cities";
import type { SimulationControls, DecisionFeedEntry } from "@/hooks/useSimulation";
import type { AgentActivity, AgentPersona, AgentState } from "@/lib/agent-types";

interface AgentSidebarProps {
  city: City;
  simulation: SimulationControls;
  selectedAgentId: string | null;
  onDeselectAgent: () => void;
}

/* ── Helpers ────────────────────────────────────────────────────── */

function formatSimHour(h: number): string {
  const hours = Math.floor(h) % 24;
  const minutes = Math.round((h % 1) * 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function timeOfDay(h: number): string {
  if (h < 5) return "Late Night";
  if (h < 8) return "Early Morning";
  if (h < 12) return "Morning";
  if (h < 14) return "Midday";
  if (h < 17) return "Afternoon";
  if (h < 20) return "Evening";
  if (h < 23) return "Night";
  return "Late Night";
}

function computeMobilityIndex(
  stats: { active: number; sleeping: number; driving: number; transit: number; cycling: number; walking: number; atPOI: number },
  total: number,
): number {
  if (total === 0) return 0;
  const activePct = stats.active / total;
  const transitShare = total > 0 ? (stats.transit + stats.cycling + stats.walking) / Math.max(1, stats.driving + stats.transit + stats.cycling + stats.walking) : 0;
  const poiEngagement = stats.atPOI / total;
  return Math.round(
    Math.min(100, (activePct * 40 + transitShare * 35 + poiEngagement * 25) * 1.3),
  );
}

function mobilityColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 55) return "text-emerald-300/80";
  if (score >= 35) return "text-white/70";
  if (score >= 15) return "text-white/50";
  return "text-white/30";
}

function mobilityBarColor(score: number): string {
  if (score >= 75) return "#34d399";
  if (score >= 55) return "#6ee7b7";
  if (score >= 35) return "#9ca3af";
  return "#6b7280";
}

function activityEmoji(activity: AgentActivity): string {
  switch (activity) {
    case "sleeping": return "💤";
    case "commuting": return "🚌";
    case "working": return "💼";
    case "leisure": return "🎭";
    case "errands": return "🛒";
    case "dining": return "🍽";
    case "socializing": return "👥";
    case "exercising": return "🏃";
    case "home_active": return "🏠";
    default: return "📍";
  }
}

function activityColor(activity: AgentActivity): string {
  switch (activity) {
    case "commuting": return "#f59e0b";
    case "working": return "#60a5fa";
    case "socializing": case "dining": return "#c084fc";
    case "leisure": case "errands": case "exercising": return "#34d399";
    default: return "#6b7280";
  }
}

function timeAgo(timestamp: number): string {
  const sec = Math.floor((Date.now() - timestamp) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

const ACTIVITY_TIERS: {
  key: AgentActivity | "moving";
  label: string;
  color: string;
  match: (a: { activity: AgentActivity; transportMode: string }) => boolean;
}[] = [
  { key: "commuting", label: "Commuting", color: "#f59e0b", match: (a) => a.activity === "commuting" },
  { key: "working", label: "Working", color: "#60a5fa", match: (a) => a.activity === "working" },
  { key: "socializing", label: "Social", color: "#c084fc", match: (a) => a.activity === "socializing" || a.activity === "dining" },
  { key: "leisure", label: "Leisure", color: "#34d399", match: (a) => a.activity === "leisure" || a.activity === "errands" || a.activity === "exercising" },
  { key: "home_active", label: "At Home", color: "#6b7280", match: (a) => a.activity === "home_active" || a.activity === "sleeping" },
];

/* ── Subcomponents ──────────────────────────────────────────────── */

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-[10px] tracking-widest uppercase text-white/40 font-bold mb-3">
      {title}
    </p>
  );
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 h-[6px] bg-white/[0.06] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${Math.max(1, pct)}%`, backgroundColor: color }}
      />
    </div>
  );
}

/** Collapsible wrapper for stat sections */
function CollapsibleSection({ title, children, defaultOpen = false }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.06]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <p className="text-[10px] tracking-widest uppercase text-white/40 font-bold">
          {title}
        </p>
        <span className={`text-[10px] text-white/20 transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

/** Selected agent detail card */
function AgentDetail({ persona, state, reasoning, onClose }: {
  persona: AgentPersona;
  state: AgentState;
  reasoning: string | null;
  onClose: () => void;
}) {
  return (
    <div className="px-5 py-4 border-b border-white/[0.06]">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: activityColor(state.activity) }}
          />
          <div>
            <p className="text-[11px] text-white/80 font-medium">{persona.name}</p>
            <p className="text-[9px] text-white/30">
              {persona.age}y &middot; {persona.occupation.replace(/_/g, " ")}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-[10px] text-white/20 hover:text-white/50 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Current state */}
      <div className="bg-white/[0.03] rounded-lg p-3 space-y-1.5 mb-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Activity</span>
          <span className="text-[10px] text-white/60 capitalize">
            {activityEmoji(state.activity)} {state.activity.replace(/_/g, " ")}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Transport</span>
          <span className="text-[10px] text-white/60 capitalize">{state.transportMode}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Status</span>
          <span className="text-[10px] text-white/60">
            {state.arrivedAtDest ? "At destination" : "En route"}
          </span>
        </div>
      </div>

      {/* Personality traits */}
      <div className="space-y-1 mb-2">
        {[
          { label: "Open", value: persona.personality.openness },
          { label: "Extrav.", value: persona.personality.extraversion },
          { label: "Social", value: persona.socialActivity },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="text-[9px] text-white/25 w-12 shrink-0">{label}</span>
            <div className="flex-1 h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-white/15"
                style={{ width: `${Math.round(value * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* LLM reasoning */}
      {reasoning && (
        <div className="bg-amber-400/[0.04] border border-amber-400/10 rounded-lg p-2.5 mt-2">
          <p className="text-[9px] text-amber-400/40 uppercase tracking-wider mb-1 font-bold">LLM Reasoning</p>
          <p className="text-[10px] text-white/50 leading-relaxed">{reasoning}</p>
        </div>
      )}
    </div>
  );
}

/** Single feed entry */
function FeedItem({ entry }: { entry: DecisionFeedEntry }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span
        className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: activityColor(entry.activity) }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-[10px] text-white/60 font-medium truncate">
            {entry.agentName}
          </span>
          <span className="text-[9px] text-white/15 shrink-0">{timeAgo(entry.timestamp)}</span>
        </div>
        <p className="text-[9px] text-white/35 leading-snug truncate">
          {activityEmoji(entry.activity)} {entry.activity.replace(/_/g, " ")}
          {entry.destinationName ? ` → ${entry.destinationName}` : ""}
          {entry.transportMode !== "stationary" ? ` via ${entry.transportMode}` : ""}
        </p>
        {entry.reasoning && (
          <p className="text-[9px] text-white/20 leading-snug mt-0.5 line-clamp-2">
            {entry.reasoning}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────── */

export default function AgentSidebar({ city, simulation, selectedAgentId, onDeselectAgent }: AgentSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { tickResult, patterns, narrative, isRunning, simHour, personas, socialEdges, decisionFeed } = simulation;
  const total = personas?.length ?? 0;
  const stats = tickResult?.stats;
  const agents = tickResult?.agents ?? [];

  const mobilityIndex = stats ? computeMobilityIndex(stats, total) : 0;

  // Find selected agent's data
  const selectedPersona = selectedAgentId ? personas?.find((p) => p.id === selectedAgentId) : null;
  const selectedState = selectedAgentId ? agents.find((a) => a.id === selectedAgentId) : null;
  const selectedReasoning = selectedAgentId
    ? decisionFeed.find((d) => d.agentId === selectedAgentId)?.reasoning ?? null
    : null;

  // Activity tier percentages
  const tierData = ACTIVITY_TIERS.map((tier) => {
    const count = agents.filter(tier.match).length;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return { ...tier, count, pct };
  });

  // Occupation breakdown
  const occupationCounts = new Map<string, number>();
  for (const p of personas ?? []) {
    const occ = p.occupation.replace(/_/g, " ");
    occupationCounts.set(occ, (occupationCounts.get(occ) ?? 0) + 1);
  }
  const topOccupations = [...occupationCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed right-4 top-4 z-50 px-3 py-2 bg-black/70 backdrop-blur-sm border border-white/20 rounded-full text-[10px] tracking-widest text-white/60 hover:bg-white/10 hover:text-white/80 transition-all flex items-center gap-2"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
        &lsaquo; AGENTS
      </button>
    );
  }

  return (
    <aside className="fixed right-0 top-0 bottom-0 w-72 z-50 bg-black/80 backdrop-blur-md border-l border-white/[0.06] flex flex-col overflow-y-auto">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] tracking-[0.2em] uppercase font-bold text-white/80">
            Agent Simulation
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
              <span className="text-[9px] text-white/30">{isRunning ? "LIVE" : "PAUSED"}</span>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="text-white/25 hover:text-white/60 transition-colors text-sm"
              title="Collapse panel"
            >
              &rsaquo;
            </button>
          </div>
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <span className="text-2xl font-light text-white/90 tabular-nums tracking-tight">
            {formatSimHour(simHour)}
          </span>
          <span className="text-[10px] text-white/30">{timeOfDay(simHour)}</span>
          <span className="text-[10px] text-emerald-400/60 ml-auto flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />
            Live
          </span>
        </div>
      </div>

      {/* ── Loading skeleton ────────────────────────────────────── */}
      {!tickResult && (
        <div className="flex-1 px-5 py-6 space-y-5 animate-pulse">
          <div>
            <div className="h-2 w-20 bg-white/[0.06] rounded mb-3" />
            <div className="h-8 w-16 bg-white/[0.06] rounded mb-2" />
            <div className="h-1.5 w-full bg-white/[0.06] rounded-full" />
          </div>
          <div className="space-y-2">
            <div className="h-2 w-28 bg-white/[0.06] rounded mb-2" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-2 w-14 bg-white/[0.06] rounded" />
                <div className="flex-1 h-[6px] bg-white/[0.06] rounded-full" />
                <div className="h-2 w-6 bg-white/[0.06] rounded" />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-white/20 text-center pt-4">
            Initializing agent simulation...
          </p>
        </div>
      )}

      {tickResult && <>

      {/* ── Selected Agent Detail ───────────────────────────────── */}
      {selectedPersona && selectedState ? (
        <AgentDetail
          persona={selectedPersona}
          state={selectedState}
          reasoning={selectedReasoning}
          onClose={onDeselectAgent}
        />
      ) : (
        <div className="px-5 py-3 border-b border-white/[0.06]">
          <p className="text-[10px] text-white/20 italic text-center">
            Click an agent on the map to inspect
          </p>
        </div>
      )}

      {/* ── Activity Feed ───────────────────────────────────────── */}
      <div className="border-b border-white/[0.06]">
        <div className="px-5 pt-3 pb-1 flex items-center justify-between">
          <SectionHeader title="Activity Feed" />
          {decisionFeed.length > 0 && (
            <span className="text-[9px] text-white/15 -mt-2">{decisionFeed.length} decisions</span>
          )}
        </div>
        <div className="px-5 pb-3 max-h-48 overflow-y-auto">
          {decisionFeed.length > 0 ? (
            <div className="space-y-0.5 divide-y divide-white/[0.03]">
              {decisionFeed.slice(0, 20).map((entry, i) => (
                <FeedItem key={`${entry.agentId}-${entry.timestamp}-${i}`} entry={entry} />
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-white/20 italic text-center py-3">
              Waiting for LLM decisions...
            </p>
          )}
        </div>
      </div>

      {/* ── Mobility Index (compact) ────────────────────────────── */}
      <div className="px-5 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] tracking-widest uppercase text-white/40 font-bold">Mobility</span>
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-light tabular-nums ${mobilityColor(mobilityIndex)}`}>
              {mobilityIndex}
            </span>
            <span className="text-[9px] text-white/20">/100</span>
          </div>
        </div>
        <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{ width: `${mobilityIndex}%`, backgroundColor: mobilityBarColor(mobilityIndex) }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-white/15">{stats?.active ?? 0}/{total} active</span>
          <span className="text-[9px] text-white/15">{stats?.atPOI ?? 0} at venues</span>
        </div>
      </div>

      {/* ── Collapsible Stats ───────────────────────────────────── */}

      <CollapsibleSection title="Activity Distribution" defaultOpen>
        <div className="space-y-2">
          {tierData.map(({ label, color, pct }) => (
            <div key={label} className="flex items-center gap-2.5">
              <span className="text-[10px] text-white/50 w-16 shrink-0">{label}</span>
              <MiniBar pct={pct} color={color} />
              <span className="text-[10px] text-white/40 tabular-nums w-7 text-right shrink-0">{pct}%</span>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Transport Mode">
        <div className="space-y-2">
          {[
            { label: "Driving", count: stats?.driving ?? 0, color: "#f59e0b" },
            { label: "Transit", count: stats?.transit ?? 0, color: "#a78bfa" },
            { label: "Cycling", count: stats?.cycling ?? 0, color: "#a3e635" },
            { label: "Walking", count: stats?.walking ?? 0, color: "#ffffff" },
          ].map(({ label, count, color }) => {
            const moving = (stats?.driving ?? 0) + (stats?.transit ?? 0) + (stats?.cycling ?? 0) + (stats?.walking ?? 0);
            const pct = moving > 0 ? Math.round((count / moving) * 100) : 0;
            return (
              <div key={label} className="flex items-center gap-2.5">
                <div className="flex items-center gap-1.5 w-16 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color, opacity: 0.8 }} />
                  <span className="text-[10px] text-white/50">{label}</span>
                </div>
                <MiniBar pct={pct} color={color} />
                <span className="text-[10px] text-white/40 tabular-nums w-7 text-right shrink-0">{pct}%</span>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      {socialEdges.length > 0 && (
        <CollapsibleSection title="Social Network">
          {(() => {
            const activeIds = new Set(
              agents.filter((a) => a.activity !== "sleeping" && a.activity !== "home_active").map((a) => a.id),
            );
            const relCounts: Record<string, number> = { family: 0, coworker: 0, friend: 0, acquaintance: 0 };
            let activeConnections = 0;
            for (const e of socialEdges) {
              relCounts[e.relationship]++;
              if (activeIds.has(e.source) && activeIds.has(e.target)) activeConnections++;
            }
            const activeAgentCount = activeIds.size;
            const avgDegree = activeAgentCount > 0
              ? ((activeConnections * 2) / activeAgentCount).toFixed(1) : "0";
            const RELATION_COLORS: Record<string, string> = {
              family: "#f472b6", coworker: "#60a5fa", friend: "#a78bfa", acquaintance: "#6b7280",
            };
            return (
              <>
                <div className="flex items-baseline justify-between mb-3">
                  <span className="text-[10px] text-white/50">
                    {activeConnections} active
                    <span className="text-white/25"> / {socialEdges.length} total</span>
                  </span>
                  <span className="text-[10px] text-white/30 tabular-nums">{avgDegree} avg</span>
                </div>
                <div className="space-y-2">
                  {(["family", "coworker", "friend", "acquaintance"] as const).map((rel) => {
                    const pct = socialEdges.length > 0 ? Math.round((relCounts[rel] / socialEdges.length) * 100) : 0;
                    return (
                      <div key={rel} className="flex items-center gap-2.5">
                        <div className="flex items-center gap-1.5 w-20 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: RELATION_COLORS[rel], opacity: 0.8 }} />
                          <span className="text-[10px] text-white/50 capitalize">{rel}</span>
                        </div>
                        <MiniBar pct={pct} color={RELATION_COLORS[rel]} />
                        <span className="text-[10px] text-white/40 tabular-nums w-7 text-right shrink-0">{relCounts[rel]}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </CollapsibleSection>
      )}

      {patterns.length > 0 && (
        <CollapsibleSection title="Detected Patterns">
          <div className="space-y-2">
            {patterns.slice(0, 4).map((p, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-0.5 w-1 h-1 rounded-full bg-white/30 shrink-0" />
                <div>
                  <span className="text-[10px] text-white/60 leading-snug block">{p.description}</span>
                  <span className="text-[9px] text-white/20">{Math.round(p.confidence * 100)}% confidence</span>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Insights">
        {narrative ? (
          <p className="text-[11px] text-white/55 leading-relaxed">{narrative}</p>
        ) : (
          <p className="text-[11px] text-white/25 leading-relaxed italic">Observing patterns...</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Population Profile">
        <div className="space-y-2">
          {topOccupations.map(([occ, count]) => {
            const pct = Math.round((count / total) * 100);
            return (
              <div key={occ} className="flex items-center justify-between">
                <span className="text-[10px] text-white/50 capitalize">{occ}</span>
                <span className="text-[10px] text-white/30 tabular-nums">{pct}%</span>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      {/* close tickResult guard */}
      </>}

      {/* ── Controls ──────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-white/[0.06] shrink-0">
        <div className="flex gap-1">
          <button
            onClick={isRunning ? simulation.pause : simulation.resume}
            className="flex-1 text-[9px] py-1.5 rounded bg-white/[0.03] border border-white/[0.06] text-white/35 hover:bg-white/[0.06] hover:text-white/50 transition-all"
          >
            {isRunning ? "Pause" : "Resume"}
          </button>
          <button
            onClick={simulation.reset}
            className="flex-1 text-[9px] py-1.5 rounded bg-white/[0.03] border border-white/[0.06] text-white/35 hover:bg-white/[0.06] hover:text-white/50 transition-all"
          >
            Reset
          </button>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <div className="mt-auto px-5 py-3 shrink-0">
        <p className="text-[9px] text-white/15">
          {total} agents &middot; {city.name}
        </p>
      </div>
    </aside>
  );
}
