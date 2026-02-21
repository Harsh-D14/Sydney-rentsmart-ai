import stationData from "@/data/train_stations.json";
import { getSuburbByPostcode } from "@/lib/suburbs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrainStation {
  name: string;
  lat: number;
  lng: number;
  lines: string[];
  type: "heavy_rail" | "metro" | "light_rail" | "ferry";
}

export interface NearestStationResult {
  station: TrainStation;
  distanceKm: number;
}

export interface CommuteEstimate {
  distanceKm: number;
  estimatedMinutes: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Station data
// ---------------------------------------------------------------------------

const stations: TrainStation[] = stationData as TrainStation[];

export function getAllStations(): TrainStation[] {
  return stations;
}

// ---------------------------------------------------------------------------
// Haversine distance
// ---------------------------------------------------------------------------

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Returns distance in kilometres between two lat/lng points. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Nearest station
// ---------------------------------------------------------------------------

export function getNearestStation(
  lat: number,
  lng: number,
): NearestStationResult | null {
  if (stations.length === 0) return null;

  let best: TrainStation = stations[0];
  let bestDist = Infinity;

  for (const s of stations) {
    const d = haversineKm(lat, lng, s.lat, s.lng);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }

  return {
    station: best,
    distanceKm: Math.round(bestDist * 10) / 10, // 1 decimal
  };
}

/**
 * Get all stations within a given radius, sorted by distance.
 * Default radius: 0.5 km. Max recommended: 0.75 km.
 */
export function getNearbyStations(
  lat: number,
  lng: number,
  radiusKm = 0.5,
): NearestStationResult[] {
  const results: NearestStationResult[] = [];

  for (const s of stations) {
    const d = haversineKm(lat, lng, s.lat, s.lng);
    if (d <= radiusKm) {
      results.push({ station: s, distanceKm: Math.round(d * 100) / 100 });
    }
  }

  results.sort((a, b) => a.distanceKm - b.distanceKm);
  return results;
}

// ---------------------------------------------------------------------------
// Commute time estimate
// ---------------------------------------------------------------------------

/**
 * Rough commute time estimate based on straight-line distance between two
 * postcodes.  Uses distance_km * 2.5 min as a rough Sydney average that
 * accounts for non-straight routes and transit waits.
 */
export function estimateCommuteTime(
  fromPostcode: string,
  toPostcode: string,
): CommuteEstimate | null {
  const from = getSuburbByPostcode(fromPostcode);
  const to = getSuburbByPostcode(toPostcode);

  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) return null;

  if (fromPostcode === toPostcode) {
    return { distanceKm: 0, estimatedMinutes: 5, label: "~5 min" };
  }

  const dist = haversineKm(from.lat, from.lng, to.lat, to.lng);
  const minutes = Math.max(5, Math.round(dist * 2.5));

  return {
    distanceKm: Math.round(dist * 10) / 10,
    estimatedMinutes: minutes,
    label: `~${minutes} min`,
  };
}

/**
 * Estimate commute time from a lat/lng to a postcode.
 * Uses distance_km * 2.5 min as a rough Sydney average.
 */
export function estimateCommuteFromCoords(
  fromLat: number,
  fromLng: number,
  toPostcode: string,
): CommuteEstimate | null {
  const to = getSuburbByPostcode(toPostcode);
  if (!to?.lat || !to?.lng) return null;

  const dist = haversineKm(fromLat, fromLng, to.lat, to.lng);
  const minutes = Math.max(5, Math.round(dist * 2.5));

  return {
    distanceKm: Math.round(dist * 10) / 10,
    estimatedMinutes: minutes,
    label: `~${minutes} min`,
  };
}
