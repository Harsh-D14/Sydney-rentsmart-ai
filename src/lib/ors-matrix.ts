import { API_CONFIG, getOrsHeaders, toOrsCoords } from "@/config/apis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MatrixRequest {
  locations: [number, number][];
  sources: number[];
  destinations: number[];
  metrics: ("duration" | "distance")[];
  units: "km";
}

export interface MatrixResult {
  durations_min: number[][];
  distances_km: number[][];
}

// ---------------------------------------------------------------------------
// ORS Matrix API client
// ---------------------------------------------------------------------------

/**
 * Fetch a duration/distance matrix from ORS.
 *
 * @param suburbs - Array of suburb centroids (sources)
 * @param hubs    - Array of employment hub locations (destinations)
 * @returns Matrix of durations (minutes) and distances (km)
 *
 * ORS limit: max 50 locations per request.
 * A typical call with 40 suburbs + 8 hubs = 48, fits in one batch.
 */
export async function fetchOrsMatrix(
  suburbs: { lat: number; lng: number }[],
  hubs: { lat: number; lng: number }[],
): Promise<MatrixResult> {
  const { baseUrl, endpoints } = API_CONFIG.openRouteService;
  const url = `${baseUrl}${endpoints.matrix}`;

  // Combine: suburbs first, then hubs
  const locations: [number, number][] = [
    ...suburbs.map((s) => toOrsCoords(s.lat, s.lng)),
    ...hubs.map((h) => toOrsCoords(h.lat, h.lng)),
  ];

  const sources = suburbs.map((_, i) => i);
  const destinations = hubs.map((_, i) => suburbs.length + i);

  const body: MatrixRequest = {
    locations,
    sources,
    destinations,
    metrics: ["duration", "distance"],
    units: "km",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: getOrsHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`ORS Matrix API ${resp.status}: ${text.slice(0, 300)}`);
    }

    const data = await resp.json();

    // Convert durations from seconds → rounded minutes
    const durations_min: number[][] = (data.durations as number[][]).map(
      (row) => row.map((sec) => Math.round(sec / 60)),
    );

    // Distances are already in km (we passed units: "km"), round to 1 decimal
    const distances_km: number[][] = (data.distances as number[][]).map(
      (row) => row.map((km) => Math.round(km * 10) / 10),
    );

    return { durations_min, distances_km };
  } finally {
    clearTimeout(timeout);
  }
}
