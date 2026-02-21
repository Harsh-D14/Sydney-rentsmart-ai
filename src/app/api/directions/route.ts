import { NextRequest, NextResponse } from "next/server";
import { fetchOrsDirections } from "@/lib/ors-directions";

// ---------------------------------------------------------------------------
// In-memory cache (24-hour TTL)
// ---------------------------------------------------------------------------

interface CachedResult {
  data: unknown;
  timestamp: number;
}

const cache = new Map<string, CachedResult>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  mode: string,
): string {
  return `${fromLat.toFixed(3)}_${fromLng.toFixed(3)}_${toLat.toFixed(3)}_${toLng.toFixed(3)}_${mode}`;
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
// GET /api/directions
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const fromLat = parseFloat(params.get("from_lat") ?? "");
    const fromLng = parseFloat(params.get("from_lng") ?? "");
    const toLat = parseFloat(params.get("to_lat") ?? "");
    const toLng = parseFloat(params.get("to_lng") ?? "");
    const mode = (params.get("mode") ?? "driving") as "driving" | "cycling";

    if ([fromLat, fromLng, toLat, toLng].some(isNaN)) {
      return NextResponse.json(
        {
          error:
            "Missing or invalid params: from_lat, from_lng, to_lat, to_lng",
        },
        { status: 400 },
      );
    }

    if (mode !== "driving" && mode !== "cycling") {
      return NextResponse.json(
        { error: 'Invalid mode: must be "driving" or "cycling"' },
        { status: 400 },
      );
    }

    // Check cache
    const key = cacheKey(fromLat, fromLng, toLat, toLng, mode);
    const cached = getCached(key);
    if (cached) {
      return NextResponse.json(cached);
    }

    const result = await fetchOrsDirections(
      fromLat,
      fromLng,
      toLat,
      toLng,
      mode,
    );

    // Cache and return
    cache.set(key, { data: result, timestamp: Date.now() });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
