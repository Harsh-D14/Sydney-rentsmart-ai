import amenityData from "@/data/suburb_amenities.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmenityItem {
  name: string;
  distance_km: number;
  lat: number;
  lng: number;
}

export interface SuburbAmenities {
  hospitals: AmenityItem[];
  schools: AmenityItem[];
  universities: AmenityItem[];
  fire_stations: AmenityItem[];
  police: AmenityItem[];
  childcare: AmenityItem[];
}

export interface AmenitySummary {
  hospital_count: number;
  school_count: number;
  university_count: number;
  fire_station_count: number;
  police_count: number;
  childcare_count: number;
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

const data = amenityData as Record<string, SuburbAmenities>;

const EMPTY: SuburbAmenities = {
  hospitals: [],
  schools: [],
  universities: [],
  fire_stations: [],
  police: [],
  childcare: [],
};

/** Get full amenity lists for a postcode. */
export function getAmenities(postcode: string): SuburbAmenities {
  return data[postcode] ?? EMPTY;
}

/** Get counts per category for a postcode. */
export function getAmenitySummary(postcode: string): AmenitySummary {
  const a = getAmenities(postcode);
  return {
    hospital_count: a.hospitals.length,
    school_count: a.schools.length,
    university_count: a.universities.length,
    fire_station_count: a.fire_stations.length,
    police_count: a.police.length,
    childcare_count: a.childcare.length,
  };
}

/**
 * Calculate an amenity score (0–100) for a postcode.
 *
 * Scoring:
 * - Hospital within 2 km:      +25
 * - 3+ schools within 5 km:    +25
 * - University within 5 km:    +15
 * - Fire station within 5 km:  +10
 * - Police within 5 km:        +10
 * - Childcare within 3 km:     +15
 */
export function getAmenityScore(postcode: string): number {
  const a = getAmenities(postcode);
  let score = 0;

  if (a.hospitals.some((h) => h.distance_km <= 2)) score += 25;
  if (a.schools.filter((s) => s.distance_km <= 5).length >= 3) score += 25;
  if (a.universities.some((u) => u.distance_km <= 5)) score += 15;
  if (a.fire_stations.some((f) => f.distance_km <= 5)) score += 10;
  if (a.police.some((p) => p.distance_km <= 5)) score += 10;
  if (a.childcare.some((c) => c.distance_km <= 3)) score += 15;

  return score;
}
