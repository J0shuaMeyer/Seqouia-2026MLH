import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCityBySlug } from "@/data/cities";
import type { AgentPersona, OccupationType } from "@/lib/agent-types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_INSTRUCTION = `You are a sociologist and urban planner specializing in computational social science. You create realistic, diverse citizen profiles calibrated to specific cities' infrastructure, culture, and demographics.

CRITICAL: You MUST respond with ONLY a valid JSON array. No markdown, no code fences, no explanation — just the raw JSON array starting with [ and ending with ]. Every number field must be a number (not a string).`;

function buildPrompt(city: ReturnType<typeof getCityBySlug> & object, agentCount: number, batchIndex: number): string {
  return `Generate ${agentCount} diverse citizen personas for ${city.name}, ${city.country}. This is batch ${batchIndex + 1}.

CITY INFRASTRUCTURE:
- Population: ${city.population.toLocaleString()} (metro area)
- Walk Score: ${city.walkScore}/100 (higher = more walkable, pedestrian-friendly)
- Vehicles per 1000 residents: ${city.vehiclesPer1000}
- Average commute: ${city.avgCommuteMin} minutes one-way
- Bike share: ${city.bikeNetwork ? "Available" : "Not available"}
- Public transit: ${city.transitType || "Limited/informal"}
- Coastal: ${city.isCoastal ? "Yes — port and waterfront activity" : "No"}
- Area: ${city.areaSqMi} sq mi | Density: ${Math.round(city.population / city.areaSqMi)} per sq mi
- Bounding box: lat [${city.bbox[0]}, ${city.bbox[2]}], lng [${city.bbox[1]}, ${city.bbox[3]}]

CALIBRATION RULES:
1. transitAffinity should be HIGHER when walkScore > 70 or transit exists
2. carDependency should be HIGHER when vehiclesPer1000 > 300
3. bikeAffinity should be HIGHER when bikeNetwork exists AND walkScore > 60
4. weatherSensitivity correlates with neuroticism (r ~ 0.7)
5. socialActivity correlates with extraversion (r ~ 0.8)
6. commuteFlexibility: remote_worker/retired = 0.8-1.0, office_worker = 0.1-0.3, gig_driver = 0.6-0.9, student = 0.4-0.7
7. All home/work coordinates MUST fall within the bounding box
8. Names must be culturally appropriate for ${city.country}

OCCUPATION DISTRIBUTION (approximate):
- 25% office_worker/tech_worker/government
- 20% service_industry/retail
- 15% student
- 10% gig_driver
- 10% healthcare/teacher
- 10% construction/remote_worker
- 10% retired

EACH PERSONA must have these exact fields:
{
  "name": "string",
  "age": integer 18-80,
  "occupation": one of ["office_worker","service_industry","student","teacher","healthcare","retail","construction","tech_worker","gig_driver","retired","remote_worker","government"],
  "homeLat": number within bbox lat range,
  "homeLng": number within bbox lng range,
  "workLat": number within bbox lat range,
  "workLng": number within bbox lng range,
  "personality": {
    "openness": 0.0-1.0,
    "conscientiousness": 0.0-1.0,
    "extraversion": 0.0-1.0,
    "agreeableness": 0.0-1.0,
    "neuroticism": 0.0-1.0
  },
  "transitAffinity": 0.0-1.0,
  "bikeAffinity": 0.0-1.0,
  "carDependency": 0.0-1.0,
  "weatherSensitivity": 0.0-1.0,
  "socialActivity": 0.0-1.0,
  "commuteFlexibility": 0.0-1.0,
  "activityCurve": [24 numbers, each 0.0-1.0, index 0 = midnight]
}

ACTIVITY CURVE GUIDELINES:
- office_worker: low 0-6, ramp 6-8, high 8-17, ramp down 17-19, moderate 19-22, low 22-24
- service_industry: low 0-8, ramp 8-10, high 10-22, ramp down 22-24
- student: low 0-7, moderate 7-15, variable 15-23, low 23-24
- retired: low 0-7, ramp 7-9, moderate 9-17, low 17-24
- gig_driver: bimodal peaks at 7-9 and 17-21
- healthcare: can be any shift

