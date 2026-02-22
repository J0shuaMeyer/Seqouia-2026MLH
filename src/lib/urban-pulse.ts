import type { City } from "@/data/cities";

// ── Types ──────────────────────────────────────────────────────────

export interface SignalBundle {
  traffic?: { alertCount: number };
  air?: { aircraftCount: number };
  maritime?: { vesselCount: number };
  bike?: { avgUtilization: number };   // 0-1 (1 = all bikes in use)
  poi?: { avgActivity: number };       // 0-100
  weather?: { tempF: number; weatherCode: number; aqi: number };
}

export interface SignalDetail {
  observed: number;
  expected: number;
  penetrationRatio: number;
  quality: number;        // 0-1, dynamic quality assessment
  deviation: number;      // ratio to expected (>1 = busier, <1 = quieter)
  effectiveWeight: number;
}

export interface UPIResult {
  score: number;           // 0-100 final Urban Pulse Index
  baseline: number;        // 0-100 circadian component
  modifier: number;        // 0.5-2.0 signal modifier
  damping: number;         // 0.5-1.0 weather factor
  signalCount: number;     // how many signals contributed meaningfully (q > 0.3)
  signals: Record<string, SignalDetail>;
}

// ── Circadian Baseline ─────────────────────────────────────────────
// Gaussian mixture: 6 behavioral phases composing a daily urban rhythm.

interface GaussianKernel {
  mu: number;    // peak hour
  sigma: number; // spread
  alpha: number; // weight
}

const KERNELS: GaussianKernel[] = [
  { mu: 7.5,  sigma: 1.2, alpha: 0.25 }, // dawn commute
  { mu: 10.0, sigma: 1.5, alpha: 0.15 }, // morning work
  { mu: 12.5, sigma: 0.8, alpha: 0.12 }, // lunch
  { mu: 15.0, sigma: 1.5, alpha: 0.18 }, // afternoon
  { mu: 18.5, sigma: 2.0, alpha: 0.35 }, // evening peak
  { mu: 22.0, sigma: 1.5, alpha: 0.10 }, // nightlife
];

const FLOOR = 0.05;

// Pre-compute normalization constant so max(B) = 1.0
function gaussianSum(hour: number): number {
  let sum = 0;
  for (const k of KERNELS) {
    const diff = hour - k.mu;
    sum += k.alpha * Math.exp(-(diff * diff) / (2 * k.sigma * k.sigma));
  }
  return sum;
}

// Find the max of the raw Gaussian mixture (sample every 0.1 hour)
let RAW_MAX = 0;
for (let h = 0; h < 24; h += 0.1) {
  const v = gaussianSum(h) + FLOOR;
  if (v > RAW_MAX) RAW_MAX = v;
}

/**
 * Returns the circadian baseline B(t) for a given local hour.
 * Multi-modal Gaussian mixture normalized to [0.05, 1.0].
 */
export function circadianBaseline(hour: number): number {
  // Wrap hour to [0, 24)
  const h = ((hour % 24) + 24) % 24;
  const raw = gaussianSum(h) + FLOOR;
  return raw / RAW_MAX;
}

// ── Signal Quality ─────────────────────────────────────────────────
// Logistic sigmoid: smooth transition from "ignore" to "trust".

const SIGMOID_K = 6;
const SIGMOID_THRESHOLD = 0.25;

/**
 * Computes the quality factor q for a signal based on observed vs expected.
 * Returns 0-1: how much we should trust this signal for this city.
 */
export function computeSignalQuality(
  observed: number,
  naiveExpected: number,
): number {
  if (naiveExpected <= 0) return 0;
  const ratio = observed / naiveExpected;
  return 1 / (1 + Math.exp(-SIGMOID_K * (ratio - SIGMOID_THRESHOLD)));
}

// ── Weather Damping ────────────────────────────────────────────────
// Multiplicative suppression from environmental conditions.

/**
 * Returns a damping factor D in [0.5, 1.0].
 * 1.0 = clear weather, no suppression.
 * Lower values indicate suppressed outdoor activity.
 */
export function weatherDamping(
  weather: { tempF: number; weatherCode: number; aqi: number } | undefined,
): number {
  if (!weather) return 1.0;

  let penalty = 0;
  const { tempF, weatherCode, aqi } = weather;

  // Precipitation penalties by WMO weather code
  if ([95, 96, 99].includes(weatherCode)) {
    penalty += 0.25; // thunderstorm
  } else if ([67, 80, 81, 82].includes(weatherCode)) {
    penalty += 0.25; // heavy rain / showers
  } else if ([55, 63, 65].includes(weatherCode)) {
    penalty += 0.15; // moderate rain
  } else if ([51, 53, 61].includes(weatherCode)) {
    penalty += 0.08; // light rain / drizzle
  }

  // Snow
  if ([73, 75, 77, 85, 86].includes(weatherCode)) {
    penalty += 0.20; // moderate / heavy snow
  } else if (weatherCode === 71) {
    penalty += 0.12; // light snow
  }

  // Fog
  if ([45, 48].includes(weatherCode)) {
    penalty += 0.05;
  }

  // Temperature extremes
  if (tempF < 20) penalty += 0.10;
  if (tempF > 105) penalty += 0.10;

  // Air quality
  if (aqi > 300) {
    penalty += 0.15;
  } else if (aqi > 150) {
    penalty += 0.08;
  }

  return Math.max(0.5, 1.0 - penalty);
}

