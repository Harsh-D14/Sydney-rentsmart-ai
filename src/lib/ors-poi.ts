import { API_CONFIG, getOrsHeaders } from "@/config/apis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoiResult {
  name: string;
  distance_m: number;
  category: string;
  lat: number;
  lng: number;
}

// ORS category IDs for amenity types we care about
const CATEGORY_IDS = [
  206, // hospital
  207, // doctors
  208, // pharmacy
  566, // fire_station
  601, // school
  604, // railway_station
  161, // university
];

const CATEGORY_NAMES: Record<number, string> = {
  206: "hospital",
  207: "medical_clinic",
  208: "pharmacy",
  566: "fire_station",
  601: "school",
  604: "train_station",
  161: "university",
};

// ---------------------------------------------------------------------------
// ORS POI API client (fallback for Overpass)
// ---------------------------------------------------------------------------

/**
 * Query ORS Points-of-Interest endpoint around a given location.
 *
 * This is a fallback: Overpass is the primary free source.
 * ORS POI has limited category coverage compared to Overpass.
 *
 * @param lat - Center latitude
 * @param lng - Center longitude
 * @param radiusMeters - Search radius (default 3000)
 */
export async function fetchOrsPoi(
  lat: number,
  lng: number,
  radiusMeters = 3000,
): Promise<PoiResult[]> {
  const { baseUrl, endpoints } = API_CONFIG.openRouteService;
  const url = `${baseUrl}${endpoints.poi}`;

  const body = {
    request: "pois",
    geometry: {
      geojson: {
        type: "Point",
        coordinates: [lng, lat],
      },
      buffer: radiusMeters,
    },
    filters: {
      category_ids: CATEGORY_IDS,
    },
    sortby: "distance",
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
      throw new Error(`ORS POI API ${resp.status}: ${text.slice(0, 300)}`);
    }

    const data = await resp.json();
    const features = data.features ?? [];

    return features.map(
      (f: {
        geometry: { coordinates: [number, number] };
        properties: {
          osm_tags?: { name?: string };
          distance?: number;
          category_ids?: Record<string, number[]>;
        };
      }) => {
        const [fLng, fLat] = f.geometry.coordinates;
        const props = f.properties;

        // Resolve category name from the first matching category_id
        let category = "unknown";
        const catIds = props.category_ids;
        if (catIds) {
          for (const group of Object.values(catIds)) {
            for (const id of group) {
              if (CATEGORY_NAMES[id]) {
                category = CATEGORY_NAMES[id];
                break;
              }
            }
            if (category !== "unknown") break;
          }
        }

        return {
          name: props.osm_tags?.name ?? category,
          distance_m: props.distance ?? 0,
          category,
          lat: fLat,
          lng: fLng,
        };
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}
