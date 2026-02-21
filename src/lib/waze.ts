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
  uuid: string;
  line: { x: number; y: number }[]; // polyline coordinates
  speed: number;       // meters/second
  length: number;      // meters
  delay: number;       // seconds (-1 if blocked)
  level: number;       // 0=free flow, 5=blocked
  street?: string;
  city?: string;
  roadType: number;
  pubMillis: number;
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

// ── Constants ──────────────────────────────────────────────────────

const DENSITY_THRESHOLD = 190;
const MAX_DEPTH = 2;
const STAGGER_MS = 50;
const RETRY_DELAY_MS = 1000;

const WAZE_ENDPOINTS = [
  "https://www.waze.com/live-map/api/georss",
  "https://www.waze.com/row-rtserver/web/TGeoRSS",
  "https://world-georss.waze.com/rtserver/web/TGeoRSS",
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Fetch a single chunk ───────────────────────────────────────────

async function tryEndpoint(
  url: string,
  chunk: BBoxChunk,
  signal?: AbortSignal,
): Promise<WazeResponse | null> {
  const params = new URLSearchParams({
    top: String(chunk.top),
    bottom: String(chunk.bottom),
    left: String(chunk.left),
    right: String(chunk.right),
    env: "row",
    types: "alerts,traffic",
  });

  try {
    const res = await fetch(`${url}?${params}`, {
      headers: { referer: "https://www.waze.com/live-map", "user-agent": UA },
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as WazeResponse;
  } catch {
    return null;
  }
}

async function fetchWazeChunk(chunk: BBoxChunk): Promise<WazeResponse> {
  const empty: WazeResponse = { alerts: [], jams: [] };

  // Try each known endpoint until one works
  for (const endpoint of WAZE_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const result = await tryEndpoint(endpoint, chunk, controller.signal);
    clearTimeout(timeout);
    if (result) return result;
  }

  return empty;
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
): Promise<{ chunk: BBoxChunk; data: WazeResponse }[]> {
  const tasks = chunks.map((chunk, i) =>
    delay(i * STAGGER_MS).then(async () => {
      const data = await fetchWazeChunk(chunk);
      return { chunk, data };
    }),
  );
  return Promise.all(tasks);
}

// ── Adaptive fetching with subdivision ─────────────────────────────

async function fetchAdaptive(
  chunks: BBoxChunk[],
  depth: number,
  alertMap: Map<string, WazeAlert>,
  jamMap: Map<string, WazeJam>,
): Promise<void> {
  const results = await fetchChunksStaggered(chunks);

  const toSubdivide: BBoxChunk[] = [];

  for (const { chunk, data } of results) {
    const alerts = data.alerts ?? [];
    const jams = data.jams ?? [];

    // Check if this chunk is saturated and can be subdivided further
    const saturated =
      (alerts.length >= DENSITY_THRESHOLD || jams.length >= DENSITY_THRESHOLD) &&
      depth < MAX_DEPTH;

    if (saturated) {
      toSubdivide.push(chunk);
    } else {
      // Collect results, dedup by uuid
      for (const a of alerts) alertMap.set(a.uuid, a);
      for (const j of jams) jamMap.set(j.uuid, j);
    }
  }

  if (toSubdivide.length > 0) {
    const subChunks = toSubdivide.flatMap((c) => subdivideBox(c, 2, 2));
    await fetchAdaptive(subChunks, depth + 1, alertMap, jamMap);
  }
}

// ── Public API ─────────────────────────────────────────────────────

export async function fetchCityWazeData(
  bbox: BBox,
): Promise<{ alerts: WazeAlert[]; jams: WazeJam[] }> {
  const [south, west, north, east] = bbox;
  const root: BBoxChunk = { top: north, bottom: south, left: west, right: east };

  // Start with a 3×3 grid
  const initialChunks = subdivideBox(root, 3, 3);

  const alertMap = new Map<string, WazeAlert>();
  const jamMap = new Map<string, WazeJam>();

  try {
    await fetchAdaptive(initialChunks, 0, alertMap, jamMap);
  } catch (err) {
    console.error("[waze] fetch failed:", err);
  }

  // Retry once if we got nothing — the first endpoint may have been slow
  if (alertMap.size === 0 && jamMap.size === 0) {
    await delay(RETRY_DELAY_MS);
    try {
      await fetchAdaptive(initialChunks, 0, alertMap, jamMap);
    } catch (err) {
      console.error("[waze] retry failed:", err);
    }
  }

  return {
    alerts: Array.from(alertMap.values()),
    jams: Array.from(jamMap.values()),
  };
}
