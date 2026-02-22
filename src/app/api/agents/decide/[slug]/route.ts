import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCityBySlug } from "@/data/cities";
import type {
  AgentPersona,
  AgentState,
  CityEnvironment,
  LLMDecision,
  SocialEdge,
} from "@/lib/agent-types";
import { buildAgentGroups } from "@/lib/agent-grouping";
import { buildGroupPrompt, parseDecisions, DECISION_SYSTEM_PROMPT } from "@/lib/agent-prompts";
import { getMemoryStore, recordAction, recordSocialEvent } from "@/lib/agent-memory";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface DecideRequest {
  agents: AgentState[];
  personas: AgentPersona[];
  environment: CityEnvironment;
  socialEdges: SocialEdge[];
  simHour: number;
  urgentContext?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);
  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }

  let body: DecideRequest & { socialMemory?: {
    participantIds: string[];
    participantNames: string[];
    topics: string[];
    locationName: string;
    simHour: number;
  } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Handle social memory recording (lightweight path)
  if (request.headers.get("X-Social-Memory") === "true" && body.socialMemory) {
    const memoryStore = getMemoryStore(slug);
    const sm = body.socialMemory;
    const timeStr = formatSimHour(sm.simHour);
    const topicStr = sm.topics.join(", ") || "general chat";
    for (const agentId of sm.participantIds) {
      const otherNames = sm.participantNames.filter(
        (_, i) => sm.participantIds[i] !== agentId,
      );
      recordSocialEvent(memoryStore, agentId, {
        time: timeStr,
        participants: otherNames,
        topics: sm.topics,
        summary: `Talked with ${otherNames.join(" and ")} about ${topicStr}`,
        locationName: sm.locationName,
      });
    }
    return NextResponse.json({ ok: true });
  }

  const { agents, personas, environment, socialEdges, simHour, urgentContext } = body;

  if (!agents?.length || !personas?.length) {
    return NextResponse.json({ error: "Missing agents or personas" }, { status: 400 });
  }

  const personaMap = new Map(personas.map((p) => [p.id, p]));
  const memoryStore = getMemoryStore(slug);
  const groups = buildAgentGroups(personas, city.bbox);

  // Build prompts only for groups with agents needing decisions
  const groupPrompts: Array<{ prompt: string; agentIds: string[] }> = [];

  for (const group of groups) {
    const needsDecision = group.agentIds.filter((id) => {
      const a = agents.find((ag) => ag.id === id);
      if (!a) return false;
      // Skip agents still traveling or still staying
      if (!a.arrivedAtDest && a.destination) return false;
      if (a.arrivedAtDest && a.ticksAtDest < a.stayDuration) return false;
      return true;
    });

    if (needsDecision.length === 0) continue;

    const prompt = buildGroupPrompt(
      { ...group, agentIds: needsDecision },
      personaMap,
      agents,
      memoryStore,
      environment,
      socialEdges,
      simHour,
      city.name,
      urgentContext,
    );

    groupPrompts.push({ prompt, agentIds: needsDecision });
  }

  if (groupPrompts.length === 0) {
    return NextResponse.json({ decisions: [] });
  }

  // Fire all LLM calls in parallel
  const allDecisions: LLMDecision[] = [];

  const results = await Promise.allSettled(
    groupPrompts.map(async ({ prompt, agentIds }) => {
      try {
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: urgentContext ? 512 : 1024,
          system: DECISION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });

        const text = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");

        return parseDecisions(text, new Set(agentIds));
      } catch (err) {
        console.error(`[decide] LLM call failed:`, err);
        return [];
      }
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      allDecisions.push(...result.value);
    }
  }

  // Record decisions in agent memory
  const timeStr = formatSimHour(simHour);
  for (const d of allDecisions) {
    recordAction(memoryStore, d.agentId, {
      time: timeStr,
      activity: d.activity,
      locationName: d.destinationName,
      lat: d.destinationLat,
      lng: d.destinationLng,
      durationMin: d.stayMinutes,
    });
  }

  return NextResponse.json({ decisions: allDecisions });
}

function formatSimHour(h: number): string {
  const hr = Math.floor(h);
  const min = Math.floor((h - hr) * 60);
  const period = hr >= 12 ? "PM" : "AM";
  const h12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
  return `${h12}:${min.toString().padStart(2, "0")} ${period}`;
}
