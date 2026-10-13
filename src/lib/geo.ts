// ---------------------------------------------------------------------------
// Shared geography helpers — the single home for distance and commute maths
// ---------------------------------------------------------------------------

/** Returns distance in kilometres between two lat/lng points. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Indicative commute time from straight-line distance. Not route-based:
 * used only until (or instead of) a routed time from an external service.
 */
export function estimateCommuteMinutes(distKm: number): number {
  // 7 min/km meets the next band at 3 km (21 min), so estimates never drop
  if (distKm < 3) return Math.max(5, Math.round(distKm * 7));
  if (distKm < 10) return Math.round(15 + distKm * 2);
  if (distKm < 30) return Math.round(20 + distKm * 1.8);
  return Math.round(30 + distKm * 1.5);
}

/** Generous box around Greater Sydney, used to reject out-of-area API calls. */
export const GREATER_SYDNEY_BOUNDS = {
  minLat: -34.5,
  maxLat: -33.0,
  minLng: 150.1,
  maxLng: 151.7,
} as const;

export function isInGreaterSydney(lat: number, lng: number): boolean {
  const b = GREATER_SYDNEY_BOUNDS;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= b.minLat &&
    lat <= b.maxLat &&
    lng >= b.minLng &&
    lng <= b.maxLng
  );
}
