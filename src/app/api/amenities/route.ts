import { NextRequest, NextResponse } from "next/server";
import { getAmenities, getAmenitySummary, getAmenityScore } from "@/lib/amenities";

// The amenity dataset is a static file, so responses can be cached hard.
const CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";

/**
 * GET /api/amenities?postcode=2000
 *
 * `has_data: false` (with null amenities/summary/score) means the dataset has
 * no entry for the postcode, which is not the same as "no amenities nearby".
 */
export async function GET(request: NextRequest) {
  const postcode = request.nextUrl.searchParams.get("postcode");

  if (!postcode || !/^\d{4}$/.test(postcode)) {
    return NextResponse.json(
      { error: "postcode must be a 4-digit string" },
      { status: 400 },
    );
  }

  const amenities = getAmenities(postcode);

  return NextResponse.json(
    {
      postcode,
      has_data: amenities !== null,
      amenities,
      summary: getAmenitySummary(postcode),
      score: getAmenityScore(postcode),
    },
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
