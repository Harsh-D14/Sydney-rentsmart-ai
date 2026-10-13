// ---------------------------------------------------------------------------
// GET /api/recommend — affordable areas, ONE RESULT PER POSTCODE
//
// Rent data is measured per postcode, so each result is a postcode area named
// after its representative suburb, with the other suburbs it covers listed in
// `suburb_names`. Postcodes with no coordinates (three unnamed ones with at
// most 5 bonds) are never returned, so lat/lng are always numbers.
//
// Query params
//   income         required  positive number, weekly $ (meaning set by `mode`)
//   mode           optional  "income" (default) | "budget"
//                              income: `income` is weekly income. Stress =
//                                per-person rent / income. Areas over 100%
//                                are left out.
//                              budget: `income` is the MAXIMUM WEEKLY RENT
//                                (per person when sharing). Only areas with
//                                per-person rent <= budget are returned.
//   bedrooms       optional  integer 1-5 (5 = 5+). Ignored when sharing > 1.
//   sharing        optional  integer 1-4, default 1. People splitting the rent.
//   share_bedroom  optional  "1": two people sharing one bedroom
//   workplace      optional  free text, max 100 chars: suburb name,
//                            "Name (2150)", postcode, or "CBD"
//
// 200 response
//   {
//     income_weekly: number,            // echo of `income` (the budget in budget mode)
//     mode: "income" | "budget",
//     bedrooms: number | "overall",
//     sharing_mode: number,             // 1-4
//     workplace: string | null,         // resolved suburb name
//     workplace_query: string | null,   // raw text as sent (trimmed)
//     workplace_resolved: boolean,      // false when text was sent but nothing matched
//     workplace_postcode: string | null,
//     workplace_suburb_key: string | null,
//     workplace_lat: number | null,
//     workplace_lng: number | null,
//     total_matching: number,           // === suburbs.length
//     suburbs: Array<{
//       postcode: string,
//       suburb_key: string,             // representative suburb, links to /suburb/[key]
//       suburb_name: string,            // representative suburb
//       suburb_names: string[],         // all real suburb names in the postcode, A-Z
//       lat: number, lng: number,       // postcode centroid
//       median_rent: number,            // per-person weekly rent (same as per_person_rent)
//       rent_stress_pct: number,        // 1 decimal. income mode: % of income.
//                                       //            budget mode: % of budget.
//       rating: "comfortable" | "manageable" | "stressed" | "severe" | null,
//                                       // null in budget mode
//       total_bonds: number,
//       low_sample: boolean,            // true when total_bonds < 100
//       rent_trend: Record<year, number>,
//       dwelling_types: Record<type, percent>,
//       nearest_station: { name, distance_km, type, lines: string[] } | null,
//                                       // measured from the centroid
//       sharing_mode: number,
//       total_rent: number,             // whole-dwelling weekly rent
//       per_person_rent: number,
//       solo_rent: number | null,       // 1-bed (else overall) rent; null when not sharing
//       savings_vs_solo: number | null, // solo_rent - per_person_rent; null when not sharing
//       rent_estimated: boolean,        // true when a smaller dwelling stood in
//       is_workplace: boolean,          // workplace is in this postcode
//       distance_to_workplace_km: number | null, // centroid to workplace, 1 decimal
//       amenities: AmenitySummary | null,        // null = no amenity data
//       amenity_score: number | null,            // 0-100; null = no amenity data
//     }>                                // sorted by rent_stress_pct ascending
//   }
//
// 400 { error: string } for invalid params. Successful responses depend only
// on the query string and static data, so they are cached at the CDN.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import {
  getPostcodeAreas,
  hasCentroid,
  medianRentKey,
  resolveWorkplace,
  type PostcodeArea,
  type RentField,
} from "@/lib/suburbs";
import { getRentStressRating, type RentStressRating } from "@/lib/stress";
import { getNearestStation } from "@/lib/commute";
import { haversineKm } from "@/lib/geo";
import { getAmenitySummary, getAmenityScore, type AmenitySummary } from "@/lib/amenities";

