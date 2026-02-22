// ── AISStream — Real-Time Maritime Vessel Tracking ──────────────────
// WebSocket polling adapter: opens WS, collects AIS positions for 8s,
// closes, deduplicates by MMSI, returns GeoJSON.
// Server-side 60s cache per city.
//
// Subscribes to both PositionReport (lat/lng/speed/heading) and
// ShipStaticData (vessel type code + dimensions) and merges by MMSI.

import type { BBox } from "@/data/cities";
import WebSocket from "ws";

const CACHE_TTL_MS = 60_000; // 60 seconds
const WS_COLLECT_MS = 8_000; // collect messages for 8 seconds

interface CacheEntry {
  data: GeoJSON.FeatureCollection;
  ts: number;
}

const cache = new Map<string, CacheEntry>();

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** Classify AIS ship type code into a category + circle radius */
function classifyShip(typeCode: number): { category: string; radius: number } {
  if (typeCode >= 70 && typeCode <= 79) return { category: "cargo", radius: 5 };
  if (typeCode >= 80 && typeCode <= 89) return { category: "tanker", radius: 5 };
  if (typeCode >= 60 && typeCode <= 69) return { category: "passenger", radius: 4 };
  if (typeCode === 30) return { category: "fishing", radius: 2.5 };
  if (typeCode === 36 || typeCode === 37) return { category: "pleasure", radius: 2 };
  // Tugs (31-32), pilot vessels (50), SAR (51), law enforcement (55)
  if (typeCode >= 50 && typeCode <= 59) return { category: "other", radius: 3 };
  if (typeCode >= 31 && typeCode <= 35) return { category: "other", radius: 3 };
  return { category: "other", radius: 3 };
}

/** Collected vessel data before GeoJSON conversion */
interface VesselRecord {
  mmsi: string;
  name: string;
  lon: number;
  lat: number;
  heading: number;
  speed: number;
  shipType: number;
  length: number;
}

export async function fetchMaritimeData(
  bbox: BBox,
  citySlug: string,
): Promise<GeoJSON.FeatureCollection> {
  // Check cache
  const cached = cache.get(citySlug);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const apiKey = process.env.AISSTREAM_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[maritime] AISSTREAM_API_KEY not set");
    return cached?.data ?? EMPTY_FC;
  }

  const [south, west, north, east] = bbox;

  try {
    const vessels = await new Promise<Map<string, VesselRecord>>(
      (resolve) => {
        const positions = new Map<string, VesselRecord>();
        // Separate map for static data (type + dimensions)
        const staticInfo = new Map<string, { shipType: number; length: number }>();
        let settled = false;

        const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            ws.close();
            mergeAndResolve();
          }
        }, WS_COLLECT_MS);

        function mergeAndResolve() {
          // Merge static data into position records
          for (const [mmsi, info] of staticInfo) {
            const pos = positions.get(mmsi);
            if (pos) {
              pos.shipType = info.shipType;
              pos.length = info.length;
            }
          }
          resolve(positions);
        }

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              APIKey: apiKey,
              BoundingBoxes: [[[south, west], [north, east]]],
              FilterMessageTypes: ["PositionReport", "ShipStaticData"],
            }),
          );
        });

        ws.on("message", (raw: Buffer) => {
          try {
            const msg = JSON.parse(raw.toString());
            const meta = msg.MetaData;
            if (!meta) return;

            const mmsi = String(meta.MMSI);
            const msgType = msg.MessageType;

            if (msgType === "PositionReport") {
              const pos = msg.Message?.PositionReport;
              if (!pos) return;

              const lon = pos.Longitude;
              const lat = pos.Latitude;
              if (lon == null || lat == null) return;

              // TrueHeading 511 means "not available" in AIS
              const heading = (pos.TrueHeading != null && pos.TrueHeading !== 511)
                ? pos.TrueHeading
                : (pos.Cog ?? 0);

              positions.set(mmsi, {
                mmsi,
                name: (meta.ShipName ?? "").trim(),
                lon,
                lat,
                heading,
                speed: pos.Sog ?? 0,
                shipType: 0,  // filled by static data if available
                length: 0,
              });
            } else if (msgType === "ShipStaticData") {
              const sd = msg.Message?.ShipStaticData;
              if (!sd) return;

              const dim = sd.Dimension;
              const length = dim ? (dim.A ?? 0) + (dim.B ?? 0) : 0;

              staticInfo.set(mmsi, {
                shipType: sd.Type ?? 0,
                length,
              });
            }
          } catch {
            // skip malformed messages
          }
        });

        ws.on("error", (err) => {
          console.error("[maritime] ws error:", err);
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            ws.close();
            mergeAndResolve();
          }
        });

        ws.on("close", () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            mergeAndResolve();
          }
        });
      },
    );

    const features: GeoJSON.Feature[] = [];
    for (const v of vessels.values()) {
      const { category, radius } = classifyShip(v.shipType);
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [v.lon, v.lat],
        },
        properties: {
          mmsi: v.mmsi,
          name: v.name,
          shipType: v.shipType,
          shipCategory: category,
          heading: v.heading,
          speed: v.speed,
          length: v.length,
          radius,
        },
      });
    }

    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    };

    cache.set(citySlug, { data: fc, ts: Date.now() });
    return fc;
  } catch (err) {
    console.error("[maritime] fetch failed:", err);
    return cached?.data ?? EMPTY_FC;
  }
}
