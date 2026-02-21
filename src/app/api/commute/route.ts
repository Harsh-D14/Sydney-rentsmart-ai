import { NextRequest, NextResponse } from "next/server";
import { fetchOrsDirections } from "@/lib/ors-directions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransitResult {
  duration_min: number;
  transfers: number;
  modes: string[];
  summary: string;
  departure: string;
  arrival: string;
}

interface DrivingResult {
  duration_min: number;
  distance_km: number;
  traffic_note: string;
}

interface CommuteResponse {
  transit: TransitResult | null;
  transit_error?: string;
  driving: DrivingResult | null;
  driving_error?: string;
  straight_line_km: number;
}

interface CachedResult {
  data: CommuteResponse;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// In-memory cache (24-hour TTL)
// ---------------------------------------------------------------------------

const cache = new Map<string, CachedResult>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): string {
  return `${fromLat.toFixed(2)}_${fromLng.toFixed(2)}_${toLat.toFixed(2)}_${toLng.toFixed(2)}`;
}

function getCached(key: string): CommuteResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

// ---------------------------------------------------------------------------
// Haversine
// ---------------------------------------------------------------------------

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getNextWeekdayFormatted(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  // If weekend, advance to Monday
  if (day === 0) now.setDate(now.getDate() + 1);
  else if (day === 6) now.setDate(now.getDate() + 2);

  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// ---------------------------------------------------------------------------
// TfNSW Trip Planner
// ---------------------------------------------------------------------------

async function fetchTransit(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<TransitResult> {
  const apiKey = process.env.TFNSW_API_KEY;
  if (!apiKey) throw new Error("TFNSW_API_KEY not configured");

  const params = new URLSearchParams({
    outputFormat: "rapidJSON",
    coordOutputFormat: "EPSG:4326",
    type_origin: "coord",
    name_origin: `${fromLng}:${fromLat}:EPSG:4326`,
    type_destination: "coord",
    name_destination: `${toLng}:${toLat}:EPSG:4326`,
    depArrMacro: "dep",
    itdDate: getNextWeekdayFormatted(),
    itdTime: "0800",
    calcNumberOfTrips: "3",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(
      `https://api.transport.nsw.gov.au/v1/tp/trip?${params}`,
      {
        headers: { Authorization: `apikey ${apiKey}` },
        signal: controller.signal,
      },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`TfNSW API ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const journeys = data?.journeys;
    if (!journeys || journeys.length === 0) {
      throw new Error("No transit journeys found");
    }

    // Pick the first (best) journey
    const journey = journeys[0];
    const legs = journey.legs ?? [];

    // Total duration from first departure to last arrival
    const firstDep = new Date(legs[0]?.origin?.departureTimePlanned);
    const lastArr = new Date(legs[legs.length - 1]?.destination?.arrivalTimePlanned);
    const durationMin = Math.round((lastArr.getTime() - firstDep.getTime()) / 60000);

    // Transport modes (exclude walking for transfer count)
    const transitLegs = legs.filter(
      (l: { transportation?: { product?: { class?: number } } }) => {
        const cls = l.transportation?.product?.class;
        // TfNSW class 100 = walking/footpath
        return cls !== undefined && cls !== 100 && cls !== 99;
      },
    );

    const modeMap: Record<number, string> = {
      1: "train",
      2: "metro",
      4: "light_rail",
      5: "bus",
      9: "ferry",
      11: "school_bus",
    };

    const modes = new Set<string>();
    const stationNames: string[] = [];

    for (const leg of transitLegs) {
      const cls = leg.transportation?.product?.class as number | undefined;
      if (cls !== undefined && modeMap[cls]) {
        modes.add(modeMap[cls]);
      }
      const destName = leg.destination?.name;
      if (destName && typeof destName === "string") {
        stationNames.push(destName.split(",")[0].trim());
      }
    }

    // Always include walking in modes if there are walking legs
    const hasWalking = legs.some(
      (l: { transportation?: { product?: { class?: number } } }) =>
        l.transportation?.product?.class === 100 ||
        l.transportation?.product?.class === 99,
    );
    if (hasWalking) modes.add("walking");

    const transfers = Math.max(0, transitLegs.length - 1);

    // Summary: primary mode via key stations
    const primaryMode =
      modes.has("train") ? "Train" :
      modes.has("metro") ? "Metro" :
      modes.has("light_rail") ? "Light Rail" :
      modes.has("ferry") ? "Ferry" :
      modes.has("bus") ? "Bus" :
      "Transit";

    const viaPart =
      stationNames.length > 0
        ? ` via ${stationNames.slice(0, 2).join(" → ")}`
        : "";
    const summary = `${primaryMode}${viaPart}`;

    // Format departure/arrival times
    const depStr = firstDep.toLocaleTimeString("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const arrStr = lastArr.toLocaleTimeString("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return {
      duration_min: durationMin > 0 ? durationMin : 0,
      transfers,
      modes: Array.from(modes),
      summary,
      departure: depStr,
      arrival: arrStr,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// ORS Directions API (primary) → Google Routes API (fallback)
// ---------------------------------------------------------------------------

async function fetchDriving(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<DrivingResult> {
  // Try ORS first (uses OPENROUTE_API_KEY)
  const orsKey = process.env.OPENROUTE_API_KEY;
  if (orsKey) {
    try {
      const result = await fetchOrsDirections(fromLat, fromLng, toLat, toLng, "driving");
      return {
        duration_min: result.duration_minutes,
        distance_km: result.distance_km,
        traffic_note: "typical conditions (ORS)",
      };
    } catch {
      // Fall through to Google or haversine fallback
    }
  }

  // Fallback: Google Routes API
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": googleKey,
            "X-Goog-FieldMask":
              "routes.duration,routes.distanceMeters,routes.staticDuration",
          },
          body: JSON.stringify({
            origin: {
              location: {
                latLng: { latitude: fromLat, longitude: fromLng },
              },
            },
            destination: {
              location: {
                latLng: { latitude: toLat, longitude: toLng },
              },
            },
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_AWARE",
          }),
          signal: controller.signal,
        },
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Google Routes API ${resp.status}: ${text.slice(0, 200)}`);
      }

      const data = await resp.json();
      const route = data?.routes?.[0];
      if (!route) throw new Error("No driving route found");

      const durationStr: string = route.duration ?? route.staticDuration ?? "0s";
      const durationSec = parseInt(durationStr.replace("s", ""), 10) || 0;
      const durationMin = Math.round(durationSec / 60);

      const distanceM: number = route.distanceMeters ?? 0;
      const distanceKm = Math.round(distanceM / 100) / 10;

      const isTrafficAware = route.duration && route.duration !== route.staticDuration;

      return {
        duration_min: durationMin,
        distance_km: distanceKm,
        traffic_note: isTrafficAware ? "with current traffic" : "typical conditions",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("No driving API configured (set OPENROUTE_API_KEY or GOOGLE_MAPS_API_KEY)");
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const fromLat = parseFloat(params.get("from_lat") ?? "");
    const fromLng = parseFloat(params.get("from_lng") ?? "");
    const toLat = parseFloat(params.get("to_lat") ?? "");
    const toLng = parseFloat(params.get("to_lng") ?? "");

    if ([fromLat, fromLng, toLat, toLng].some(isNaN)) {
      return NextResponse.json(
        { error: "Missing or invalid params: from_lat, from_lng, to_lat, to_lng" },
        { status: 400 },
      );
    }

    // Straight-line distance (always available)
    const straightLineKm =
      Math.round(haversineKm(fromLat, fromLng, toLat, toLng) * 10) / 10;

    // Check cache
    const key = cacheKey(fromLat, fromLng, toLat, toLng);
    const cached = getCached(key);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Fetch transit + driving in parallel
    const [transitResult, drivingResult] = await Promise.allSettled([
      fetchTransit(fromLat, fromLng, toLat, toLng),
      fetchDriving(fromLat, fromLng, toLat, toLng),
    ]);

    const response: CommuteResponse = {
      transit: null,
      driving: null,
      straight_line_km: straightLineKm,
    };

    if (transitResult.status === "fulfilled") {
      response.transit = transitResult.value;
    } else {
      response.transit_error = transitResult.reason?.message ?? "Transit lookup failed";
    }

    if (drivingResult.status === "fulfilled") {
      response.driving = drivingResult.value;
    } else {
      response.driving_error = drivingResult.reason?.message ?? "Driving lookup failed";
      // Fallback: estimate driving from haversine
      const estimatedMin = Math.round(straightLineKm * 2);
      response.driving = {
        duration_min: estimatedMin,
        distance_km: Math.round(straightLineKm * 1.3 * 10) / 10,
        traffic_note: "estimate (API unavailable)",
      };
    }

    // Cache the result
    cache.set(key, { data: response, timestamp: Date.now() });

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
