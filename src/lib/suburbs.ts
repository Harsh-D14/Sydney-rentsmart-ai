import suburbData from "@/data/sydney_suburbs.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Suburb {
  suburb_key: string;
  postcode: string;
  suburb_name: string | null;
  lat: number | null;
  lng: number | null;
  median_rent_overall: number | null;
  avg_rent: number | null;
  total_bonds: number;
  median_rent_1bed: number | null;
  median_rent_2bed: number | null;
  median_rent_3bed: number | null;
  median_rent_4bed: number | null;
  "median_rent_5+bed": number | null;
  dwelling_types: Record<string, number>;
  rent_trend: Record<string, number>;
  median_household_income_weekly: number | null;
  rent_stress_pct_1bed: number | null;
  rent_stress_pct_2bed: number | null;
  rent_stress_pct_3bed: number | null;
  rent_stress_pct_4bed: number | null;
  "rent_stress_pct_5+bed": number | null;
}

export type RentStressRating = "comfortable" | "manageable" | "stressed" | "severe";

export interface RentStressResult {
  percentage: number;
  rating: RentStressRating;
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

const suburbs = suburbData as Record<string, Suburb>;

export function getAllSuburbs(): Suburb[] {
  return Object.values(suburbs);
}

export function getSuburbByKey(key: string): Suburb | undefined {
  return suburbs[key];
}

export function getSuburbByPostcode(postcode: string): Suburb | undefined {
  // Try direct key lookup first (backward compat with old postcode-only keys)
  if (suburbs[postcode]) return suburbs[postcode];
  return Object.values(suburbs).find((s) => s.postcode === postcode);
}

export function getSuburbsByPostcode(postcode: string): Suburb[] {
  return Object.values(suburbs).filter((s) => s.postcode === postcode);
}

export function searchSuburbs(query: string): Suburb[] {
  const q = query.toLowerCase().trim();
  if (!q) return getAllSuburbs();

  // Collect matches with priority: exact name > starts-with name > contains name > postcode
  const exact: Suburb[] = [];
  const startsWith: Suburb[] = [];
  const contains: Suburb[] = [];
  const postcodeMatch: Suburb[] = [];

  for (const s of getAllSuburbs()) {
    const name = s.suburb_name?.toLowerCase() ?? "";
    if (name === q) {
      exact.push(s);
    } else if (name.startsWith(q)) {
      startsWith.push(s);
    } else if (name.includes(q)) {
      contains.push(s);
    } else if (s.postcode.startsWith(q)) {
      postcodeMatch.push(s);
    }
  }

  return [...exact, ...startsWith, ...contains, ...postcodeMatch];
}

// ---------------------------------------------------------------------------
// Affordability helpers
// ---------------------------------------------------------------------------

export function getRentStressRating(percentage: number): RentStressRating {
  if (percentage < 25) return "comfortable";
  if (percentage <= 30) return "manageable";
  if (percentage <= 40) return "stressed";
  return "severe";
}

export function calculateRentStress(
  weeklyIncome: number,
  weeklyRent: number,
): RentStressResult {
  if (weeklyIncome <= 0) {
    return { percentage: 100, rating: "severe" };
  }
  const percentage = Math.round((weeklyRent / weeklyIncome) * 1000) / 10; // 1 decimal
  return { percentage, rating: getRentStressRating(percentage) };
}

/**
 * Get the median rent field name for a given bedroom count.
 * Accepts 1-5; values >= 5 map to "5+bed".
 */
export function medianRentKey(
  bedrooms: number,
): keyof Suburb {
  const label = bedrooms >= 5 ? "5+" : String(bedrooms);
  return `median_rent_${label}bed` as keyof Suburb;
}

/** Compute the Sydney-wide median for a given rent field across all postcodes. */
export function sydneyMedianRent(field: keyof Suburb = "median_rent_overall"): number {
  const values = getAllSuburbs()
    .map((s) => s[field] as number | null)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}
