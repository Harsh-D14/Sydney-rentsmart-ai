import { NextRequest, NextResponse } from "next/server";
import {
  fetchOrsDirections,
  isOrsConfigured,
  type DirectionsMode,
} from "@/lib/ors-directions";
import { rateLimit } from "@/lib/rate-limit";
import { CACHE_NONE, CACHE_REAL, parseRoutePoints } from "@/lib/route-params";

// Waits on ORS (10 s timeout); leave headroom for cold start.
export const maxDuration = 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDirectionsMode(value: string): value is DirectionsMode {
  return value === "driving" || value === "cycling";
}

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": CACHE_NONE } },
  );
}

// ---------------------------------------------------------------------------
// GET /api/directions
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "directions", 30);
  if (limited) return limited;

  const params = request.nextUrl.searchParams;

  const parsed = parseRoutePoints(params);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const mode = params.get("mode") ?? "driving";
  if (!isDirectionsMode(mode)) {
    return errorResponse('Invalid mode: must be "driving" or "cycling"', 400);
  }

  if (!isOrsConfigured()) {
    console.error("GET /api/directions: OPENROUTE_API_KEY not configured");
    return errorResponse("Directions service unavailable", 503);
  }

  try {
    const { fromLat, fromLng, toLat, toLng } = parsed.points;
    const result = await fetchOrsDirections(fromLat, fromLng, toLat, toLng, mode);

    // Only a real routed answer is cacheable; every error path is no-store.
    return NextResponse.json(result, {
      headers: { "Cache-Control": CACHE_REAL },
    });
  } catch (err) {
    console.error("GET /api/directions error:", err);
    return errorResponse("Directions lookup failed", 502);
  }
}
