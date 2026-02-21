import { API_CONFIG, getOrsHeaders, toOrsCoords } from "@/config/apis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/**
 * Fetch turn-by-turn route geometry + summary from ORS.
 *
 * @param mode - "driving" uses driving-car, "cycling" uses cycling-regular
 * @returns Decoded geometry as [lat, lng] pairs, duration in minutes, distance in km
 */
export async function fetchOrsDirections(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  mode: "driving" | "cycling" = "driving",
): Promise<DirectionsResult> {
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
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: getOrsHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(
        `ORS Directions API ${resp.status}: ${text.slice(0, 300)}`,
      );
    }

    const data = await resp.json();
    const route = data.routes?.[0];
    if (!route) throw new Error("No route returned from ORS");

    const durationSec: number = route.summary?.duration ?? 0;
    const distanceM: number = route.summary?.distance ?? 0;

    // ORS returns encoded polyline in route.geometry
    const geometry = decodePolyline(route.geometry as string);

    return {
      duration_minutes: Math.round(durationSec / 60),
      distance_km: Math.round(distanceM / 100) / 10,
      geometry,
    };
  } finally {
    clearTimeout(timeout);
  }
}
