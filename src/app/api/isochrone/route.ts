import { NextRequest, NextResponse } from "next/server";
import { fetchOrsIsochrones } from "@/lib/ors-isochrones";

// ---------------------------------------------------------------------------
// In-memory cache (24-hour TTL)
// ---------------------------------------------------------------------------

interface CachedResult {
  data: unknown;
  timestamp: number;
}

const cache = new Map<string, CachedResult>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(lat: number, lng: number, ranges: string): string {
  return `${lat.toFixed(3)}_${lng.toFixed(3)}_${ranges}`;
}

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

// ---------------------------------------------------------------------------
// GET /api/isochrone
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const lat = parseFloat(params.get("lat") ?? "");
    const lng = parseFloat(params.get("lng") ?? "");
    const rangesParam = params.get("ranges") ?? "30,45";

    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json(
        { error: "Missing or invalid params: lat, lng" },
        { status: 400 },
      );
    }

    // Parse comma-separated minutes
    const rangesMinutes = rangesParam
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);

    if (rangesMinutes.length === 0) {
      return NextResponse.json(
        { error: "Invalid ranges: provide comma-separated positive integers" },
        { status: 400 },
      );
    }

    // Check cache
    const key = cacheKey(lat, lng, rangesMinutes.sort((a, b) => a - b).join(","));
    const cached = getCached(key);
    if (cached) {
      return NextResponse.json(cached);
    }

    const result = await fetchOrsIsochrones(lat, lng, rangesMinutes);

    // Cache and return
    cache.set(key, { data: result, timestamp: Date.now() });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
