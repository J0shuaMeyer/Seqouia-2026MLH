import type { BBox } from "@/data/cities";

// ── Types ──────────────────────────────────────────────────────────

export interface WazeAlert {
  uuid: string;
  type: string;       // ACCIDENT, JAM, WEATHERHAZARD, ROAD_CLOSED, POLICE, etc.
  subtype: string;
  location: { x: number; y: number }; // x=lng, y=lat (Waze convention)
  street?: string;
  city?: string;
  reliability: number;
  reportRating: number;
  pubMillis: number;
  magvar?: number;     // heading 0-359
}

export interface WazeJam {
  id: number;
  level: number;       // 0-5 congestion level (0=free flow, 5=blocked)
  speedKMH: number;
  speed: number;
  length: number;      // meters
  delay: number;       // seconds of delay
  line: { x: number; y: number }[];  // polyline coordinates
  street?: string;
  roadType?: number;
}

interface WazeResponse {
  alerts?: WazeAlert[];
  jams?: WazeJam[];
}

interface BBoxChunk {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// ── Waze region mapping ────────────────────────────────────────────
// "na" = North America, "row" = Rest of World, "il" = Israel

type WazeEnv = "na" | "row" | "il";

const NA_COUNTRIES = new Set([
  "United States", "Canada",
]);

export function getWazeEnv(country: string): WazeEnv {
  if (country === "Israel") return "il";
  if (NA_COUNTRIES.has(country)) return "na";
  return "row";
}

// ── Constants ──────────────────────────────────────────────────────

const WAZE_URL = "https://www.waze.com/live-map/api/georss";
const DENSITY_THRESHOLD = 190;
const MAX_DEPTH = 2;
const STAGGER_MS = 100;
const RETRY_DELAY_MS = 1000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Fetch a single chunk ───────────────────────────────────────────

async function fetchWazeChunk(
  chunk: BBoxChunk,
  env: WazeEnv,
): Promise<WazeResponse> {
  const empty: WazeResponse = { alerts: [], jams: [] };

  const params = new URLSearchParams({
    top: String(chunk.top),
    bottom: String(chunk.bottom),
    left: String(chunk.left),
    right: String(chunk.right),
    env,
    types: "alerts,traffic",
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${WAZE_URL}?${params}`, {
      headers: {
        referer: "https://www.waze.com/live-map",
        "user-agent": UA,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return empty;
    return (await res.json()) as WazeResponse;
  } catch {
    return empty;
  }
}

// ── Subdivide a bounding box ───────────────────────────────────────

export function subdivideBox(
  bbox: BBoxChunk,
  cols: number,
  rows: number,
): BBoxChunk[] {
  const latStep = (bbox.top - bbox.bottom) / rows;
  const lngStep = (bbox.right - bbox.left) / cols;
  const chunks: BBoxChunk[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      chunks.push({
        bottom: bbox.bottom + r * latStep,
        top: bbox.bottom + (r + 1) * latStep,
        left: bbox.left + c * lngStep,
        right: bbox.left + (c + 1) * lngStep,
      });
    }
  }

  return chunks;
}

// ── Staggered parallel fetch ───────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchChunksStaggered(
  chunks: BBoxChunk[],
  env: WazeEnv,
): Promise<{ chunk: BBoxChunk; data: WazeResponse }[]> {
  const tasks = chunks.map((chunk, i) =>
    delay(i * STAGGER_MS).then(async () => {
      const data = await fetchWazeChunk(chunk, env);
      return { chunk, data };
    }),
  );
  return Promise.all(tasks);
}

// ── Adaptive fetching with subdivision ─────────────────────────────

async function fetchAdaptive(
  chunks: BBoxChunk[],
  env: WazeEnv,
  depth: number,
  alertMap: Map<string, WazeAlert>,
  jamMap: Map<number, WazeJam>,
): Promise<void> {
  const results = await fetchChunksStaggered(chunks, env);

  const toSubdivide: BBoxChunk[] = [];

  for (const { chunk, data } of results) {
    const alerts = data.alerts ?? [];
    const jams = data.jams ?? [];

    for (const j of jams) {
      if (j.level >= 2 && j.line?.length >= 2) jamMap.set(j.id, j);
    }

    if (alerts.length >= DENSITY_THRESHOLD && depth < MAX_DEPTH) {
      toSubdivide.push(chunk);
    } else {
      for (const a of alerts) alertMap.set(a.uuid, a);
    }
  }

  if (toSubdivide.length > 0) {
    const subChunks = toSubdivide.flatMap((c) => subdivideBox(c, 2, 2));
    await fetchAdaptive(subChunks, env, depth + 1, alertMap, jamMap);
  }
}

// ── Public API ─────────────────────────────────────────────────────

export async function fetchCityWazeData(
  bbox: BBox,
  country: string,
): Promise<{ alerts: WazeAlert[]; jams: WazeJam[] }> {
  const [south, west, north, east] = bbox;
  const root: BBoxChunk = { top: north, bottom: south, left: west, right: east };
  const env = getWazeEnv(country);

  const initialChunks = subdivideBox(root, 3, 3);
  const alertMap = new Map<string, WazeAlert>();
  const jamMap = new Map<number, WazeJam>();

  try {
    await fetchAdaptive(initialChunks, env, 0, alertMap, jamMap);
  } catch (err) {
    console.error("[waze] fetch failed:", err);
  }

  // Retry once if we got nothing
  if (alertMap.size === 0 && jamMap.size === 0) {
    await delay(RETRY_DELAY_MS);
    try {
      await fetchAdaptive(initialChunks, env, 0, alertMap, jamMap);
    } catch (err) {
      console.error("[waze] retry failed:", err);
    }
  }

  return {
    alerts: Array.from(alertMap.values()),
    jams: Array.from(jamMap.values()),
  };
}
