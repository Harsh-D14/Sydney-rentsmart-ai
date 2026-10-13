import { isInGreaterSydney } from "@/lib/geo";

// ---------------------------------------------------------------------------
// Shared request helpers for the routing proxies (/api/commute, /api/directions)
// ---------------------------------------------------------------------------

export interface RoutePoints {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

export type RoutePointsResult =
  | { ok: true; points: RoutePoints }
  | { ok: false; error: string };

/** Shared-cache policy for a fully real (routed) answer: 24 h fresh, 7 d stale. */
export const CACHE_REAL = "public, s-maxage=86400, stale-while-revalidate=604800";

/** Policy for anything degraded, estimated or failed: never stored. */
export const CACHE_NONE = "no-store";

/**
 * Round to 3 decimals (about 110 m). Coarse enough that equivalent requests
 * collapse onto one upstream call, fine enough not to move a suburb centroid.
 */
export function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Strict numeric parse: rejects "", whitespace and trailing junk like "12abc". */
function parseCoord(raw: string | null): number {
  if (raw === null || raw.trim() === "") return NaN;
  return Number(raw);
}

/**
 * Read from_lat/from_lng/to_lat/to_lng, round them, and require both points
 * to sit inside Greater Sydney.
 */
export function parseRoutePoints(params: URLSearchParams): RoutePointsResult {
  const raw = [
    parseCoord(params.get("from_lat")),
    parseCoord(params.get("from_lng")),
    parseCoord(params.get("to_lat")),
    parseCoord(params.get("to_lng")),
  ];

  if (!raw.every(Number.isFinite)) {
    return {
      ok: false,
      error: "Missing or invalid params: from_lat, from_lng, to_lat, to_lng",
    };
  }

  const [fromLat, fromLng, toLat, toLng] = raw.map(roundCoord);

  if (!isInGreaterSydney(fromLat, fromLng) || !isInGreaterSydney(toLat, toLng)) {
    return {
      ok: false,
      error: "Both points must be within Greater Sydney",
    };
  }

  return { ok: true, points: { fromLat, fromLng, toLat, toLng } };
}
