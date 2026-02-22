// ── Wikidata SPARQL — Points of Interest ─────────────────────────
// Fetches airports, seaports, train stations, stadiums within 30km
// of a city center. Results cached 24 hours server-side.

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// POI type Wikidata QIDs
const POI_TYPES: Record<string, string> = {
  Q1248784: "airport",
  Q42680: "seaport",
  Q55488: "train_station",
  Q483110: "stadium",
};

const QID_LIST = Object.keys(POI_TYPES)
  .map((q) => `wd:${q}`)
  .join(" ");

interface CacheEntry {
  data: GeoJSON.FeatureCollection;
  ts: number;
}

const cache = new Map<string, CacheEntry>();

function buildSparqlQuery(lat: number, lng: number): string {
  return `
SELECT ?place ?placeLabel ?poiType ?lat ?lng WHERE {
  VALUES ?type { ${QID_LIST} }
  ?place wdt:P31 ?type .
  BIND(?type AS ?poiType)
  SERVICE wikibase:around {
    ?place wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "30" .
  }
  BIND(geof:latitude(?loc) AS ?lat)
  BIND(geof:longitude(?loc) AS ?lng)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 200
`.trim();
}

export async function fetchPOIData(
  lat: number,
  lng: number,
  citySlug: string,
): Promise<GeoJSON.FeatureCollection> {
  // Check cache
  const cached = cache.get(citySlug);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const query = buildSparqlQuery(lat, lng);
    const res = await fetch(SPARQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/sparql-results+json",
        "User-Agent": "Sequoia/1.0 (https://github.com/sequoia; urban-monitor)",
      },
      body: `query=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error(`[wikidata] SPARQL error ${res.status}`);
      return { type: "FeatureCollection", features: [] };
    }

    const json = await res.json();
    const bindings = json.results?.bindings ?? [];

    const features: GeoJSON.Feature[] = bindings.map(
      (b: Record<string, { value: string }>) => {
        const qid = b.poiType.value.split("/").pop() ?? "";
        return {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [
              parseFloat(b.lng.value),
              parseFloat(b.lat.value),
            ],
          },
          properties: {
            name: b.placeLabel?.value ?? "Unknown",
            poiType: POI_TYPES[qid] ?? "other",
            wikidataId: b.place.value.split("/").pop() ?? "",
          },
        };
      },
    );

    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    };

    cache.set(citySlug, { data: fc, ts: Date.now() });
    return fc;
  } catch (err) {
    console.error("[wikidata] fetch failed:", err);
    return { type: "FeatureCollection", features: [] };
  }
}
