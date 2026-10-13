import { API_CONFIG, buildOverpassQuery } from "@/config/apis";
import { haversineKm } from "@/lib/geo";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmenityItem {
  name: string;
  distance_km: number;
  lat: number;
  lng: number;
}

export interface CategorizedAmenities {
  hospitals: AmenityItem[];
  schools: AmenityItem[];
  universities: AmenityItem[];
  fire_stations: AmenityItem[];
  pharmacies: AmenityItem[];
  medical_clinics: AmenityItem[];
  childcare: AmenityItem[];
  supermarkets: AmenityItem[];
  parks: AmenityItem[];
  gyms: AmenityItem[];
  libraries: AmenityItem[];
  train_stations: AmenityItem[];
}

interface OverpassElement {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyCategorized(): CategorizedAmenities {
  return {
    hospitals: [],
    schools: [],
    universities: [],
    fire_stations: [],
    pharmacies: [],
    medical_clinics: [],
    childcare: [],
    supermarkets: [],
    parks: [],
    gyms: [],
    libraries: [],
    train_stations: [],
  };
}

/** Extract lat/lng from an Overpass element (node or way with center). */
function getCoords(el: OverpassElement): { lat: number; lng: number } | null {
  if (el.lat != null && el.lon != null) {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

/** Categorize an Overpass element by its tags. Returns the category key or null. */
function categorize(
  tags: Record<string, string>,
): keyof CategorizedAmenities | null {
  const amenity = tags.amenity;
  const shop = tags.shop;
  const leisure = tags.leisure;
  const railway = tags.railway;

  if (amenity === "hospital") return "hospitals";
  if (amenity === "school") return "schools";
  if (amenity === "university") return "universities";
  if (amenity === "fire_station") return "fire_stations";
  if (amenity === "pharmacy") return "pharmacies";
  if (amenity === "doctors" || amenity === "clinic") return "medical_clinics";
  if (amenity === "childcare" || amenity === "kindergarten") return "childcare";
  if (amenity === "library") return "libraries";
  if (shop === "supermarket") return "supermarkets";
  if (leisure === "park") return "parks";
  if (leisure === "fitness_centre") return "gyms";
  if (railway === "station" || railway === "halt") return "train_stations";

  return null;
}

// ---------------------------------------------------------------------------
// Overpass API client
// ---------------------------------------------------------------------------

/**
 * Fetch nearby amenities from the Overpass API (free OSM data).
 *
 * @param lat - Center latitude
 * @param lng - Center longitude
 * @param radiusMeters - Search radius (default 3000)
 * @returns Categorized amenities sorted by distance within each category
 */
export async function fetchOverpassAmenities(
  lat: number,
  lng: number,
  radiusMeters = 3000,
): Promise<CategorizedAmenities> {
  const query = buildOverpassQuery(lat, lng, radiusMeters);
  const url = API_CONFIG.overpass.baseUrl;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    API_CONFIG.overpass.timeout * 1000,
  );

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": API_CONFIG.overpass.userAgent,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Overpass API ${resp.status}: ${text.slice(0, 300)}`);
    }

    const data = await resp.json();
    // Overpass reports a server-side timeout as HTTP 200 with a `remark` and
    // partial (usually empty) results. Treat it as a failure so an empty
    // answer is never cached as if the area had no amenities.
    if (typeof data.remark === "string" && /error/i.test(data.remark)) {
      throw new Error(`Overpass API remark: ${data.remark.slice(0, 300)}`);
    }
    const elements: OverpassElement[] = data.elements ?? [];

    const result = emptyCategorized();

    for (const el of elements) {
      if (!el.tags) continue;
      const category = categorize(el.tags);
      if (!category) continue;

      const coords = getCoords(el);
      if (!coords) continue;

      const distance = haversineKm(lat, lng, coords.lat, coords.lng);

      result[category].push({
        name: el.tags.name ?? el.tags.operator ?? category,
        distance_km: Math.round(distance * 100) / 100,
        lat: coords.lat,
        lng: coords.lng,
      });
    }

    // Sort each category by distance
    for (const key of Object.keys(result) as (keyof CategorizedAmenities)[]) {
      result[key].sort((a, b) => a.distance_km - b.distance_km);
    }

    return result;
  } finally {
    clearTimeout(timeout);
  }
}