Generate exactly ${agentCount} personas as a JSON array. Ensure diversity in age, personality, and spatial distribution. Output ONLY the JSON array, nothing else.`;
}

/** Max personas per batch — keeps output well within Haiku's 8192 token limit */
const BATCH_SIZE = 20;

/** In-memory cache — survives across requests on the same server instance */
const personaCache = new Map<string, { data: AgentPersona[]; ts: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }

  // Return cached personas if available
  const cached = personaCache.get(slug);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  const totalAgents = Math.max(10, Math.min(150, Math.round(city.population / 250_000)));

  try {
    // Split into batches to stay within output token limits
    const batches: number[] = [];
    let remaining = totalAgents;
    while (remaining > 0) {
      const batchSize = Math.min(BATCH_SIZE, remaining);
      batches.push(batchSize);
      remaining -= batchSize;
    }

    // Run all batches in parallel for faster generation
    const batchResults = await Promise.all(
      batches.map(async (batchSize, i) => {
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8192,
          system: SYSTEM_INSTRUCTION,
          messages: [
            { role: "user", content: buildPrompt(city, batchSize, i) },
          ],
        });

        const textBlock = message.content.find((b) => b.type === "text");
        let rawText = textBlock?.text ?? "[]";

        // Strip markdown code fences if present
        rawText = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

        // Handle truncated JSON — if stop_reason is max_tokens, try to salvage
        if (message.stop_reason === "end_turn") {
          return JSON.parse(rawText) as Array<Record<string, unknown>>;
        } else {
          const lastBracket = rawText.lastIndexOf("}");
          if (lastBracket > 0) {
            const salvaged = rawText.slice(0, lastBracket + 1) + "]";
            try {
              return JSON.parse(salvaged) as Array<Record<string, unknown>>;
            } catch {
              console.warn(`[generate] Batch ${i} truncated and unsalvageable, skipping`);
              return [];
            }
          }
          return [];
        }
      }),
    );

    const allRaw = batchResults.flat();

    if (allRaw.length === 0) {
      return NextResponse.json(
        { error: "No personas generated — model returned empty or unparseable output" },
        { status: 500 },
      );
    }

    // Assign IDs and clamp values
    const personas: AgentPersona[] = allRaw.map((r, i) => ({
      id: `${slug}-${i.toString().padStart(3, "0")}`,
      name: String(r.name || `Citizen ${i}`),
      age: Math.max(18, Math.min(80, Number(r.age) || 30)),
      occupation: (r.occupation as OccupationType) || "office_worker",
      homeLat: Number(r.homeLat),
      homeLng: Number(r.homeLng),
      workLat: Number(r.workLat),
      workLng: Number(r.workLng),
      personality: {
        openness: clamp01(r.personality as Record<string, number>, "openness"),
        conscientiousness: clamp01(r.personality as Record<string, number>, "conscientiousness"),
        extraversion: clamp01(r.personality as Record<string, number>, "extraversion"),
        agreeableness: clamp01(r.personality as Record<string, number>, "agreeableness"),
        neuroticism: clamp01(r.personality as Record<string, number>, "neuroticism"),
      },
      transitAffinity: clamp(Number(r.transitAffinity) || 0.5),
      bikeAffinity: clamp(Number(r.bikeAffinity) || 0.3),
      carDependency: clamp(Number(r.carDependency) || 0.5),
      weatherSensitivity: clamp(Number(r.weatherSensitivity) || 0.5),
      socialActivity: clamp(Number(r.socialActivity) || 0.5),
      commuteFlexibility: clamp(Number(r.commuteFlexibility) || 0.3),
      activityCurve: normalizeActivityCurve(r.activityCurve as number[] | undefined),
    }));

    // Cache for instant repeat loads
    personaCache.set(slug, { data: personas, ts: Date.now() });

    return NextResponse.json(personas, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    console.error("Claude persona generation failed:", err);
    return NextResponse.json(
      { error: "Persona generation failed", detail: String(err) },
      { status: 500 },
    );
  }
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(obj: Record<string, number> | undefined, key: string): number {
  if (!obj) return 0.5;
  return clamp(Number(obj[key]) || 0.5);
}

function normalizeActivityCurve(raw: number[] | undefined): number[] {
  if (!raw || raw.length !== 24) {
    // Fallback: generic office-worker curve
    return [
      0.02, 0.02, 0.02, 0.02, 0.03, 0.05, 0.15, 0.45,
      0.70, 0.80, 0.80, 0.75, 0.85, 0.75, 0.70, 0.65,
      0.60, 0.70, 0.65, 0.55, 0.40, 0.25, 0.10, 0.05,
    ];
  }
  return raw.map((v) => clamp(Number(v) || 0));
}
