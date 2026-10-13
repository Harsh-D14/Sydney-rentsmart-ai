import { NextRequest, NextResponse } from "next/server";
import { estimateCommuteMinutes, haversineKm } from "@/lib/geo";
import { fetchOrsDirections, isOrsConfigured } from "@/lib/ors-directions";
import { rateLimit } from "@/lib/rate-limit";
import {
  CACHE_NONE,
  CACHE_REAL,
  parseRoutePoints,
  type RoutePoints,
} from "@/lib/route-params";
import {
  nextSydneyWeekday,
  parseTransitJourneys,
  TRANSIT_DEPARTURE_TIME,
  type TransitResult,
} from "@/lib/tfnsw-trip";

// Worst case is ORS (10 s) then the Google fallback (8 s), with TfNSW (8 s)
// running alongside; leave headroom for cold start.
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Generic failure codes sent to the client. Details stay in server logs. */
type LookupError = "unavailable" | "not_configured";

interface DrivingResult {
  duration_min: number;
  distance_km: number;
  traffic_note: string;
  /** True only for the straight-line fallback, never for a routed answer. */
  is_estimate: boolean;
}

interface CommuteResponse {
  transit: TransitResult | null;
  transit_error?: LookupError;
  driving: DrivingResult | null;
  driving_error?: LookupError;
  straight_line_km: number;
}

type Lookup<T> = { result: T; error?: undefined } | { result: null; error: LookupError };

const UPSTREAM_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// TfNSW Trip Planner
// ---------------------------------------------------------------------------

async function fetchTransit(p: RoutePoints): Promise<Lookup<TransitResult>> {
  const apiKey = process.env.TFNSW_API_KEY;
  if (!apiKey) return { result: null, error: "not_configured" };

  const params = new URLSearchParams({
    outputFormat: "rapidJSON",
    coordOutputFormat: "EPSG:4326",
    type_origin: "coord",
    name_origin: `${p.fromLng}:${p.fromLat}:EPSG:4326`,
    type_destination: "coord",
    name_destination: `${p.toLng}:${p.toLat}:EPSG:4326`,
    depArrMacro: "dep",
    // TfNSW reads both of these as Sydney local time
    itdDate: nextSydneyWeekday(),
    itdTime: TRANSIT_DEPARTURE_TIME,
    calcNumberOfTrips: "3",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

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
      console.error(`TfNSW trip ${resp.status}: ${text.slice(0, 200)}`);
      return { result: null, error: "unavailable" };
    }

    const result = parseTransitJourneys(await resp.json());
    if (!result) {
      console.error("TfNSW trip: no usable journey in response");
      return { result: null, error: "unavailable" };
    }
    return { result };
  } catch (err) {
    console.error("TfNSW trip error:", err);
    return { result: null, error: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// ORS Directions API (primary) → Google Routes API (fallback)
// ---------------------------------------------------------------------------

async function fetchGoogleDriving(
  p: RoutePoints,
  googleKey: string,
): Promise<DrivingResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

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
              latLng: { latitude: p.fromLat, longitude: p.fromLng },
            },
          },
          destination: {
            location: {
              latLng: { latitude: p.toLat, longitude: p.toLng },
            },
          },
          travelMode: "DRIVE",
          // Answers are cached for a day, so live traffic would go stale
          routingPreference: "TRAFFIC_UNAWARE",
        }),
        signal: controller.signal,
      },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`Google Routes ${resp.status}: ${text.slice(0, 200)}`);
      throw new Error(`Google Routes responded ${resp.status}`);
    }

    const data = await resp.json();
    const route = data?.routes?.[0];
    if (!route) throw new Error("Google Routes returned no route");

    // Durations arrive as strings like "1234s"
    const durationStr: unknown = route.duration ?? route.staticDuration;
    const durationSec =
      typeof durationStr === "string" ? parseInt(durationStr, 10) : NaN;
    if (!Number.isFinite(durationSec)) {
      throw new Error("Google Routes returned no duration");
    }

    const distanceM = typeof route.distanceMeters === "number" ? route.distanceMeters : 0;
    const isTrafficAware = route.duration && route.duration !== route.staticDuration;

    return {
      duration_min: Math.round(durationSec / 60),
      distance_km: Math.round(distanceM / 100) / 10,
      traffic_note: isTrafficAware ? "with current traffic" : "typical conditions",
      is_estimate: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDriving(p: RoutePoints): Promise<Lookup<DrivingResult>> {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!isOrsConfigured() && !googleKey) {
    return { result: null, error: "not_configured" };
  }

  if (isOrsConfigured()) {
    try {
      const result = await fetchOrsDirections(
        p.fromLat,
        p.fromLng,
        p.toLat,
        p.toLng,
        "driving",
      );
      return {
        result: {
          duration_min: result.duration_minutes,
          distance_km: result.distance_km,
          traffic_note: "typical conditions (ORS)",
          is_estimate: false,
        },
      };
    } catch (err) {
      console.error("ORS driving lookup failed:", err);
      // Fall through to Google
    }
  }

  if (googleKey) {
    try {
      return { result: await fetchGoogleDriving(p, googleKey) };
    } catch (err) {
      console.error("Google driving lookup failed:", err);
    }
  }

  return { result: null, error: "unavailable" };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "commute", 60);
  if (limited) return limited;

  const parsed = parseRoutePoints(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: 400, headers: { "Cache-Control": CACHE_NONE } },
    );
  }

  try {
    const points = parsed.points;

    // Straight-line distance (always available)
    const exactKm = haversineKm(
      points.fromLat,
      points.fromLng,
      points.toLat,
      points.toLng,
    );
    const straightLineKm = Math.round(exactKm * 10) / 10;

    // Fetch transit + driving in parallel (neither lookup throws)
    const [transit, driving] = await Promise.all([
      fetchTransit(points),
      fetchDriving(points),
    ]);

    const response: CommuteResponse = {
      transit: transit.result,
      driving: driving.result,
      straight_line_km: straightLineKm,
    };

    if (transit.error) response.transit_error = transit.error;

    if (driving.error) {
      response.driving_error = driving.error;
      // Fallback: indicative time from straight-line distance, flagged as such
      response.driving = {
        duration_min: estimateCommuteMinutes(exactKm),
        distance_km: Math.round(exactKm * 1.3 * 10) / 10,
        traffic_note: "estimate (API unavailable)",
        is_estimate: true,
      };
    }

    // Cache only a fully real answer: driving was routed by an API, and
    // transit either succeeded or is switched off by configuration (a stable
    // state, unlike an outage). Anything else is a temporary degradation that
    // must not be pinned in the CDN for a day.
    const drivingIsReal = !driving.error;
    const transitIsSettled = !transit.error || transit.error === "not_configured";
    const cacheControl = drivingIsReal && transitIsSettled ? CACHE_REAL : CACHE_NONE;

    return NextResponse.json(response, {
      headers: { "Cache-Control": cacheControl },
    });
  } catch (err) {
    console.error("GET /api/commute error:", err);
    return NextResponse.json(
      { error: "Commute lookup failed" },
      { status: 500, headers: { "Cache-Control": CACHE_NONE } },
    );
  }
}
