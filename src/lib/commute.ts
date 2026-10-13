import stationData from "@/data/train_stations.json";
import { haversineKm } from "@/lib/geo";

// SydneyMap imports haversineKm from here; the implementation lives in geo.ts.
export { haversineKm };

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

// ---------------------------------------------------------------------------
// Station data
// ---------------------------------------------------------------------------

const stations: TrainStation[] = stationData as TrainStation[];

export function getAllStations(): TrainStation[] {
  return stations;
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
