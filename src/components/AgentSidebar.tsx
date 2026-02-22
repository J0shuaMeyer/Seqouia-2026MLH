"use client";

import { useState } from "react";
import type { City } from "@/data/cities";
import type { SimulationControls } from "@/hooks/useSimulation";
import type { AgentActivity, SocialEdge } from "@/lib/agent-types";

interface AgentSidebarProps {
  city: City;
  simulation: SimulationControls;
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

/** Compute a 0-100 "Mobility Index" from the simulation state */
function computeMobilityIndex(
  stats: { active: number; sleeping: number; driving: number; transit: number; cycling: number; walking: number; atPOI: number },
  total: number,
): number {
  if (total === 0) return 0;
  const activePct = stats.active / total;
  const transitShare = total > 0 ? (stats.transit + stats.cycling + stats.walking) / Math.max(1, stats.driving + stats.transit + stats.cycling + stats.walking) : 0;
  const poiEngagement = stats.atPOI / total;

  // Weighted formula: 40% activity, 35% sustainable transport, 25% POI engagement
  return Math.round(
    Math.min(100, (activePct * 40 + transitShare * 35 + poiEngagement * 25) * 1.3),
  );
}

function mobilityLabel(score: number): string {
  if (score >= 75) return "Very High";
  if (score >= 55) return "High";
  if (score >= 35) return "Moderate";
  if (score >= 15) return "Low";
  return "Very Low";
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

/** Activity tiers, inspired by Artificial Societies' tier breakdown */
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

/* ── Main Component ─────────────────────────────────────────────── */

export default function AgentSidebar({ city, simulation }: AgentSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { tickResult, patterns, narrative, isRunning, simHour, speed, personas, socialEdges } = simulation;
  const total = personas?.length ?? 0;
  const stats = tickResult?.stats;
  const agents = tickResult?.agents ?? [];

  const mobilityIndex = stats ? computeMobilityIndex(stats, total) : 0;

  // Compute activity tier percentages
  const tierData = ACTIVITY_TIERS.map((tier) => {
    const count = agents.filter(tier.match).length;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return { ...tier, count, pct };
  });

  // Compute occupation breakdown from personas
  const occupationCounts = new Map<string, number>();
  for (const p of personas ?? []) {
    const occ = p.occupation.replace(/_/g, " ");
    occupationCounts.set(occ, (occupationCounts.get(occ) ?? 0) + 1);
  }
  const topOccupations = [...occupationCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Personality averages from personas
  const avgPersonality = personas && personas.length > 0
    ? {
        openness: personas.reduce((s, p) => s + p.personality.openness, 0) / personas.length,
        extraversion: personas.reduce((s, p) => s + p.personality.extraversion, 0) / personas.length,
        neuroticism: personas.reduce((s, p) => s + p.personality.neuroticism, 0) / personas.length,
      }
    : null;

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

      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
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
          <span className="text-[10px] text-white/20 ml-auto">{speed}x</span>
        </div>
      </div>

      {/* ── Mobility Index (hero metric) ─────────────────────────── */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <SectionHeader title="Mobility Index" />
        <div className="flex items-baseline justify-between">
          <span className={`text-[10px] font-medium ${mobilityColor(mobilityIndex)}`}>
            {mobilityLabel(mobilityIndex)}
          </span>
          <div className="flex items-baseline gap-0.5">
            <span className={`text-3xl font-light tabular-nums ${mobilityColor(mobilityIndex)}`}>
              {mobilityIndex}
            </span>
            <span className="text-xs text-white/25">/ 100</span>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${mobilityIndex}%`,
              backgroundColor: mobilityBarColor(mobilityIndex),
            }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px] text-white/20">{stats?.active ?? 0} of {total} active</span>
          <span className="text-[9px] text-white/20">{stats?.atPOI ?? 0} at venues</span>
        </div>
      </div>

      {/* ── Activity Distribution (tiered breakdown) ─────────────── */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <SectionHeader title="Activity Distribution" />
        <div className="space-y-2">
          {tierData.map(({ label, color, pct }) => (
            <div key={label} className="flex items-center gap-2.5">
              <span className="text-[10px] text-white/50 w-16 shrink-0">{label}</span>
              <MiniBar pct={pct} color={color} />
              <span className="text-[10px] text-white/40 tabular-nums w-7 text-right shrink-0">
                {pct}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Transport Mode Mix ───────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <SectionHeader title="Transport Mode" />
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
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: color, opacity: 0.8 }}
                  />
                  <span className="text-[10px] text-white/50">{label}</span>
                </div>
                <MiniBar pct={pct} color={color} />
                <span className="text-[10px] text-white/40 tabular-nums w-7 text-right shrink-0">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Social Network ───────────────────────────────────────── */}
      {socialEdges.length > 0 && (
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <SectionHeader title="Social Network" />
          {(() => {
            const relCounts: Record<string, number> = { family: 0, coworker: 0, friend: 0, acquaintance: 0 };
            for (const e of socialEdges) relCounts[e.relationship]++;
            const avgDegree = total > 0 ? ((socialEdges.length * 2) / total).toFixed(1) : "0";

            const RELATION_COLORS: Record<string, string> = {
              family: "#f472b6",
              coworker: "#60a5fa",
              friend: "#a78bfa",
              acquaintance: "#6b7280",
            };

            return (
              <>
                <div className="flex items-baseline justify-between mb-3">
                  <span className="text-[10px] text-white/50">{socialEdges.length} connections</span>
                  <span className="text-[10px] text-white/30 tabular-nums">{avgDegree} avg/agent</span>
                </div>
                <div className="space-y-2">
                  {(["family", "coworker", "friend", "acquaintance"] as const).map((rel) => {
                    const pct = socialEdges.length > 0 ? Math.round((relCounts[rel] / socialEdges.length) * 100) : 0;
                    return (
                      <div key={rel} className="flex items-center gap-2.5">
                        <div className="flex items-center gap-1.5 w-20 shrink-0">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: RELATION_COLORS[rel], opacity: 0.8 }}
                          />
                          <span className="text-[10px] text-white/50 capitalize">{rel}</span>
                        </div>
                        <MiniBar pct={pct} color={RELATION_COLORS[rel]} />
                        <span className="text-[10px] text-white/40 tabular-nums w-7 text-right shrink-0">
                          {relCounts[rel]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Detected Patterns ────────────────────────────────────── */}
      {patterns.length > 0 && (
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <SectionHeader title="Detected Patterns" />
          <div className="space-y-2">
            {patterns.slice(0, 4).map((p, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-0.5 w-1 h-1 rounded-full bg-white/30 shrink-0" />
                <div>
                  <span className="text-[10px] text-white/60 leading-snug block">
                    {p.description}
                  </span>
                  <span className="text-[9px] text-white/20">
                    {Math.round(p.confidence * 100)}% confidence
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Insights (AI narrative) ──────────────────────────────── */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <SectionHeader title="Insights" />
        {narrative ? (
          <p className="text-[11px] text-white/55 leading-relaxed">
            {narrative}
          </p>
        ) : (
          <p className="text-[11px] text-white/25 leading-relaxed italic">
            Observing patterns...
          </p>
        )}
      </div>

      {/* ── Population Profile ────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <SectionHeader title="Population Profile" />
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
        {avgPersonality && (
          <div className="mt-3 pt-3 border-t border-white/[0.04] space-y-1.5">
            <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1">Avg Personality</p>
            {[
              { label: "Openness", value: avgPersonality.openness },
              { label: "Extraversion", value: avgPersonality.extraversion },
              { label: "Neuroticism", value: avgPersonality.neuroticism },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[9px] text-white/35 w-20 shrink-0">{label}</span>
                <div className="flex-1 h-[4px] bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-white/20 transition-all duration-700"
                    style={{ width: `${Math.round(value * 100)}%` }}
                  />
                </div>
                <span className="text-[9px] text-white/25 tabular-nums w-6 text-right">
                  {(value * 100).toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Controls ──────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <SectionHeader title="Controls" />
        {/* Speed */}
        <div className="flex gap-1">
          {[1, 72, 144, 288].map((s) => (
            <button
              key={s}
              onClick={() => simulation.setSpeed(s)}
              className={`flex-1 text-[9px] py-1.5 rounded transition-all ${
                speed === s
                  ? "bg-white/10 text-white/80 border border-white/20"
                  : "bg-white/[0.03] text-white/25 border border-white/[0.06] hover:bg-white/[0.06] hover:text-white/40"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
        {/* Play / Pause / Reset */}
        <div className="mt-2 flex gap-1">
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
      <div className="mt-auto px-5 py-3">
        <p className="text-[9px] text-white/15">
          {total} agents &middot; {city.name}
        </p>
      </div>
    </aside>
  );
}
