import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import mtaStops from "@/data/mta-stops.json";

// ── MTA feed URLs (keyless since v2.0.0) ────────────────────────────

const MTA_FEEDS = [
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",       // 1/2/3/4/5/6/7/S
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",   // A/C/E
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",  // B/D/F/M
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",     // G
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",    // J/Z
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",  // N/Q/R/W
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",     // L
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si",    // SIR
];

// ── MTA line color mapping ──────────────────────────────────────────

const ROUTE_COLORS: Record<string, string> = {
  "1": "#EE352E", "2": "#EE352E", "3": "#EE352E",
  "4": "#00933C", "5": "#00933C", "6": "#00933C",
  "7": "#B933AD",
  "A": "#0039A6", "C": "#0039A6", "E": "#0039A6",
  "B": "#FF6319", "D": "#FF6319", "F": "#FF6319", "M": "#FF6319",
  "G": "#6CBE45",
  "J": "#996633", "Z": "#996633",
  "L": "#A7A9AC",
  "N": "#FCCC0A", "Q": "#FCCC0A", "R": "#FCCC0A", "W": "#FCCC0A",
  "S": "#808183", "SI": "#0039A6", "SIR": "#0039A6",
  "GS": "#808183", "FS": "#808183", "H": "#808183",
};

// ── Stop coordinate lookup ──────────────────────────────────────────

const stops = mtaStops as unknown as Record<string, [number, number]>;

function resolveStop(stopId: string): [number, number] | null {
  // Try exact match first (e.g., "101N")
  if (stops[stopId]) return stops[stopId];
  // Try without direction suffix (e.g., "101")
  const base = stopId.replace(/[NS]$/, "");
  if (stops[base]) return stops[base];
  return null;
}

// ── Fetch a single GTFS-RT feed ─────────────────────────────────────

async function fetchFeed(url: string): Promise<GeoJSON.Feature[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];

    const buffer = await res.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer),
    );

    const features: GeoJSON.Feature[] = [];
    const now = Math.floor(Date.now() / 1000);

    for (const entity of feed.entity) {
      const tripUpdate = entity.tripUpdate;
      if (!tripUpdate?.stopTimeUpdate?.length) continue;

      const routeId = tripUpdate.trip?.routeId ?? "";

      // Find the next upcoming stop (first stop with arrival after now)
      let nextStop = tripUpdate.stopTimeUpdate[0];
      for (const stu of tripUpdate.stopTimeUpdate) {
        const arrTime = Number(stu.arrival?.time ?? stu.departure?.time ?? 0);
        if (arrTime >= now) {
          nextStop = stu;
          break;
        }
      }

      const stopId = nextStop.stopId ?? "";
      const coords = resolveStop(stopId);
      if (!coords) continue;

      const direction = stopId.endsWith("N") ? "uptown" : "downtown";

      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [coords[1], coords[0]], // [lng, lat]
        },
        properties: {
          route: routeId,
          direction,
          stopId,
          color: ROUTE_COLORS[routeId] ?? "#808183",
        },
      });
    }

    return features;
  } catch (err) {
    console.error(`[mta] feed error for ${url}:`, err);
    return [];
  }
}

// ── Public API ──────────────────────────────────────────────────────

export async function fetchMTASubwayData(): Promise<GeoJSON.FeatureCollection> {
  const results = await Promise.allSettled(MTA_FEEDS.map(fetchFeed));

  const features: GeoJSON.Feature[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      features.push(...result.value);
    }
  }

  return { type: "FeatureCollection", features };
}

export { ROUTE_COLORS };
