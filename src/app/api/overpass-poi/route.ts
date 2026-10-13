import { NextRequest, NextResponse } from "next/server";
import { isInGreaterSydney } from "@/lib/geo";
import { fetchOverpassAmenities } from "@/lib/overpass";
import { rateLimit } from "@/lib/rate-limit";

// Upstream is capped at 20 s (see API_CONFIG.overpass.timeout).
export const maxDuration = 25;

const CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";
const DEFAULT_RADIUS_M = 3000;
const MIN_RADIUS_M = 500;
const MAX_RADIUS_M = 5000;

function badRequest(error: string) {
  return NextResponse.json(
    { error },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

/** Strict numeric parse: rejects null, "", whitespace and trailing junk. */
function parseNumber(value: string | null): number {
  if (value === null || value.trim() === "") return NaN;
  return Number(value);
}

/**
 * GET /api/overpass-poi?lat=&lng=&radius=
 *
 * Live nearby-places lookup (OpenStreetMap via Overpass) for a point in
 * Greater Sydney. GET with rounded coordinates so the CDN can cache it.
 */
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "overpass", 20);
  if (limited) return limited;

  const params = request.nextUrl.searchParams;

  // ~100 m precision: enough for a suburb, and it keeps cache keys shared.
  const lat = Math.round(parseNumber(params.get("lat")) * 1000) / 1000;
  const lng = Math.round(parseNumber(params.get("lng")) * 1000) / 1000;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return badRequest("Missing or invalid lat/lng");
  }
  if (!isInGreaterSydney(lat, lng)) {
    return badRequest("Location is outside Greater Sydney");
  }

  let radius = DEFAULT_RADIUS_M;
  if (params.has("radius")) {
    const requested = parseNumber(params.get("radius"));
    if (!Number.isFinite(requested)) {
      return badRequest("radius must be a number of metres");
    }
    radius = Math.round(Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, requested)));
  }

  try {
    const amenities = await fetchOverpassAmenities(lat, lng, radius);
    return NextResponse.json(amenities, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (err) {
    console.error("[overpass-poi] upstream lookup failed:", err);
    return NextResponse.json(
      { error: "Nearby places are temporarily unavailable. Please try again later." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
