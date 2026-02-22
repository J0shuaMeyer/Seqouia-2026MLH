/**
 * Environment Change Detection — compares two CityEnvironment snapshots
 * and returns a list of significant changes with urgency levels.
 */
import type {
  CityEnvironment,
  EnvironmentChange,
  EarthquakeInfo,
} from "./agent-types";

/**
 * Detect significant environmental changes between two snapshots.
 * Returns an array of changes sorted by urgency (critical first).
 */
export function detectEnvironmentChanges(
  prev: CityEnvironment,
  next: CityEnvironment,
): EnvironmentChange[] {
  const changes: EnvironmentChange[] = [];
  const now = Date.now();

  // Rain started/stopped
  if (!prev.isRaining && next.isRaining) {
    changes.push({
      type: "rain_started",
      urgency: "high",
      description: "Rain has started across the city",
      affectedArea: null,
      timestamp: now,
    });
  } else if (prev.isRaining && !next.isRaining) {
    changes.push({
      type: "rain_stopped",
      urgency: "moderate",
      description: "Rain has stopped",
      affectedArea: null,
      timestamp: now,
    });
  }

  // Snow started/stopped
  if (!prev.isSnowing && next.isSnowing) {
    changes.push({
      type: "snow_started",
      urgency: "high",
      description: "Snow has started falling",
      affectedArea: null,
      timestamp: now,
    });
  } else if (prev.isSnowing && !next.isSnowing) {
    changes.push({
      type: "snow_stopped",
      urgency: "moderate",
      description: "Snow has stopped",
      affectedArea: null,
      timestamp: now,
    });
  }

  // Temperature spike/drop (>10°F change)
  const tempDelta = next.tempF - prev.tempF;
  if (Math.abs(tempDelta) > 10) {
    const isSpiking = tempDelta > 0;
    changes.push({
      type: isSpiking ? "temperature_spike" : "temperature_drop",
      urgency: Math.abs(tempDelta) > 20 ? "high" : "moderate",
      description: `Temperature ${isSpiking ? "surged" : "dropped"} ${Math.round(Math.abs(tempDelta))}°F to ${Math.round(next.tempF)}°F`,
      affectedArea: null,
      timestamp: now,
    });
  }

  // Traffic spike/cleared (jam level delta > 1.5)
  const jamDelta = next.avgJamLevel - prev.avgJamLevel;
  if (jamDelta > 1.5) {
    changes.push({
      type: "traffic_spike",
      urgency: "high",
      description: `Traffic congestion surged to level ${next.avgJamLevel.toFixed(1)}`,
      affectedArea: null,
      timestamp: now,
    });
  } else if (jamDelta < -1.5) {
    changes.push({
      type: "traffic_cleared",
      urgency: "low",
      description: "Traffic congestion has cleared significantly",
      affectedArea: null,
      timestamp: now,
    });
  }

  // Earthquake detection: new quakes not in prev set
  const prevQuakeKeys = new Set(
    prev.earthquakes.map((q) => `${q.magnitude}-${q.time}`),
  );
  const newQuakes = next.earthquakes.filter(
    (q) => !prevQuakeKeys.has(`${q.magnitude}-${q.time}`),
  );
  for (const quake of newQuakes) {
    changes.push({
      type: "earthquake",
      urgency: quake.magnitude >= 5.0 ? "critical"
             : quake.magnitude >= 3.5 ? "high"
             : "moderate",
      description: `M${quake.magnitude.toFixed(1)} earthquake near ${quake.place} (${Math.round(quake.distanceKm)}km away)`,
      affectedArea: {
        lat: quake.lat,
        lng: quake.lng,
        radiusKm: quake.magnitude * 20,
      },
      timestamp: now,
    });
  }

  // AQI hazardous threshold crossing
  if (prev.aqi <= 150 && next.aqi > 150) {
    changes.push({
      type: "aqi_hazardous",
      urgency: "high",
      description: `Air quality deteriorated to hazardous levels (AQI ${next.aqi})`,
      affectedArea: null,
      timestamp: now,
    });
  } else if (prev.aqi > 150 && next.aqi <= 150) {
    changes.push({
      type: "aqi_recovered",
      urgency: "low",
      description: `Air quality has improved (AQI ${next.aqi})`,
      affectedArea: null,
      timestamp: now,
    });
  }

  // Sort by urgency: critical > high > moderate > low
  const urgencyOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    moderate: 2,
    low: 3,
  };
  changes.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return changes;
}

/**
 * Get the maximum urgency level from a list of changes.
 */
export function maxUrgency(
  changes: EnvironmentChange[],
): "critical" | "high" | "moderate" | "low" | null {
  if (changes.length === 0) return null;
  return changes[0].urgency; // already sorted by urgency
}

/**
 * Format environment changes into a human-readable string for agent prompts.
 */
export function formatChangesForPrompt(changes: EnvironmentChange[]): string {
  if (changes.length === 0) return "";
  return changes.map((c) => c.description).join("; ");
}
