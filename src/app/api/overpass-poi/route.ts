import { NextRequest, NextResponse } from "next/server";
import { fetchOverpassAmenities } from "@/lib/overpass";

// ---------------------------------------------------------------------------
// In-memory cache (24-hour TTL)
// ---------------------------------------------------------------------------

interface CachedResult {
  data: unknown;
  timestamp: number;
}

const cache = new Map<string, CachedResult>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
// POST /api/overpass-poi
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const lat = parseFloat(body.lat);
    const lng = parseFloat(body.lng);
    const radius = Math.min(body.radius ?? 3000, 5000);

    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json(
        { error: "Missing or invalid lat/lng" },
        { status: 400 },
      );
    }

    const key = `${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}`;
    const cached = getCached(key);
    if (cached) {
      return NextResponse.json(cached);
    }

    const amenities = await fetchOverpassAmenities(lat, lng, radius);

    cache.set(key, { data: amenities, timestamp: Date.now() });
    return NextResponse.json(amenities);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
