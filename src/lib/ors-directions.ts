import { API_CONFIG, getOrsHeaders, toOrsCoords } from "@/config/apis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DirectionsMode = "driving" | "cycling";

export interface DirectionsResult {
  duration_minutes: number;
  distance_km: number;
  geometry: [number, number][]; // [lat, lng] pairs ready for Leaflet
}

// ---------------------------------------------------------------------------
// Polyline decoder (Google encoded polyline algorithm)
// ---------------------------------------------------------------------------

function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

// ---------------------------------------------------------------------------
// ORS Directions API client
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000;

/** True when an ORS key is configured; callers should check before fetching. */
export function isOrsConfigured(): boolean {
  return API_CONFIG.openRouteService.apiKey !== "";
}

/**
 * Fetch route geometry + summary from ORS.
 *
 * Throws on any failure. Error messages are for server logs only and must not
 * be sent to clients; the upstream response body is logged here, never thrown.
 *
 * @param mode - "driving" uses driving-car, "cycling" uses cycling-regular
 * @returns Decoded geometry as [lat, lng] pairs, duration in minutes, distance in km
 */
export async function fetchOrsDirections(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  mode: DirectionsMode = "driving",
): Promise<DirectionsResult> {
  if (!isOrsConfigured()) throw new Error("ORS API key not configured");

  const { baseUrl, endpoints } = API_CONFIG.openRouteService;
  const endpoint =
    mode === "cycling" ? endpoints.directionsCycling : endpoints.directionsJson;
  const url = `${baseUrl}${endpoint}`;

  const body = {
    coordinates: [toOrsCoords(fromLat, fromLng), toOrsCoords(toLat, toLng)],
    instructions: false,
    geometry: true,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: getOrsHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`ORS directions ${resp.status}: ${text.slice(0, 300)}`);
      throw new Error(`ORS directions responded ${resp.status}`);
    }

    const data = await resp.json();
    const route = data?.routes?.[0];
    if (!route) throw new Error("ORS directions returned no route");

    const durationSec: unknown = route.summary?.duration;
    const distanceM: unknown = route.summary?.distance;
    if (
      typeof durationSec !== "number" ||
      !Number.isFinite(durationSec) ||
      typeof distanceM !== "number" ||
      !Number.isFinite(distanceM)
    ) {
      throw new Error("ORS directions returned no route summary");
    }

    // ORS returns an encoded polyline string in route.geometry
    if (typeof route.geometry !== "string" || route.geometry === "") {
      throw new Error("ORS directions returned no geometry");
    }
    const geometry = decodePolyline(route.geometry);
    if (geometry.length === 0) {
      throw new Error("ORS directions returned undecodable geometry");
    }

    return {
      duration_minutes: Math.round(durationSec / 60),
      distance_km: Math.round(distanceM / 100) / 10,
      geometry,
    };
  } finally {
    clearTimeout(timeout);
  }
}