// ── Signal Weights ─────────────────────────────────────────────────

const BASE_WEIGHTS: Record<string, number> = {
  traffic: 3.0,
  bike: 2.0,
  poi: 1.5,
  air: 1.0,
  maritime: 0.5,
};

// ── Core UPI Computation ───────────────────────────────────────────

/**
 * Computes the Urban Pulse Index from a bundle of available signals.
 *
 * Core equation: UPI = clamp(B(t) × M × D, 0, 1) × 100
 *
 * - B(t): circadian baseline from Gaussian mixture
 * - M: quality-weighted geometric mean of signal deviations
 * - D: weather damping factor
 */
export function computeUPI(
  bundle: SignalBundle,
  city: City,
  localHour: number,
): UPIResult {
  const B = circadianBaseline(localHour);
  const signals: Record<string, SignalDetail> = {};
  const EPS = 1; // prevent division by zero

  // ── Compute per-signal quality and deviation ──

  // Traffic (Waze)
  if (bundle.traffic) {
    const observed = bundle.traffic.alertCount;
    const naiveExpected =
      (city.population / 1_000_000) *
      (city.vehiclesPer1000 / 200) *
      B *
      50;
    const quality = computeSignalQuality(observed, naiveExpected);
    const deviation = observed / (naiveExpected * B + EPS);

    signals.traffic = {
      observed,
      expected: Math.round(naiveExpected),
      penetrationRatio: naiveExpected > 0 ? observed / naiveExpected : 0,
      quality,
      deviation,
      effectiveWeight: quality * BASE_WEIGHTS.traffic,
    };
  }

  // Aircraft
  if (bundle.air) {
    const observed = bundle.air.aircraftCount;
    const naiveExpected = 15 * B + 5;
    const quality = computeSignalQuality(observed, naiveExpected);
    const deviation = observed / (naiveExpected * B + EPS);

    signals.air = {
      observed,
      expected: Math.round(naiveExpected),
      penetrationRatio: naiveExpected > 0 ? observed / naiveExpected : 0,
      quality,
      deviation,
      effectiveWeight: quality * BASE_WEIGHTS.air,
    };
  }

  // Maritime
  if (bundle.maritime) {
    const observed = bundle.maritime.vesselCount;
    const naiveExpected = 15; // ports operate 24/7
    const quality = computeSignalQuality(observed, naiveExpected);
    // Maritime doesn't vary much with time — deviation relative to flat baseline
    const deviation = observed / (naiveExpected + EPS);

    signals.maritime = {
      observed,
      expected: naiveExpected,
      penetrationRatio: naiveExpected > 0 ? observed / naiveExpected : 0,
      quality,
      deviation,
      effectiveWeight: quality * BASE_WEIGHTS.maritime,
    };
  }

  // Bike share (self-normalizing: utilization is already relative)
  if (bundle.bike) {
    const utilization = bundle.bike.avgUtilization;
    // Self-normalizing: always q = 1.0 when data is available
    const quality = 1.0;
    // Deviation: compare utilization to what baseline predicts
    const deviation = Math.max(0.1, Math.min(3.0, utilization / (B + 0.01)));

    signals.bike = {
      observed: Math.round(utilization * 100),
      expected: Math.round(B * 100),
      penetrationRatio: 1.0,
      quality,
      deviation,
      effectiveWeight: quality * BASE_WEIGHTS.bike,
    };
  }

  // POI activity (self-normalizing: already 0-100)
  if (bundle.poi && bundle.poi.avgActivity > 0) {
    const avgActivity = bundle.poi.avgActivity;
    const quality = 1.0;
    const deviation = Math.max(0.1, Math.min(3.0, (avgActivity / 100) / (B + 0.01)));

    signals.poi = {
      observed: Math.round(avgActivity),
      expected: Math.round(B * 100),
      penetrationRatio: 1.0,
      quality,
      deviation,
      effectiveWeight: quality * BASE_WEIGHTS.poi,
    };
  }

  // ── Compute aggregate modifier M (quality-weighted geometric mean) ──

  let totalWeight = 0;
  let logSum = 0;

  for (const key of Object.keys(signals)) {
    const s = signals[key];
    if (s.effectiveWeight < 0.01) continue;
    // Clamp deviation to [0.3, 3.0] to prevent extreme values
    const clampedDev = Math.max(0.3, Math.min(3.0, s.deviation));
    logSum += s.effectiveWeight * Math.log(clampedDev);
    totalWeight += s.effectiveWeight;
  }

  let M: number;
  if (totalWeight < 0.1) {
    // No reliable signals — no modification
    M = 1.0;
  } else {
    M = Math.exp(logSum / totalWeight);
    // Clamp M to [0.5, 2.0]
    M = Math.max(0.5, Math.min(2.0, M));
  }

  // ── Weather damping ──

  const D = weatherDamping(bundle.weather);

  // ── Final score ──

  const raw = B * M * D;
  const score = Math.min(100, Math.max(0, Math.round(raw * 100)));

  const signalCount = Object.values(signals).filter((s) => s.quality > 0.3).length;

  return {
    score,
    baseline: Math.round(B * 100),
    modifier: Math.round(M * 100) / 100,
    damping: Math.round(D * 100) / 100,
    signalCount,
    signals,
  };
}
