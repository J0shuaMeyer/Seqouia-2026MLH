/**
 * Solar position utilities for real-time day/night visualization.
 * No external dependencies — uses basic solar geometry approximations.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Returns the subsolar point (where the sun is directly overhead). */
export function getSunPosition(date: Date): { lat: number; lng: number } {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

  // Solar declination (approximate formula)
  const declination =
    -23.44 * Math.cos(((360 / 365) * (dayOfYear + 10)) * DEG2RAD);

  // Hour angle: sun longitude based on UTC time
  const hours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lng = -(hours / 24) * 360 + 180;

  return { lat: declination, lng };
}

/** Generates points along the day/night terminator great circle. */
export function getTerminatorPoints(
  sunLat: number,
  sunLng: number
): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  const sunLatRad = sunLat * DEG2RAD;
  const sunLngRad = sunLng * DEG2RAD;

  // The terminator is a great circle at 90 degrees from the subsolar point
  for (let i = 0; i <= 360; i += 5) {
    const angle = i * DEG2RAD;
    const lat = Math.asin(
      Math.sin(sunLatRad) * Math.cos(Math.PI / 2) +
        Math.cos(sunLatRad) * Math.sin(Math.PI / 2) * Math.cos(angle)
    );
    const lng =
      sunLngRad +
      Math.atan2(
        Math.sin(angle) * Math.sin(Math.PI / 2) * Math.cos(sunLatRad),
        Math.cos(Math.PI / 2) - Math.sin(sunLatRad) * Math.sin(lat)
      );
    points.push({
      lat: lat * RAD2DEG,
      lng: lng * RAD2DEG,
    });
  }
  return points;
}

/**
 * Converts sun lat/lng to a normalized 3D world-space direction vector.
 * Accounts for the globe mesh's internal -PI/2 Y-rotation.
 * Returns { x, y, z } suitable for use as a shader uniform.
 */
export function sunLatLngToWorldDirection(
  lat: number,
  lng: number
): { x: number; y: number; z: number } {
  const latRad = lat * DEG2RAD;
  const lngRad = lng * DEG2RAD;

  // Spherical to Cartesian (Y-up), then rotate -PI/2 around Y
  const cosLat = Math.cos(latRad);
  const x = cosLat * Math.sin(lngRad);   // after -PI/2 Y rotation
  const y = Math.sin(latRad);
  const z = cosLat * Math.cos(lngRad);   // after -PI/2 Y rotation

  // Normalize (should already be unit length, but defensive)
  const len = Math.sqrt(x * x + y * y + z * z);
  return { x: x / len, y: y / len, z: z / len };
}

/** Checks if a city is on the daytime side of the Earth. */
export function isDaytime(
  cityLat: number,
  cityLng: number,
  sunLat: number,
  sunLng: number
): boolean {
  const dLng = (sunLng - cityLng) * DEG2RAD;
  const angularDist = Math.acos(
    Math.sin(sunLat * DEG2RAD) * Math.sin(cityLat * DEG2RAD) +
      Math.cos(sunLat * DEG2RAD) *
        Math.cos(cityLat * DEG2RAD) *
        Math.cos(dLng)
  );
  return angularDist < Math.PI / 2;
}
