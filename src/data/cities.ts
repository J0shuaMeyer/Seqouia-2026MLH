/**
 * Metro-area bounding box: [south, west, north, east] in lat/lng.
 * These define the zone where hexagons will be placed.
 * Covers the full metropolitan / county area, not just the city proper.
 */
export type BBox = [south: number, west: number, north: number, east: number];

export interface BikeNetworkConfig {
  type: "gbfs" | "citybikes";
  infoUrl?: string;      // GBFS station_information URL
  statusUrl?: string;    // GBFS station_status URL
  networkId?: string;    // CityBikes network ID
}

export type TransitType = "mta" | "lametro" | "gtfs-static";

export interface City {
  name: string;
  country: string;
  /** ISO 3166-1 alpha-2 country code */
  countryCode: string;
  lat: number;
  lng: number;
  timezone: string;
  dataTier: number;
  slug: string;
  /** Metro-area bounding box for hex grid placement */
  bbox: BBox;
  /** Recommended map zoom level to show the full metro area */
  mapZoom: number;
  /** Bike share network config (undefined = no bike share) */
  bikeNetwork?: BikeNetworkConfig;
  /** Transit data source type (undefined = no transit data) */
  transitType?: TransitType;
  /** City-specific tagline shown during transitions */
  tagline: string;
  /** Metro-area population */
  population: number;
  /** City/county area in square miles */
  areaSqMi: number;
  /** Walk Score (0-100) */
  walkScore: number;
  /** Motor vehicles per 1,000 residents — contextualizes traffic data volume */
  vehiclesPer1000: number;
  /** Average one-way commute in minutes */
  avgCommuteMin: number;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Raw city data with metro-area bounding boxes
// population = metro-area population, areaSqMi = city/county area, walkScore = 0-100 walkability index
const rawCities = [
  // bbox: [south, west, north, east] — covers metro/county area
  { name: "Jakarta", country: "Indonesia", countryCode: "ID", lat: -6.2088, lng: 106.8456, timezone: "GMT+7", dataTier: 3,
    bbox: [-6.60, 106.40, -5.80, 107.20] as BBox, mapZoom: 10,
    tagline: "30 million moving as one.", population: 34_540_000, areaSqMi: 255, walkScore: 55, vehiclesPer1000: 340, avgCommuteMin: 66 },
  { name: "Dhaka", country: "Bangladesh", countryCode: "BD", lat: 23.7644, lng: 90.3889, timezone: "GMT+6", dataTier: 3,
    bbox: [23.50, 90.15, 24.10, 90.65] as BBox, mapZoom: 11,
    tagline: "Density like nowhere else.", population: 22_478_000, areaSqMi: 118, walkScore: 58, vehiclesPer1000: 35, avgCommuteMin: 52 },
  { name: "Tokyo", country: "Japan", countryCode: "JP", lat: 35.6762, lng: 139.6503, timezone: "GMT+9", dataTier: 1,
    bbox: [35.20, 138.90, 36.10, 140.20] as BBox, mapZoom: 9,
    bikeNetwork: { type: "citybikes", networkId: "docomo-cycle-tokyo" },
    transitType: "gtfs-static" as const,
    tagline: "Precision in motion.", population: 37_400_000, areaSqMi: 845, walkScore: 85, vehiclesPer1000: 460, avgCommuteMin: 48 },
  { name: "Delhi", country: "India", countryCode: "IN", lat: 28.6353, lng: 77.2250, timezone: "GMT+5:30", dataTier: 1,
    bbox: [28.20, 76.80, 29.00, 77.60] as BBox, mapZoom: 10,
    transitType: "gtfs-static" as const,
    tagline: "Where old and new collide.", population: 32_941_000, areaSqMi: 573, walkScore: 56, vehiclesPer1000: 85, avgCommuteMin: 55 },
  { name: "Shanghai", country: "China", countryCode: "CN", lat: 31.2325, lng: 121.4692, timezone: "GMT+8", dataTier: 1,
    bbox: [30.70, 120.90, 31.90, 122.00] as BBox, mapZoom: 9,
    transitType: "gtfs-static" as const,
    tagline: "The engine of the East.", population: 28_517_000, areaSqMi: 2448, walkScore: 68, vehiclesPer1000: 210, avgCommuteMin: 42 },
  { name: "Guangzhou", country: "China", countryCode: "CN", lat: 23.1291, lng: 113.2644, timezone: "GMT+8", dataTier: 2,
    bbox: [22.50, 112.80, 23.60, 113.80] as BBox, mapZoom: 10,
    tagline: "The Pearl River never stops.", population: 18_676_000, areaSqMi: 2870, walkScore: 55, vehiclesPer1000: 250, avgCommuteMin: 46 },
  { name: "Cairo", country: "Egypt", countryCode: "EG", lat: 30.0444, lng: 31.2357, timezone: "GMT+2", dataTier: 2,
    bbox: [29.70, 30.80, 30.40, 31.70] as BBox, mapZoom: 10,
    transitType: "gtfs-static" as const,
    tagline: "5,000 years and still rushing.", population: 22_183_000, areaSqMi: 175, walkScore: 52, vehiclesPer1000: 75, avgCommuteMin: 50 },
  { name: "Manila", country: "Philippines", countryCode: "PH", lat: 14.5995, lng: 120.9842, timezone: "GMT+8", dataTier: 2,
    bbox: [14.20, 120.70, 15.00, 121.30] as BBox, mapZoom: 10,
    tagline: "Islands connected by chaos.", population: 13_923_000, areaSqMi: 16, walkScore: 65, vehiclesPer1000: 90, avgCommuteMin: 55 },
  { name: "Kolkata", country: "India", countryCode: "IN", lat: 22.5726, lng: 88.3639, timezone: "GMT+5:30", dataTier: 2,
    bbox: [22.20, 88.00, 22.95, 88.70] as BBox, mapZoom: 11,
    tagline: "The cultural heartbeat of India.", population: 14_974_000, areaSqMi: 77, walkScore: 62, vehiclesPer1000: 40, avgCommuteMin: 48 },
  { name: "Seoul", country: "South Korea", countryCode: "KR", lat: 37.5665, lng: 126.9780, timezone: "GMT+9", dataTier: 1,
    bbox: [37.20, 126.60, 37.90, 127.40] as BBox, mapZoom: 10,
    bikeNetwork: { type: "citybikes", networkId: "seoul-bike" },
    transitType: "gtfs-static" as const,
    tagline: "Wired at the speed of light.", population: 9_776_000, areaSqMi: 234, walkScore: 82, vehiclesPer1000: 380, avgCommuteMin: 42 },
  { name: "Karachi", country: "Pakistan", countryCode: "PK", lat: 24.8607, lng: 67.0011, timezone: "GMT+5", dataTier: 3,
    bbox: [24.50, 66.60, 25.30, 67.50] as BBox, mapZoom: 10,
    tagline: "Pakistan's restless port.", population: 16_094_000, areaSqMi: 1364, walkScore: 42, vehiclesPer1000: 50, avgCommuteMin: 45 },
  { name: "Mumbai", country: "India", countryCode: "IN", lat: 19.0761, lng: 72.8775, timezone: "GMT+5:30", dataTier: 1,
    bbox: [18.85, 72.70, 19.40, 73.10] as BBox, mapZoom: 11,
    tagline: "The city of dreams, wide awake.", population: 20_711_000, areaSqMi: 233, walkScore: 65, vehiclesPer1000: 55, avgCommuteMin: 60 },
  { name: "São Paulo", country: "Brazil", countryCode: "BR", lat: -23.5505, lng: -46.6333, timezone: "GMT-3", dataTier: 1,
    bbox: [-24.00, -47.20, -23.10, -46.10] as BBox, mapZoom: 10,
    bikeNetwork: { type: "citybikes", networkId: "bikesampa" },
    transitType: "gtfs-static" as const,
    tagline: "South America's concrete jungle.", population: 22_046_000, areaSqMi: 587, walkScore: 64, vehiclesPer1000: 350, avgCommuteMin: 56 },
  { name: "Bangkok", country: "Thailand", countryCode: "TH", lat: 13.7563, lng: 100.5018, timezone: "GMT+7", dataTier: 2,
    bbox: [13.40, 100.20, 14.10, 100.90] as BBox, mapZoom: 10,
    transitType: "gtfs-static" as const,
    tagline: "Organized chaos, perfected.", population: 10_539_000, areaSqMi: 606, walkScore: 50, vehiclesPer1000: 300, avgCommuteMin: 53 },
  { name: "Mexico City", country: "Mexico", countryCode: "MX", lat: 19.4326, lng: -99.1332, timezone: "GMT-6", dataTier: 1,
    bbox: [19.00, -99.60, 19.80, -98.70] as BBox, mapZoom: 10,
    bikeNetwork: { type: "gbfs", infoUrl: "https://gbfs.mex.lyftbikes.com/gbfs/en/station_information.json", statusUrl: "https://gbfs.mex.lyftbikes.com/gbfs/en/station_status.json" },
    transitType: "gtfs-static" as const,
    tagline: "A metropolis built on a lake.", population: 21_804_000, areaSqMi: 573, walkScore: 62, vehiclesPer1000: 280, avgCommuteMin: 55 },
  { name: "Beijing", country: "China", countryCode: "CN", lat: 39.9042, lng: 116.4074, timezone: "GMT+8", dataTier: 1,
    bbox: [39.40, 115.80, 40.60, 117.00] as BBox, mapZoom: 9,
    transitType: "gtfs-static" as const,
    tagline: "The center of gravity.", population: 21_542_000, areaSqMi: 6336, walkScore: 60, vehiclesPer1000: 260, avgCommuteMin: 52 },
  { name: "Lahore", country: "Pakistan", countryCode: "PK", lat: 31.5204, lng: 74.3587, timezone: "GMT+5", dataTier: 3,
    bbox: [31.20, 74.00, 31.80, 74.70] as BBox, mapZoom: 11,
    tagline: "The heart of Punjab.", population: 13_095_000, areaSqMi: 690, walkScore: 40, vehiclesPer1000: 85, avgCommuteMin: 40 },
  { name: "Istanbul", country: "Turkey", countryCode: "TR", lat: 41.0082, lng: 28.9784, timezone: "GMT+3", dataTier: 1,
    bbox: [40.70, 28.30, 41.40, 29.60] as BBox, mapZoom: 10,
    transitType: "gtfs-static" as const,
    tagline: "Two continents, one city.", population: 15_848_000, areaSqMi: 2063, walkScore: 70, vehiclesPer1000: 250, avgCommuteMin: 50 },
  { name: "Moscow", country: "Russia", countryCode: "RU", lat: 55.7558, lng: 37.6173, timezone: "GMT+3", dataTier: 2,
    bbox: [55.30, 36.80, 56.20, 38.50] as BBox, mapZoom: 9,
    transitType: "gtfs-static" as const,
    tagline: "The city that commands a continent.", population: 12_536_000, areaSqMi: 970, walkScore: 72, vehiclesPer1000: 320, avgCommuteMin: 55 },
  { name: "Ho Chi Minh City", country: "Vietnam", countryCode: "VN", lat: 10.8231, lng: 106.6297, timezone: "GMT+7", dataTier: 2,
    bbox: [10.40, 106.30, 11.20, 107.00] as BBox, mapZoom: 10,
    tagline: "Ten million scooters, one rhythm.", population: 9_321_000, areaSqMi: 809, walkScore: 58, vehiclesPer1000: 480, avgCommuteMin: 35 },
  { name: "Buenos Aires", country: "Argentina", countryCode: "AR", lat: -34.6037, lng: -58.3816, timezone: "GMT-3", dataTier: 1,
    bbox: [-35.00, -58.80, -34.20, -57.80] as BBox, mapZoom: 10,
    bikeNetwork: { type: "citybikes", networkId: "ecobici-buenos-aires" },
    transitType: "gtfs-static" as const,
    tagline: "Where the tango meets the grid.", population: 15_370_000, areaSqMi: 78, walkScore: 78, vehiclesPer1000: 340, avgCommuteMin: 45 },
  { name: "New York City", country: "United States", countryCode: "US", lat: 40.7128, lng: -74.0060, timezone: "GMT-5", dataTier: 1,
    bbox: [40.40, -74.50, 41.10, -73.50] as BBox, mapZoom: 10,
    bikeNetwork: { type: "gbfs", infoUrl: "https://gbfs.citibikenyc.com/gbfs/en/station_information.json", statusUrl: "https://gbfs.citibikenyc.com/gbfs/en/station_status.json" },
    transitType: "mta" as const,
    tagline: "The city that never sleeps.", population: 20_140_000, areaSqMi: 303, walkScore: 89, vehiclesPer1000: 220, avgCommuteMin: 43 },
  { name: "Shenzhen", country: "China", countryCode: "CN", lat: 22.5431, lng: 114.0579, timezone: "GMT+8", dataTier: 2,
    bbox: [22.30, 113.70, 22.80, 114.40] as BBox, mapZoom: 11,
    tagline: "From fishing village to megacity.", population: 17_619_000, areaSqMi: 768, walkScore: 55, vehiclesPer1000: 270, avgCommuteMin: 38 },
  { name: "Bengaluru", country: "India", countryCode: "IN", lat: 12.9716, lng: 77.5946, timezone: "GMT+5:30", dataTier: 2,
    bbox: [12.60, 77.20, 13.30, 78.00] as BBox, mapZoom: 11,
    tagline: "India's silicon nerve center.", population: 13_193_000, areaSqMi: 286, walkScore: 48, vehiclesPer1000: 110, avgCommuteMin: 52 },
  { name: "Osaka", country: "Japan", countryCode: "JP", lat: 34.6937, lng: 135.5023, timezone: "GMT+9", dataTier: 2,
    bbox: [34.30, 135.10, 35.10, 135.90] as BBox, mapZoom: 10,
    bikeNetwork: { type: "citybikes", networkId: "docomo-cycle-osaka" },
    transitType: "gtfs-static" as const,
    tagline: "Japan's kitchen, always cooking.", population: 19_283_000, areaSqMi: 86, walkScore: 80, vehiclesPer1000: 450, avgCommuteMin: 45 },
  { name: "Lagos", country: "Nigeria", countryCode: "NG", lat: 6.5244, lng: 3.3792, timezone: "GMT+1", dataTier: 3,
    bbox: [6.20, 2.90, 6.90, 3.80] as BBox, mapZoom: 10,
    tagline: "Africa's fastest-growing pulse.", population: 15_388_000, areaSqMi: 452, walkScore: 38, vehiclesPer1000: 45, avgCommuteMin: 58 },
  { name: "Los Angeles", country: "United States", countryCode: "US", lat: 34.0522, lng: -118.2437, timezone: "GMT-8", dataTier: 1,
    bbox: [33.50, -118.80, 34.50, -117.50] as BBox, mapZoom: 9,
    bikeNetwork: { type: "citybikes", networkId: "metro-bike-share" },
    transitType: "lametro" as const,
    tagline: "Sprawl at scale.", population: 13_201_000, areaSqMi: 469, walkScore: 53, vehiclesPer1000: 520, avgCommuteMin: 52 },
];

export const cities: City[] = rawCities.map((c) => ({
  ...c,
  slug: toSlug(c.name),
  bikeNetwork: c.bikeNetwork as BikeNetworkConfig | undefined,
}));

export function getCityBySlug(slug: string): City | undefined {
  return cities.find((c) => c.slug === slug);
}

/** Check if a lat/lng point falls within a city's metro bounding box */
export function isInBounds(lat: number, lng: number, bbox: BBox): boolean {
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}
