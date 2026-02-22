// ── Types ──────────────────────────────────────────────────────────

interface LAMetroVehicle {
  latitude: number;
  longitude: number;
  route_id?: string;
  run_id?: string;
  heading?: number;
}

// ── Public API ──────────────────────────────────────────────────────

export async function fetchLAMetroData(): Promise<GeoJSON.FeatureCollection> {
  const features: GeoJSON.Feature[] = [];

  const [busRes, railRes] = await Promise.allSettled([
    fetch("https://api.metro.net/LACMTA/vehicle_positions/bus", {
      signal: AbortSignal.timeout(10_000),
    }),
    fetch("https://api.metro.net/LACMTA/vehicle_positions/rail", {
      signal: AbortSignal.timeout(10_000),
    }),
  ]);

  if (busRes.status === "fulfilled" && busRes.value.ok) {
    try {
      const data = await busRes.value.json();
      const vehicles: LAMetroVehicle[] = Array.isArray(data) ? data : data.items ?? data.entity ?? [];
      for (const v of vehicles) {
        const lat = v.latitude;
        const lng = v.longitude;
        if (!lat || !lng) continue;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            route: v.route_id ?? v.run_id ?? "bus",
            vehicleType: "bus",
            heading: v.heading ?? 0,
          },
        });
      }
    } catch (err) {
      console.error("[lametro] bus parse error:", err);
    }
  }

  if (railRes.status === "fulfilled" && railRes.value.ok) {
    try {
      const data = await railRes.value.json();
      const vehicles: LAMetroVehicle[] = Array.isArray(data) ? data : data.items ?? data.entity ?? [];
      for (const v of vehicles) {
        const lat = v.latitude;
        const lng = v.longitude;
        if (!lat || !lng) continue;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            route: v.route_id ?? v.run_id ?? "rail",
            vehicleType: "rail",
            heading: v.heading ?? 0,
          },
        });
      }
    } catch (err) {
      console.error("[lametro] rail parse error:", err);
    }
  }

  return { type: "FeatureCollection", features };
}
