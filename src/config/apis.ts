// ---------------------------------------------------------------------------
// Central API configuration — all external service credentials and endpoints
// ---------------------------------------------------------------------------

export const API_CONFIG = {
  openRouteService: {
    apiKey: process.env.OPENROUTE_API_KEY || "",
    baseUrl: "https://api.openrouteservice.org",
    endpoints: {
      matrix: "/v2/matrix/driving-car",
      directionsJson: "/v2/directions/driving-car",
      directionsCycling: "/v2/directions/cycling-regular",
      isochrones: "/v2/isochrones/driving-car",
      poi: "/pois",
    },
    coordOrder: "lng-lat" as const,
  },
  overpass: {
    baseUrl: "https://overpass-api.de/api/interpreter",
    timeout: 60,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: "claude-sonnet-4-20250514",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build Authorization + Content-Type headers for ORS requests. */
export function getOrsHeaders(): Record<string, string> {
  return {
    Authorization: API_CONFIG.openRouteService.apiKey,
    "Content-Type": "application/json",
  };
}

/** Convert lat/lng to ORS coordinate order [lng, lat]. */
export function toOrsCoords(lat: number, lng: number): [number, number] {
  return [lng, lat];
}

/**
 * Build an Overpass QL query that fetches common amenity types within a radius
 * of a given lat/lng point.
 */
export function buildOverpassQuery(
  lat: number,
  lng: number,
  radiusMeters: number,
): string {
  const r = radiusMeters;
  const around = `(around:${r},${lat},${lng})`;

  // Each line queries one amenity / shop / leisure type
  return `
[out:json][timeout:${API_CONFIG.overpass.timeout}];
(
  node["amenity"="hospital"]${around};
  way["amenity"="hospital"]${around};
  node["amenity"="school"]${around};
  way["amenity"="school"]${around};
  node["amenity"="university"]${around};
  way["amenity"="university"]${around};
  node["amenity"="fire_station"]${around};
  way["amenity"="fire_station"]${around};
  node["amenity"="pharmacy"]${around};
  node["amenity"="doctors"]${around};
  node["amenity"="clinic"]${around};
  node["amenity"="childcare"]${around};
  node["amenity"="kindergarten"]${around};
  way["amenity"="kindergarten"]${around};
  node["shop"="supermarket"]${around};
  way["shop"="supermarket"]${around};
  node["leisure"="park"]${around};
  way["leisure"="park"]${around};
  node["leisure"="fitness_centre"]${around};
  way["leisure"="fitness_centre"]${around};
  node["amenity"="library"]${around};
  way["amenity"="library"]${around};
  node["railway"="station"]${around};
  node["railway"="halt"]${around};
);
out center;
`.trim();
}
