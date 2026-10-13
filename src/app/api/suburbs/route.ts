// ---------------------------------------------------------------------------
// GET /api/suburbs
//
//   ?search=q   Autocomplete over real suburb names (delivery points such as
//               "Parramatta Westfield" are never returned). At most 10 items:
//                 { count, suburbs: [{ suburb_key, postcode, suburb_name }] }
//
//   (no search) Map points, ONE PER POSTCODE, placed at the postcode centroid:
//                 { count, suburbs: [{ suburb_key, postcode, suburb_name,
//                   suburb_names, lat, lng, median_rent_overall,
//                   median_rent_1bed, median_rent_2bed, median_rent_3bed,
//                   median_household_income_weekly, total_bonds,
//                   dwelling_types, low_sample }] }
//               Postcodes without coordinates are left out.
//
// Reading the query string makes this handler dynamic, so it cannot be
// `force-static` without losing `search`. Both variants are pure functions of
// the URL and the bundled data, so they are cached at the CDN instead: each
// distinct URL is computed once per day per region.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { getPostcodeAreas, hasCentroid, searchSuburbs } from "@/lib/suburbs";

const CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";
const MAX_SEARCH_RESULTS = 10;
const MAX_SEARCH_LENGTH = 60;

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get("search")?.trim();

    if (search) {
      if (search.length > MAX_SEARCH_LENGTH) {
        return NextResponse.json(
          { error: `search must be at most ${MAX_SEARCH_LENGTH} characters` },
          { status: 400 },
        );
      }

      const matches = searchSuburbs(search)
        .slice(0, MAX_SEARCH_RESULTS)
        .map((s) => ({
          suburb_key: s.suburb_key,
          postcode: s.postcode,
          suburb_name: s.suburb_name,
        }));

      return NextResponse.json(
        { count: matches.length, suburbs: matches },
        { headers: { "Cache-Control": CACHE_CONTROL } },
      );
    }

    const points = getPostcodeAreas()
      .filter(hasCentroid)
      .map((a) => ({
        suburb_key: a.suburb_key,
        postcode: a.postcode,
        suburb_name: a.suburb_name,
        suburb_names: a.suburb_names,
        lat: a.lat,
        lng: a.lng,
        median_rent_overall: a.median_rent_overall,
        median_rent_1bed: a.median_rent_1bed,
        median_rent_2bed: a.median_rent_2bed,
        median_rent_3bed: a.median_rent_3bed,
        median_household_income_weekly: a.median_household_income_weekly,
        total_bonds: a.total_bonds,
        dwelling_types: a.dwelling_types,
        low_sample: a.low_sample,
      }));

    return NextResponse.json(
      { count: points.length, suburbs: points },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    console.error("GET /api/suburbs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