const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const MAX_WORKPLACE_LENGTH = 100;

type Mode = "income" | "budget";

interface RecommendedArea {
  postcode: string;
  suburb_key: string;
  suburb_name: string;
  suburb_names: string[];
  lat: number;
  lng: number;
  median_rent: number;
  rent_stress_pct: number;
  rating: RentStressRating | null;
  total_bonds: number;
  low_sample: boolean;
  rent_trend: Record<string, number>;
  dwelling_types: Record<string, number>;
  nearest_station: { name: string; distance_km: number; type: string; lines: string[] } | null;
  // Sharing fields
  sharing_mode: number;
  total_rent: number;
  per_person_rent: number;
  solo_rent: number | null;
  savings_vs_solo: number | null;
  rent_estimated: boolean;
  // Workplace fields
  is_workplace: boolean;
  distance_to_workplace_km: number | null;
  // Amenity fields (null = no amenity data for the postcode)
  amenities: AmenitySummary | null;
  amenity_score: number | null;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Resolve the rent field + per-person divisor for sharing mode.
 *
 * sharing=1 (solo): use user-selected bedroom count as-is
 * sharing=2: use 2-bed rent ÷ 2  (or 1-bed ÷ 2 if share_bedroom)
 * sharing=3: use 3-bed rent ÷ 3
 * sharing=4: use 4-bed rent ÷ 4
 *
 * Fallback: if the preferred bedroom data is null, try the next lower
 * bedroom count and flag rentEstimated=true.
 */
function resolveSharedRent(
  area: PostcodeArea,
  userBedrooms: number | null,
  sharingCount: number,
  shareBedroom: boolean,
): { totalRent: number; perPersonRent: number; rentEstimated: boolean } | null {
  if (sharingCount <= 1) {
    const key: RentField = userBedrooms ? medianRentKey(userBedrooms) : "median_rent_overall";
    const rent = area[key];
    if (rent == null) return null;
    return { totalRent: rent, perPersonRent: rent, rentEstimated: false };
  }

  // Shared mode: which bedroom count to look up
  const coupleInOneRoom = sharingCount === 2 && shareBedroom;
  const targetBeds = coupleInOneRoom ? 1 : Math.min(sharingCount, 4);

  // Minimum bedroom guardrails
  const minBeds = coupleInOneRoom ? 1 : sharingCount >= 4 ? 3 : sharingCount >= 3 ? 2 : 1;

  // Try target beds, then fall back downward
  for (let beds = targetBeds; beds >= minBeds; beds--) {
    const rent = area[medianRentKey(beds)];
    if (rent != null) {
      return {
        totalRent: rent,
        perPersonRent: Math.round((rent / sharingCount) * 10) / 10,
        rentEstimated: beds !== targetBeds,
      };
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    // --- Validation ---
    const incomeStr = params.get("income");
    if (!incomeStr) {
      return badRequest("Missing required param: income (weekly $)");
    }
    const income = Number(incomeStr);
    if (!Number.isFinite(income) || income <= 0) {
      return badRequest("income must be a positive number (weekly $)");
    }

    const modeStr = params.get("mode") ?? "income";
    if (modeStr !== "income" && modeStr !== "budget") {
      return badRequest('mode must be "income" or "budget"');
    }
    const mode: Mode = modeStr;

    const bedroomsStr = params.get("bedrooms");
    const bedrooms = bedroomsStr ? Number(bedroomsStr) : null;
    if (bedrooms !== null && (!Number.isInteger(bedrooms) || bedrooms < 1 || bedrooms > 5)) {
      return badRequest("bedrooms must be a whole number between 1 and 5");
    }

    const sharingStr = params.get("sharing");
    const sharingCount = sharingStr ? Number(sharingStr) : 1;
    if (!Number.isInteger(sharingCount) || sharingCount < 1 || sharingCount > 4) {
      return badRequest("sharing must be a whole number between 1 and 4");
    }
    const shareBedroom = params.get("share_bedroom") === "1";

    const workplaceQuery = params.get("workplace")?.trim() || null;
    if (workplaceQuery && workplaceQuery.length > MAX_WORKPLACE_LENGTH) {
      return badRequest(`workplace must be at most ${MAX_WORKPLACE_LENGTH} characters`);
    }
    const workplace = workplaceQuery ? resolveWorkplace(workplaceQuery) : null;

    // --- Build the list, one entry per postcode ---
    const results: RecommendedArea[] = [];

    for (const area of getPostcodeAreas()) {
      if (!hasCentroid(area)) continue;

      const resolved = resolveSharedRent(area, bedrooms, sharingCount, shareBedroom);
      if (!resolved) continue;
      const { totalRent, perPersonRent, rentEstimated } = resolved;

      // income mode: share of income. budget mode: share of the budget.
      if (mode === "budget" && perPersonRent > income) continue; // over budget
      const pct = Math.round((perPersonRent / income) * 1000) / 10;
      if (pct > 100) continue; // rent exceeds the whole income

      // Solo rent for savings comparison (1-bed as baseline)
      let soloRent: number | null = null;
      let savingsVsSolo: number | null = null;
      if (sharingCount > 1) {
        soloRent = area.median_rent_1bed ?? area.median_rent_overall;
        if (soloRent !== null) savingsVsSolo = Math.round(soloRent - perPersonRent);
      }

      const ns = getNearestStation(area.lat, area.lng);

      const amenities: AmenitySummary | null = getAmenitySummary(area.postcode);
      const amenityScore: number | null = getAmenityScore(area.postcode);

      results.push({
        postcode: area.postcode,
        suburb_key: area.suburb_key,
        suburb_name: area.suburb_name,
        suburb_names: area.suburb_names,
        lat: area.lat,
        lng: area.lng,
        median_rent: perPersonRent,
        rent_stress_pct: pct,
        rating: mode === "income" ? getRentStressRating(pct) : null,
        total_bonds: area.total_bonds,
        low_sample: area.low_sample,
        rent_trend: area.rent_trend,
        dwelling_types: area.dwelling_types,
        nearest_station: ns
          ? {
              name: ns.station.name,
              distance_km: ns.distanceKm,
              type: ns.station.type,
              lines: ns.station.lines,
            }
          : null,
        sharing_mode: sharingCount,
        total_rent: totalRent,
        per_person_rent: perPersonRent,
        solo_rent: soloRent,
        savings_vs_solo: savingsVsSolo,
        rent_estimated: rentEstimated,
        is_workplace: workplace?.postcode === area.postcode,
        distance_to_workplace_km: workplace
          ? Math.round(haversineKm(area.lat, area.lng, workplace.lat, workplace.lng) * 10) / 10
          : null,
        amenities,
        amenity_score: amenityScore,
      });
    }

    // Default ordering: lowest rent stress first, postcode as a stable tie-break
    results.sort(
      (a, b) => a.rent_stress_pct - b.rent_stress_pct || a.postcode.localeCompare(b.postcode),
    );

    return NextResponse.json(
      {
        income_weekly: income,
        mode,
        bedrooms: bedrooms ?? "overall",
        sharing_mode: sharingCount,
        workplace: workplace?.suburb_name ?? null,
        workplace_query: workplaceQuery,
        workplace_resolved: workplaceQuery ? workplace !== null : false,
        workplace_postcode: workplace?.postcode ?? null,
        workplace_suburb_key: workplace?.suburb_key ?? null,
        workplace_lat: workplace?.lat ?? null,
        workplace_lng: workplace?.lng ?? null,
        total_matching: results.length,
        suburbs: results,
      },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    console.error("GET /api/recommend error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
