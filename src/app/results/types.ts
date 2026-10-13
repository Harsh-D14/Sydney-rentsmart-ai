// ---------------------------------------------------------------------------
// Results page: the /api/recommend contract as the browser sees it, plus the
// pure scoring helpers shared by the page and the cards.
//
// Types are declared locally on purpose: importing them from "@/lib/suburbs"
// or "@/lib/amenities" would risk dragging server-side datasets into the
// client bundle.
// ---------------------------------------------------------------------------

import { estimateCommuteMinutes } from "@/lib/geo";

export type SearchMode = "income" | "budget";

export interface AmenitySummary {
  hospital_count: number;
  school_count: number;
  university_count: number;
  fire_station_count: number;
  police_count: number;
  childcare_count: number;
}

/** One postcode area, as returned by GET /api/recommend. */
export interface RecommendedArea {
  postcode: string;
  suburb_key: string;
  suburb_name: string;
  suburb_names: string[];
  lat: number;
  lng: number;
  median_rent: number;
  rent_stress_pct: number;
  rating: "comfortable" | "manageable" | "stressed" | "severe" | null;
  total_bonds: number;
  low_sample: boolean;
  rent_trend: Record<string, number>;
  dwelling_types: Record<string, number>;
  nearest_station: {
    name: string;
    distance_km: number;
    type: string;
    lines: string[];
  } | null;
  sharing_mode: number;
  total_rent: number;
  per_person_rent: number;
  solo_rent: number | null;
  savings_vs_solo: number | null;
  rent_estimated: boolean;
  is_workplace: boolean;
  distance_to_workplace_km: number | null;
  /** null = no amenity data for the postcode (not "zero amenities") */
  amenities: AmenitySummary | null;
  amenity_score: number | null;
}

export interface RecommendResponse {
  income_weekly: number;
  mode: SearchMode;
  bedrooms: number | "overall";
  sharing_mode: number;
  workplace: string | null;
  workplace_query: string | null;
  workplace_resolved: boolean;
  workplace_postcode: string | null;
  workplace_suburb_key: string | null;
  workplace_lat: number | null;
  workplace_lng: number | null;
  total_matching: number;
  suburbs: RecommendedArea[];
}

export interface AreaEnriched extends RecommendedArea {
  /**
   * The one commute number for this area (driving minutes): shown on the
   * card, used by the commute sort and by the overall score. null when there
   * is no workplace.
   */
  commute_min: number | null;
  /** true = derived from straight-line distance, false = routed */
  commute_is_estimate: boolean;
  /** a routed time has been requested and has not come back yet */
  commute_loading: boolean;
  overall_score: number;
}

export type SortMode = "best_overall" | "shortest_commute" | "best_affordability" | "lowest_rent";

export const SORT_MODES: readonly SortMode[] = [
  "best_overall",
  "shortest_commute",
  "best_affordability",
  "lowest_rent",
];

export interface FacilityFilters {
  hospital: boolean;
  school: boolean;
  university: boolean;
  train: boolean;
  fireStation: boolean;
  childcare: boolean;
}

export const DEFAULT_FILTERS: FacilityFilters = {
  hospital: false,
  school: false,
  university: false,
  train: false,
  fireStation: false,
  childcare: false,
};

/** Workplace as resolved by the server. */
export interface WorkplacePoint {
  name: string;
  lat: number;
  lng: number;
}

// ---------------------------------------------------------------------------
// Commute: one number per area
// ---------------------------------------------------------------------------

/**
 * Driving minutes for an area: the routed value when we have one, otherwise
 * an estimate from the straight-line distance the server already computed.
 * The workplace's own area is never routed (centroid to itself is meaningless).
 */
export function commuteFor(
  area: RecommendedArea,
  routedMinutes: number | undefined,
): { minutes: number | null; isEstimate: boolean } {
  if (area.distance_to_workplace_km === null) return { minutes: null, isEstimate: true };
  if (!area.is_workplace && routedMinutes !== undefined) {
    return { minutes: routedMinutes, isEstimate: false };
  }
  return { minutes: estimateCommuteMinutes(area.distance_to_workplace_km), isEstimate: true };
}

// ---------------------------------------------------------------------------
// Overall score
// ---------------------------------------------------------------------------

/**
 * Weighted 0-100 score. Components with no data (no workplace, so no commute;
 * no amenity data for the postcode) are dropped and the remaining weights are
 * renormalised, so "unknown" is never scored as zero.
 *
 *   with a workplace:    affordability 35, commute 35, amenities 15, supply 15
 *   without a workplace: affordability 45,             amenities 25, supply 30
 */
export function overallScore(
  area: RecommendedArea,
  mode: SearchMode,
  commuteMinutes: number | null,
): number {
  const hasCommute = commuteMinutes !== null;

  // income mode: 0% of income scores 100, 50% or more scores 0.
  // budget mode: every result is already at or under budget, so the scale
  // runs across the whole budget (0% scores 100, 100% of budget scores 0).
  const affordability =
    mode === "budget"
      ? Math.max(0, 100 - area.rent_stress_pct)
      : Math.max(0, 100 - area.rent_stress_pct * 2);
  const supply = Math.min(area.total_bonds / 10, 100);

  const parts: [score: number, weight: number][] = [
    [affordability, hasCommute ? 0.35 : 0.45],
    [supply, hasCommute ? 0.15 : 0.3],
  ];
  if (commuteMinutes !== null) {
    parts.push([Math.max(0, 100 - commuteMinutes * 1.5), 0.35]);
  }
  if (area.amenity_score !== null) {
    parts.push([area.amenity_score, hasCommute ? 0.15 : 0.25]);
  }

  let weighted = 0;
  let totalWeight = 0;
  for (const [score, weight] of parts) {
    weighted += score * weight;
    totalWeight += weight;
  }
  return Math.max(0, Math.min(100, Math.round(weighted / totalWeight)));
}

// ---------------------------------------------------------------------------
// Budget mode labels (income mode uses stressBand() from "@/lib/stress")
// ---------------------------------------------------------------------------

/** At or under this share of the budget counts as "well under". */
export const WELL_UNDER_BUDGET_PCT = 80;

export function budgetBand(pctOfBudget: number): { label: string; text: string; badge: string } {
  return pctOfBudget <= WELL_UNDER_BUDGET_PCT
    ? { label: "Well under budget", text: "text-emerald-700", badge: "bg-emerald-50 border-emerald-200" }
    : { label: "Within budget", text: "text-blue-700", badge: "bg-blue-50 border-blue-200" };
}
