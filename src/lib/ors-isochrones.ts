import { API_CONFIG, getOrsHeaders, toOrsCoords } from "@/config/apis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IsochroneResult {
  geojson: GeoJSON.FeatureCollection;
  ranges_minutes: number[];
}

// ---------------------------------------------------------------------------
// ORS Isochrones API client
// ---------------------------------------------------------------------------

/**
 * Fetch isochrone polygons from ORS for a given origin and time ranges.
 *
 * @param lat - Origin latitude
 * @param lng - Origin longitude
 * @param rangesMinutes - Array of travel-time thresholds in minutes, e.g. [30, 45]
 * @returns GeoJSON FeatureCollection with one polygon per range
 */
export async function fetchOrsIsochrones(
  lat: number,
  lng: number,
  rangesMinutes: number[],
): Promise<IsochroneResult> {
  const { baseUrl, endpoints } = API_CONFIG.openRouteService;
  const url = `${baseUrl}${endpoints.isochrones}`;

  const body = {
    locations: [toOrsCoords(lat, lng)],
    range: rangesMinutes.map((m) => m * 60), // convert to seconds
    range_type: "time",
    attributes: ["area"],
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
        `ORS Isochrones API ${resp.status}: ${text.slice(0, 300)}`,
      );
    }

    const geojson = (await resp.json()) as GeoJSON.FeatureCollection;

    return {
      geojson,
      ranges_minutes: rangesMinutes,
    };
  } finally {
    clearTimeout(timeout);
  }
}
