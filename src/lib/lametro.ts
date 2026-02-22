import lametroStops from "@/data/lametro-stops.json";
import lametroRoutes from "@/data/lametro-routes.json";

// LA Metro Rail line colors
const LINE_COLORS: Record<string, { name: string; color: string }> = {
  "801": { name: "A Line", color: "#0072BC" },
  "802": { name: "B Line", color: "#EB131B" },
  "803": { name: "C Line", color: "#58A738" },
  "804": { name: "E Line", color: "#FDB913" },
  "805": { name: "D Line", color: "#A05DA5" },
  "807": { name: "K Line", color: "#E56DB1" },
};

const stops = lametroStops as Record<string, { name: string; lat: number; lon: number }>;
const routes = lametroRoutes as Record<string, string[]>;

// ── Public API ──────────────────────────────────────────────────────

export async function fetchLAMetroData(): Promise<GeoJSON.FeatureCollection> {
  const features: GeoJSON.Feature[] = [];
  const seen = new Set<string>();

  for (const [routeId, stopIds] of Object.entries(routes)) {
    const lineInfo = LINE_COLORS[routeId];
    if (!lineInfo) continue;

    for (const stopId of stopIds) {
      // Deduplicate stops shared between lines
      const key = `${routeId}-${stopId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const stop = stops[stopId];
      if (!stop) continue;

      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [stop.lon, stop.lat],
        },
        properties: {
          route: lineInfo.name,
          vehicleType: "rail",
          color: lineInfo.color,
          stopName: stop.name,
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}
