import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentPersona,
  CityEnvironment,
  AgentMemory,
  ConversationLine,
} from "@/lib/agent-types";
import { formatMemoryForPrompt, formatSocialMemoryForPrompt } from "@/lib/agent-memory";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface ConverseRequest {
  participants: Array<{
    persona: AgentPersona;
    memory: AgentMemory;
  }>;
  environment: CityEnvironment;
  locationName: string;
  simHour: number;
}

const CONVERSE_SYSTEM = `Generate a realistic 3-5 line conversation between city residents who happen to be at the same location. Each person speaks in character based on their personality, occupation, and age. Topics emerge naturally from shared context: weather, transit conditions, what they've been doing, local events, or any recent environmental changes.

Return ONLY valid JSON with no markdown:
{"lines":[{"agentId":"...","text":"..."}],"topics":["weather","transit"]}

Keep dialogue natural, brief, and grounded in reality. No exposition — just natural speech. Do not use any emojis.`;

function formatTime(h: number): string {
  const hr = Math.floor(h);
  const min = Math.floor((h - hr) * 60);
  const period = hr >= 12 ? "PM" : "AM";
  const h12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
  return `${h12}:${min.toString().padStart(2, "0")} ${period}`;
}

export async function POST(request: NextRequest) {
  let body: ConverseRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { participants, environment, locationName, simHour } = body;

  if (!participants?.length || participants.length < 2) {
    return NextResponse.json({ error: "Need at least 2 participants" }, { status: 400 });
  }

  // Build context
  const envLines: string[] = [];
  envLines.push(`Time: ${formatTime(simHour)}`);
  envLines.push(`Location: ${locationName}`);
  envLines.push(`Weather: ${Math.round(environment.tempF)}°F${environment.isRaining ? ", raining" : ""}${environment.isSnowing ? ", snowing" : ""}`);
  if (environment.aqi > 100) envLines.push(`Air quality: AQI ${environment.aqi}`);
  if (environment.avgJamLevel > 2) envLines.push("Traffic: heavy congestion");
  if (environment.environmentChanges.length > 0) {
    envLines.push(`Recent events: ${environment.environmentChanges.slice(0, 3).map((c) => c.description).join("; ")}`);
  }
  if (environment.earthquakes.length > 0) {
    envLines.push(`Earthquake alert: ${environment.earthquakes[0].magnitude.toFixed(1)} near ${environment.earthquakes[0].place}`);
  }

  const participantDescs = participants.map(({ persona, memory }) => {
    const socialMem = formatSocialMemoryForPrompt(memory);
    return `- ${persona.name} (ID: ${persona.id}): ${persona.age}y, ${persona.occupation.replace(/_/g, " ")}, ` +
      `extraversion: ${persona.personality.extraversion.toFixed(1)}, ` +
      `recent: ${formatMemoryForPrompt(memory)}` +
      (socialMem ? `, heard: ${socialMem}` : "");
  }).join("\n");

  const prompt = `${envLines.join("\n")}\n\nPeople present:\n${participantDescs}\n\nGenerate their conversation.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: CONVERSE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(cleaned) as {
      lines: Array<{ agentId: string; text: string }>;
      topics: string[];
    };

    if (!Array.isArray(parsed.lines)) {
      return NextResponse.json({ error: "Invalid response format" }, { status: 500 });
    }

    // Map agent names onto lines
    const nameMap = new Map(participants.map(({ persona }) => [persona.id, persona.name]));
    const validIds = new Set(participants.map(({ persona }) => persona.id));

    const lines: ConversationLine[] = parsed.lines
      .filter((l) => validIds.has(l.agentId) && typeof l.text === "string")
      .map((l) => ({
        agentId: l.agentId,
        agentName: nameMap.get(l.agentId) ?? l.agentId,
        text: l.text,
      }));

    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.filter((t): t is string => typeof t === "string").slice(0, 5)
      : [];

    return NextResponse.json({ lines, topics });
  } catch (err) {
    console.error("[converse] failed:", err);
    return NextResponse.json({ error: "Conversation generation failed" }, { status: 500 });
  }
}
