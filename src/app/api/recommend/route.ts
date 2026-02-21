import { NextRequest, NextResponse } from "next/server";
import {
  getAllSuburbs,
  getSuburbByPostcode,
  calculateRentStress,
  medianRentKey,
  searchSuburbs,
  type Suburb,
} from "@/lib/suburbs";
import { getNearestStation, estimateCommuteTime } from "@/lib/commute";

const MAX_RESULTS = 500; // return enough for all client-side sort modes

/**
 * Resolve the rent field + per-person divisor for sharing mode.
 *
 * sharing=1 (solo): use user-selected bedroom count as-is
 * sharing=2: use 2-bed rent ÷ 2  (or 1-bed ÷ 2 if share_bedroom)
 * sharing=3: use 3-bed rent ÷ 3
 * sharing=4: use 4-bed rent ÷ 4
 *
 * Fallback: if the preferred bedroom data is null, try the next lower
 * bedroom count and flag rent_estimated=true.
 */
function resolveSharedRent(
  suburb: Suburb,
  userBedrooms: number | null,
  sharingCount: number,
  shareBedroom: boolean,
): { totalRent: number | null; perPersonRent: number; rentEstimated: boolean; bedsUsed: number } | null {
  if (sharingCount <= 1) {
    // Solo mode — original behaviour
    const key = userBedrooms ? medianRentKey(userBedrooms) : "median_rent_overall";
    const rent = suburb[key] as number | null;
    if (rent === null) return null;
    return { totalRent: rent, perPersonRent: rent, rentEstimated: false, bedsUsed: userBedrooms ?? 0 };
  }

  // Shared mode — determine which bedroom count to look up
  let targetBeds: number;
  if (sharingCount === 2 && shareBedroom) {
    targetBeds = 1; // couples sharing a bedroom
  } else {
    targetBeds = Math.min(sharingCount, 4);
  }

  // Minimum bedroom guardrails
  const minBeds = sharingCount === 2 && shareBedroom ? 1 : sharingCount >= 4 ? 3 : sharingCount >= 3 ? 2 : 1;

  // Try target beds, then fall back downward
  let rent: number | null = null;
  let bedsUsed = targetBeds;
  let estimated = false;

  for (let beds = targetBeds; beds >= minBeds; beds--) {
    const key = medianRentKey(beds);
    const val = suburb[key] as number | null;
    if (val !== null) {
      rent = val;
      bedsUsed = beds;
      estimated = beds !== targetBeds;
      break;
    }
  }

  if (rent === null) return null;

  const perPerson = Math.round((rent / sharingCount) * 10) / 10;
  return { totalRent: rent, perPersonRent: perPerson, rentEstimated: estimated, bedsUsed };
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const incomeStr = params.get("income");
    const bedroomsStr = params.get("bedrooms");

    // --- Validation ---
    if (!incomeStr) {
      return NextResponse.json(
        { error: "Missing required param: income (weekly $)" },
        { status: 400 },
      );
    }

    const income = Number(incomeStr);
    if (isNaN(income) || income <= 0) {
      return NextResponse.json(
        { error: "income must be a positive number (weekly $)" },
        { status: 400 },
      );
    }

    const bedrooms = bedroomsStr ? Number(bedroomsStr) : null;
    if (bedrooms !== null && (isNaN(bedrooms) || bedrooms < 1 || bedrooms > 5)) {
      return NextResponse.json(
        { error: "bedrooms must be between 1 and 5" },
        { status: 400 },
      );
    }

    // --- Sharing mode ---
    const sharingStr = params.get("sharing");
    const sharingCount = sharingStr ? Math.min(4, Math.max(1, Number(sharingStr) || 1)) : 1;
    const shareBedroom = params.get("share_bedroom") === "1";

    // Resolve workplace to a specific suburb (name-first, postcode-fallback)
    const workplaceStr = params.get("workplace");
    let workplacePostcode: string | null = null;
    let workplaceName: string | null = null;
    let workplaceLat: number | null = null;
    let workplaceLng: number | null = null;
    let workplaceSuburbKey: string | null = null;
    if (workplaceStr) {
      const trimmed = workplaceStr.trim();
      // Always try name search first — returns exact > startsWith > contains > postcode
      const matches = searchSuburbs(trimmed);
      if (matches.length > 0) {
        const match = matches[0];
        workplacePostcode = match.postcode;
        workplaceName = match.suburb_name;
        workplaceLat = match.lat;
        workplaceLng = match.lng;
        workplaceSuburbKey = match.suburb_key;
      } else if (/^\d{4}$/.test(trimmed)) {
        // Pure postcode with no search results — try direct postcode lookup
        const direct = getSuburbByPostcode(trimmed);
        if (direct) {
          workplacePostcode = direct.postcode;
          workplaceName = direct.suburb_name;
          workplaceLat = direct.lat;
          workplaceLng = direct.lng;
          workplaceSuburbKey = direct.suburb_key;
        }
      }
    }

    // --- Build scored list ---
    interface ScoredSuburb {
      suburb_key: string;
      postcode: string;
      suburb_name: string | null;
      lat: number | null;
      lng: number | null;
      median_rent: number;
      rent_stress_pct: number;
      affordability_score: number;
      rating: string;
      total_bonds: number;
      rent_trend: Record<string, number>;
      dwelling_types: Record<string, number>;
      nearest_station: { name: string; distance_km: number; type: string; lines: string[] } | null;
      commute_minutes: number | null;
      commute_label: string | null;
      // Sharing fields
      sharing_mode: number;
      total_rent: number;
      per_person_rent: number;
      solo_rent: number | null;
      savings_vs_solo: number | null;
      rent_estimated: boolean;
    }

    const scored: ScoredSuburb[] = [];

    for (const suburb of getAllSuburbs()) {
      const resolved = resolveSharedRent(suburb, bedrooms, sharingCount, shareBedroom);
      if (!resolved) continue;

      const { totalRent, perPersonRent, rentEstimated } = resolved;

      // Rent stress uses per-person rent
      const stress = calculateRentStress(income, perPersonRent);
      // Only filter if per-person rent exceeds income entirely
      if (stress.percentage > 100) continue;

      // Solo rent for savings comparison (1-bed as baseline)
      let soloRent: number | null = null;
      let savingsVsSolo: number | null = null;
      if (sharingCount > 1) {
        soloRent = (suburb.median_rent_1bed as number | null) ?? (suburb.median_rent_overall as number | null);
        if (soloRent !== null) {
          savingsVsSolo = Math.round(soloRent - perPersonRent);
        }
      }

      // Nearest station
      let nearestStation: ScoredSuburb["nearest_station"] = null;
      if (suburb.lat != null && suburb.lng != null) {
        const ns = getNearestStation(suburb.lat, suburb.lng);
        if (ns) {
          nearestStation = {
            name: ns.station.name,
            distance_km: ns.distanceKm,
            type: ns.station.type,
            lines: ns.station.lines,
          };
        }
      }

      // Commute estimate
      let commuteMinutes: number | null = null;
      let commuteLabel: string | null = null;
      if (workplacePostcode) {
        const est = estimateCommuteTime(suburb.postcode, workplacePostcode);
        if (est) {
          commuteMinutes = est.estimatedMinutes;
          commuteLabel = est.label;
        }
      }

      // Composite affordability score
      const supplyBonus = Math.min(5, suburb.total_bonds / 500);
      const trendYears = Object.keys(suburb.rent_trend).sort();
      let trendPenalty = 0;
      if (trendYears.length >= 2) {
        const oldest = suburb.rent_trend[trendYears[0]];
        const newest = suburb.rent_trend[trendYears[trendYears.length - 1]];
        if (oldest > 0) {
          const increase = (newest - oldest) / oldest;
          if (increase > 0.1) {
            trendPenalty = Math.min(5, increase * 10);
          }
        }
      }
      const affordabilityScore =
        Math.round((stress.percentage - supplyBonus + trendPenalty) * 10) / 10;

      scored.push({
        suburb_key: suburb.suburb_key,
        postcode: suburb.postcode,
        suburb_name: suburb.suburb_name,
        lat: suburb.lat,
        lng: suburb.lng,
        median_rent: perPersonRent,
        rent_stress_pct: stress.percentage,
        affordability_score: affordabilityScore,
        rating: stress.rating,
        total_bonds: suburb.total_bonds,
        rent_trend: suburb.rent_trend,
        dwelling_types: suburb.dwelling_types,
        nearest_station: nearestStation,
        commute_minutes: commuteMinutes,
        commute_label: commuteLabel,
        // Sharing fields
        sharing_mode: sharingCount,
        total_rent: totalRent!,
        per_person_rent: perPersonRent,
        solo_rent: soloRent,
        savings_vs_solo: savingsVsSolo,
        rent_estimated: rentEstimated,
      });
    }

    // Sort by rent stress (lowest first) as default API ordering
    scored.sort((a, b) => a.rent_stress_pct - b.rent_stress_pct);

    const top = scored.slice(0, MAX_RESULTS);

    return NextResponse.json({
      income_weekly: income,
      bedrooms: bedrooms ?? "overall",
      sharing_mode: sharingCount,
      workplace: workplaceName ?? workplaceStr ?? null,
      workplace_postcode: workplacePostcode,
      workplace_suburb_key: workplaceSuburbKey,
      workplace_lat: workplaceLat,
      workplace_lng: workplaceLng,
      total_matching: scored.length,
      showing: top.length,
      suburbs: top,
    });
  } catch (error) {
    console.error("GET /api/recommend error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
