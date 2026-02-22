import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { EmergentPattern } from "@/lib/agent-types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_INSTRUCTION = `You are Sequoia's urban intelligence engine observing simulated citizen behavior. In exactly 2 sentences, explain what the detected patterns mean for the city right now. Be specific — reference the time, weather, or infrastructure that's driving the behavior. Write as a calm, analytical urban observer.`;

interface NarrateRequest {
  city: string;
  simHour: number;
  patterns: EmergentPattern[];
  weather: { tempF: number; isRaining: boolean; isSnowing: boolean };
  stats?: {
    active: number;
    sleeping: number;
    driving: number;
    transit: number;
    cycling: number;
    walking: number;
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as NarrateRequest;
    const { city, simHour, patterns, weather, stats } = body;

    if (!patterns?.length) {
      return NextResponse.json({ narrative: null });
    }

    const hour = Math.floor(simHour);
    const minute = Math.round((simHour % 1) * 60);
    const timeStr = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;

    const weatherDesc = weather.isSnowing
      ? "snowing"
      : weather.isRaining
        ? "raining"
        : `${weather.tempF}°F`;

    const patternList = patterns.map((p) => `- ${p.type}: ${p.description}`).join("\n");

    const modeDistribution = stats
      ? `${stats.driving} driving, ${stats.transit} transit, ${stats.cycling} cycling, ${stats.walking} walking`
      : "unknown";

    const prompt = `Observing ${city} at ${timeStr} local time.

CONDITIONS: ${weatherDesc}
ACTIVE CITIZENS: ${stats?.active ?? "unknown"}

PATTERNS DETECTED:
${patternList}

MODE DISTRIBUTION: ${modeDistribution}`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: SYSTEM_INSTRUCTION,
      messages: [
        { role: "user", content: prompt },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const narrative = textBlock?.text?.trim() || null;

    return NextResponse.json({ narrative });
  } catch (err) {
    console.error("[narrate] Claude call failed:", err);
    return NextResponse.json({ narrative: null }, { status: 200 });
  }
}
