/**
 * Metro-area bounding box: [south, west, north, east] in lat/lng.
 * These define the zone where hexagons will be placed.
 * Covers the full metropolitan / county area, not just the city proper.
 */
export type BBox = [south: number, west: number, north: number, east: number];

export interface City {
  name: string;
  country: string;
  lat: number;
  lng: number;
  timezone: string;
  dataTier: number;
  slug: string;
  /** Metro-area bounding box for hex grid placement */
  bbox: BBox;
  /** Recommended map zoom level to show the full metro area */
  mapZoom: number;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Raw city data with metro-area bounding boxes
const rawCities = [
  // bbox: [south, west, north, east] — covers metro/county area
  { name: "Jakarta", country: "Indonesia", lat: -6.2088, lng: 106.8456, timezone: "GMT+7", dataTier: 3,
    bbox: [-6.60, 106.40, -5.80, 107.20] as BBox, mapZoom: 10 },
  { name: "Dhaka", country: "Bangladesh", lat: 23.7644, lng: 90.3889, timezone: "GMT+6", dataTier: 3,
    bbox: [23.50, 90.15, 24.10, 90.65] as BBox, mapZoom: 11 },
  { name: "Tokyo", country: "Japan", lat: 35.6762, lng: 139.6503, timezone: "GMT+9", dataTier: 1,
    bbox: [35.20, 138.90, 36.10, 140.20] as BBox, mapZoom: 9 },
  { name: "Delhi", country: "India", lat: 28.6353, lng: 77.2250, timezone: "GMT+5:30", dataTier: 1,
    bbox: [28.20, 76.80, 29.00, 77.60] as BBox, mapZoom: 10 },
  { name: "Shanghai", country: "China", lat: 31.2325, lng: 121.4692, timezone: "GMT+8", dataTier: 1,
    bbox: [30.70, 120.90, 31.90, 122.00] as BBox, mapZoom: 9 },
  { name: "Guangzhou", country: "China", lat: 23.1291, lng: 113.2644, timezone: "GMT+8", dataTier: 2,
    bbox: [22.50, 112.80, 23.60, 113.80] as BBox, mapZoom: 10 },
  { name: "Cairo", country: "Egypt", lat: 30.0444, lng: 31.2357, timezone: "GMT+2", dataTier: 2,
    bbox: [29.70, 30.80, 30.40, 31.70] as BBox, mapZoom: 10 },
  { name: "Manila", country: "Philippines", lat: 14.5995, lng: 120.9842, timezone: "GMT+8", dataTier: 2,
    bbox: [14.20, 120.70, 15.00, 121.30] as BBox, mapZoom: 10 },
  { name: "Kolkata", country: "India", lat: 22.5726, lng: 88.3639, timezone: "GMT+5:30", dataTier: 2,
    bbox: [22.20, 88.00, 22.95, 88.70] as BBox, mapZoom: 11 },
  { name: "Seoul", country: "South Korea", lat: 37.5665, lng: 126.9780, timezone: "GMT+9", dataTier: 1,
    bbox: [37.20, 126.60, 37.90, 127.40] as BBox, mapZoom: 10 },
  { name: "Karachi", country: "Pakistan", lat: 24.8607, lng: 67.0011, timezone: "GMT+5", dataTier: 3,
    bbox: [24.50, 66.60, 25.30, 67.50] as BBox, mapZoom: 10 },
  { name: "Mumbai", country: "India", lat: 19.0761, lng: 72.8775, timezone: "GMT+5:30", dataTier: 1,
    bbox: [18.85, 72.70, 19.40, 73.10] as BBox, mapZoom: 11 },
  { name: "São Paulo", country: "Brazil", lat: -23.5505, lng: -46.6333, timezone: "GMT-3", dataTier: 1,
    bbox: [-24.00, -47.20, -23.10, -46.10] as BBox, mapZoom: 10 },
  { name: "Bangkok", country: "Thailand", lat: 13.7563, lng: 100.5018, timezone: "GMT+7", dataTier: 2,
    bbox: [13.40, 100.20, 14.10, 100.90] as BBox, mapZoom: 10 },
  { name: "Mexico City", country: "Mexico", lat: 19.4326, lng: -99.1332, timezone: "GMT-6", dataTier: 1,
    bbox: [19.00, -99.60, 19.80, -98.70] as BBox, mapZoom: 10 },
  { name: "Beijing", country: "China", lat: 39.9042, lng: 116.4074, timezone: "GMT+8", dataTier: 1,
    bbox: [39.40, 115.80, 40.60, 117.00] as BBox, mapZoom: 9 },
  { name: "Lahore", country: "Pakistan", lat: 31.5204, lng: 74.3587, timezone: "GMT+5", dataTier: 3,
    bbox: [31.20, 74.00, 31.80, 74.70] as BBox, mapZoom: 11 },
  { name: "Istanbul", country: "Turkey", lat: 41.0082, lng: 28.9784, timezone: "GMT+3", dataTier: 1,
    bbox: [40.70, 28.30, 41.40, 29.60] as BBox, mapZoom: 10 },
  { name: "Moscow", country: "Russia", lat: 55.7558, lng: 37.6173, timezone: "GMT+3", dataTier: 2,
    bbox: [55.30, 36.80, 56.20, 38.50] as BBox, mapZoom: 9 },
  { name: "Ho Chi Minh City", country: "Vietnam", lat: 10.8231, lng: 106.6297, timezone: "GMT+7", dataTier: 2,
    bbox: [10.40, 106.30, 11.20, 107.00] as BBox, mapZoom: 10 },
  { name: "Buenos Aires", country: "Argentina", lat: -34.6037, lng: -58.3816, timezone: "GMT-3", dataTier: 1,
    bbox: [-35.00, -58.80, -34.20, -57.80] as BBox, mapZoom: 10 },
  { name: "New York City", country: "United States", lat: 40.7128, lng: -74.0060, timezone: "GMT-5", dataTier: 1,
    bbox: [40.40, -74.50, 41.10, -73.50] as BBox, mapZoom: 10 },
  { name: "Shenzhen", country: "China", lat: 22.5431, lng: 114.0579, timezone: "GMT+8", dataTier: 2,
    bbox: [22.30, 113.70, 22.80, 114.40] as BBox, mapZoom: 11 },
  { name: "Bengaluru", country: "India", lat: 12.9716, lng: 77.5946, timezone: "GMT+5:30", dataTier: 2,
    bbox: [12.60, 77.20, 13.30, 78.00] as BBox, mapZoom: 11 },
  { name: "Osaka", country: "Japan", lat: 34.6937, lng: 135.5023, timezone: "GMT+9", dataTier: 2,
    bbox: [34.30, 135.10, 35.10, 135.90] as BBox, mapZoom: 10 },
  { name: "Lagos", country: "Nigeria", lat: 6.5244, lng: 3.3792, timezone: "GMT+1", dataTier: 3,
    bbox: [6.20, 2.90, 6.90, 3.80] as BBox, mapZoom: 10 },
  { name: "Los Angeles", country: "United States", lat: 34.0522, lng: -118.2437, timezone: "GMT-8", dataTier: 1,
    bbox: [33.50, -118.80, 34.50, -117.50] as BBox, mapZoom: 9 },
];

export const cities: City[] = rawCities.map((c) => ({
  ...c,
  slug: toSlug(c.name),
}));

export function getCityBySlug(slug: string): City | undefined {
  return cities.find((c) => c.slug === slug);
}

/** Check if a lat/lng point falls within a city's metro bounding box */
export function isInBounds(lat: number, lng: number, bbox: BBox): boolean {
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}
