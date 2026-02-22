"use client";

import { useState, useEffect, useMemo } from "react";
import type { City } from "@/data/cities";
import type { SimulationControls, DecisionFeedEntry } from "@/hooks/useSimulation";
import type { AgentActivity, AgentConversation, AgentPersona, AgentState } from "@/lib/agent-types";

interface AgentSidebarProps {
  city: City;
  simulation: SimulationControls;
  selectedAgentId: string | null;
  onDeselectAgent: () => void;
}

type TabId = "overview" | "feed" | "agent";

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

const TRANSPORT_MODES = [
  { label: "Driving", key: "driving" as const, color: "#f59e0b" },
  { label: "Transit", key: "transit" as const, color: "#a78bfa" },
  { label: "Walking", key: "walking" as const, color: "#ffffff" },
  { label: "Cycling", key: "cycling" as const, color: "#a3e635" },
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

/** Single conversation card */
function ConversationCard({ conv, variant = "default" }: { conv: AgentConversation; variant?: "default" | "feed" }) {
  const timeStr = formatSimHour(conv.simHour);
  return (
    <div className={`${variant === "feed" ? "bg-purple-400/[0.03]" : "bg-white/[0.02]"} rounded-lg p-2.5 space-y-1.5`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-white/40">
          [{timeStr}] {conv.locationName} ({conv.participantNames.length} agents)
        </span>
        <span className="text-[9px] text-white/15">{timeAgo(conv.timestamp)}</span>
      </div>
      <div className="space-y-1">
        {conv.lines.map((line, i) => (
          <div key={i} className="flex gap-1.5">
            <span className="text-[10px] text-purple-300/60 font-medium shrink-0">{line.agentName}:</span>
            <span className="text-[10px] text-white/45 leading-snug">&ldquo;{line.text}&rdquo;</span>
          </div>
        ))}
      </div>
      {conv.topics.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {conv.topics.map((t, i) => (
            <span key={i} className="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-400/10 text-purple-300/40">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Selected agent detail card */
function AgentDetail({ persona, state, reasoning, conversations, onBack }: {
  persona: AgentPersona;
  state: AgentState;
  reasoning: string | null;
  conversations: AgentConversation[];
  onBack: () => void;
}) {
  return (
    <div className="p-5 space-y-3">
      {/* Back / Deselect bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
        >
          &larr; Back
        </button>
        <button
          onClick={onBack}
          className="text-[10px] text-white/20 hover:text-white/50 transition-colors"
        >
          &#10005; Deselect
        </button>
      </div>

      {/* Agent name + persona */}
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: activityColor(state.activity) }}
        />
        <div>
          <p className="text-[11px] text-white/80 font-medium">
            {persona.name}, {persona.age}
          </p>
          <p className="text-[9px] text-white/30">
            {persona.occupation.replace(/_/g, " ")}
          </p>
        </div>
      </div>

      {/* Current state */}
      <div className="bg-white/[0.03] rounded-lg p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Activity</span>
          <span className="text-[10px] text-white/60 capitalize">
            {state.activity.replace(/_/g, " ")}
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
      <div>
        <SectionHeader title="Personality" />
        <div className="space-y-1">
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
              <span className="text-[9px] text-white/25 tabular-nums w-7 text-right">{Math.round(value * 100)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* LLM reasoning */}
      {reasoning && (
        <div>
          <SectionHeader title="LLM Reasoning" />
          <div className="bg-amber-400/[0.04] border border-amber-400/10 rounded-lg p-2.5">
            <p className="text-[10px] text-white/50 leading-relaxed">{reasoning}</p>
          </div>
        </div>
      )}

      {/* Recent conversations for this agent */}
      {conversations.length > 0 && (
        <div>
          <SectionHeader title="Recent Conversations" />
          <div className="space-y-1.5">
            {conversations.slice(0, 2).map((conv) => (
              <ConversationCard key={conv.id} conv={conv} />
            ))}
          </div>
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
          {entry.activity.replace(/_/g, " ")}
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
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { tickResult, patterns, narrative, isRunning, simHour, personas, decisionFeed, conversations } = simulation;
  const total = personas?.length ?? 0;
  const stats = tickResult?.stats;
  const agents = tickResult?.agents ?? [];

  const mobilityIndex = stats ? computeMobilityIndex(stats, total) : 0;

  // Auto-switch to Agent tab when an agent is selected from the map
  useEffect(() => {
    if (selectedAgentId) setActiveTab("agent");
  }, [selectedAgentId]);

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

  // Transport mode percentages
  const transportData = useMemo(() => {
    const moving = (stats?.driving ?? 0) + (stats?.transit ?? 0) + (stats?.cycling ?? 0) + (stats?.walking ?? 0);
    return TRANSPORT_MODES.map(({ label, key, color }) => {
      const count = stats?.[key] ?? 0;
      const pct = moving > 0 ? Math.round((count / moving) * 100) : 0;
      return { label, color, pct };
    });
  }, [stats]);

  // Unified feed: merge decisions + conversations by timestamp
  type FeedEntry =
    | { type: "decision"; data: DecisionFeedEntry; ts: number }
    | { type: "conversation"; data: AgentConversation; ts: number };

  const mergedFeed = useMemo(() => {
    const items: FeedEntry[] = [
      ...decisionFeed.map((d) => ({ type: "decision" as const, data: d, ts: d.timestamp })),
      ...conversations.map((c) => ({ type: "conversation" as const, data: c, ts: c.timestamp })),
    ];
    return items.sort((a, b) => b.ts - a.ts).slice(0, 30);
  }, [decisionFeed, conversations]);

  // Agent list sorted: active first, sleeping last
  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      const aAsleep = a.activity === "sleeping" || a.activity === "home_active" ? 1 : 0;
      const bAsleep = b.activity === "sleeping" || b.activity === "home_active" ? 1 : 0;
      return aAsleep - bAsleep;
    });
  }, [agents]);

  /* ── Collapsed state ─────────────────────────────────────────── */

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

  /* ── Tab content renderers ───────────────────────────────────── */

  const renderOverview = () => (
    <div className="px-5 py-4 space-y-4">
      {/* Mobility Index */}
      <div>
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

      {/* Activity Distribution */}
      <div>
        <SectionHeader title="Activity" />
        <div className="space-y-2">
          {tierData.map(({ label, color, pct }) => (
            <div key={label} className="flex items-center gap-2.5">
              <span className="text-[10px] text-white/50 w-16 shrink-0">{label}</span>
              <MiniBar pct={pct} color={color} />
              <span className="text-[10px] text-white/40 tabular-nums w-7 text-right shrink-0">{pct}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Transport Mode — compact 2x2 grid */}
      <div>
        <SectionHeader title="Transport" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {transportData.map(({ label, pct, color }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color, opacity: 0.8 }} />
              <span className="text-[10px] text-white/50">{label}</span>
              <span className="text-[10px] text-white/40 tabular-nums ml-auto">{pct}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Narrative Insight */}
      <div className="bg-white/[0.03] rounded-lg p-3">
        <p className="text-[11px] text-white/55 leading-relaxed line-clamp-3">
          {narrative ?? <span className="italic text-white/25">Observing patterns...</span>}
        </p>
      </div>

      {/* Detected Patterns */}
      {patterns.length > 0 && (
        <div>
          <SectionHeader title="Patterns" />
          <div className="space-y-1">
            {patterns.slice(0, 3).map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-white/50 leading-snug">
                  &middot; {p.description}
                </span>
                <span className="text-[9px] text-white/25 tabular-nums shrink-0">
                  {Math.round(p.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderFeed = () => (
    <div className="flex-1 overflow-y-auto">
      <div className="px-5 pt-3 pb-1 flex items-center justify-between">
        <SectionHeader title="Feed" />
        <span className="text-[9px] text-white/15 -mt-2">{mergedFeed.length} items</span>
      </div>
      <div className="px-5 pb-4">
        {mergedFeed.length > 0 ? (
          <div className="space-y-2">
            {mergedFeed.map((entry, i) =>
              entry.type === "decision" ? (
                <FeedItem
                  key={`d-${entry.data.agentId}-${entry.ts}-${i}`}
                  entry={entry.data}
                />
              ) : (
                <ConversationCard
                  key={`c-${entry.data.id}`}
                  conv={entry.data}
                  variant="feed"
                />
              ),
            )}
          </div>
        ) : (
          <p className="text-[10px] text-white/20 italic text-center py-6">
            Waiting for agent activity...
          </p>
        )}
      </div>
    </div>
  );

  const renderAgent = () => {
    // Mode B: Agent selected → detail view
    if (selectedPersona && selectedState) {
      return (
        <div className="flex-1 overflow-y-auto">
          <AgentDetail
            persona={selectedPersona}
            state={selectedState}
            reasoning={selectedReasoning}
            conversations={conversations.filter((c) => c.participantIds.includes(selectedAgentId!))}
            onBack={onDeselectAgent}
          />
        </div>
      );
    }

    // Mode A: No agent selected → agent list
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-3 pb-1 flex items-center justify-between">
          <SectionHeader title="Agents" />
          <span className="text-[9px] text-white/15 -mt-2">{agents.length}</span>
        </div>
        <div className="px-2 pb-4">
          {sortedAgents.length > 0 ? (
            sortedAgents.map((agent) => {
              const persona = personas?.find((p) => p.id === agent.id);
              const isInactive = agent.activity === "sleeping" || agent.activity === "home_active";
              return (
                <button
                  key={agent.id}
                  onClick={() => {
                    // Parent handles selectedAgentId via map; but we can trigger it
                    // by simulating agent selection — for now, just show the detail
                    // The onDeselectAgent prop only clears, so we need a way to select
                    // We'll dispatch a custom event the parent CityMap listens for
                    const event = new CustomEvent("agent-sidebar-select", { detail: agent.id });
                    window.dispatchEvent(event);
                  }}
                  className={`w-full flex items-center justify-between hover:bg-white/[0.04] cursor-pointer rounded-lg px-3 py-1.5 transition-colors ${isInactive ? "opacity-40" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: activityColor(agent.activity) }}
                    />
                    <span className="text-[10px] text-white/60">
                      {persona?.name ?? agent.id.slice(0, 8)}
                    </span>
                  </div>
                  <span className="text-[10px] text-white/30 capitalize">
                    {agent.activity.replace(/_/g, " ")}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="text-[10px] text-white/20 italic text-center py-6 px-3">
              No agents initialized yet
            </p>
          )}
        </div>
      </div>
    );
  };

  /* ── Render ───────────────────────────────────────────────────── */

  const TABS: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "feed", label: "Feed" },
    { id: "agent", label: "Agent" },
  ];

  return (
    <aside className="fixed right-0 top-0 bottom-0 w-72 z-50 bg-black/80 backdrop-blur-md border-l border-white/[0.06] flex flex-col">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-3 border-b border-white/[0.06] shrink-0">
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

      {/* ── Tab Bar ─────────────────────────────────────────────── */}
      <div className="flex border-b border-white/[0.06] shrink-0">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 py-2.5 text-[10px] uppercase tracking-widest transition-colors border-b-2 ${
              activeTab === id
                ? "text-white/80 border-emerald-400"
                : "text-white/30 border-transparent hover:text-white/50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ─────────────────────────────────────────── */}
      {!tickResult ? (
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
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          {activeTab === "overview" && renderOverview()}
          {activeTab === "feed" && renderFeed()}
          {activeTab === "agent" && renderAgent()}
        </div>
      )}

      {/* ── Controls ──────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-t border-white/[0.06] shrink-0">
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
      <div className="px-5 py-3 shrink-0">
        <p className="text-[9px] text-white/15">
          {total} agents &middot; {city.name}
        </p>
      </div>
    </aside>
  );
}
