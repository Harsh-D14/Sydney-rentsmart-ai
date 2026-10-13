import suburbData from "@/data/sydney_suburbs.json";
import stationData from "@/data/train_stations.json";
import { haversineKm } from "@/lib/geo";

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

/** The rent fields shared by a suburb row and a postcode area. */
export type RentField =
  | "median_rent_overall"
  | "median_rent_1bed"
  | "median_rent_2bed"
  | "median_rent_3bed"
  | "median_rent_4bed"
  | "median_rent_5+bed";

/**
 * One entry per postcode. Every rent, bond, income and stress figure in the
 * source data is measured per postcode and merely repeated on each suburb row
 * sharing it, so this is the level at which the figures are true.
 */
export interface PostcodeArea {
  postcode: string;
  /** Key of the representative suburb (usable with getSuburbByKey). */
  suburb_key: string;
  /** Representative suburb name; "Postcode NNNN" for the unnamed postcodes. */
  suburb_name: string;
  /** Real suburb names sharing the postcode, alphabetical. */
  suburb_names: string[];
  /** Centroid: mean of all rows with coordinates. Null for unnamed postcodes. */
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
  /** True when total_bonds < LOW_SAMPLE_BOND_THRESHOLD: medians are unreliable. */
  low_sample: boolean;
}

export interface ResolvedWorkplace {
  suburb_key: string;
  suburb_name: string;
  postcode: string;
  lat: number;
  lng: number;
}

// Rent stress bands live in stress.ts; re-exported for existing importers.
export { getRentStressRating, type RentStressRating } from "@/lib/stress";

// ---------------------------------------------------------------------------
// Non-suburb names
//
// The name list comes from a postcode dataset, so it mixes real suburbs with
// postal delivery points. A name is treated as NOT a suburb when it matches a
// pattern below or appears in the explicit list. Deliberately conservative:
// unofficial neighbourhood names ("Kings Cross", "Chatswood West", "Harbord")
// are kept, because people do search for them.
// ---------------------------------------------------------------------------

/** Postal facilities: delivery centres, business centres, mail processing. */
const NON_SUBURB_SUFFIX = /\s(dc|bc|milpo)$/;

/** Navy bases. */
const NON_SUBURB_PREFIX = /^hmas\s/;

const NON_SUBURB_NAMES: ReadonlySet<string> = new Set(
  [
    // Shopping centres
    "Bankstown Square",
    "Blacktown Westpoint",
    "Bondi Junction Plaza",
    "Carlingford Court",
    "Casula Mall",
    "Glenquarie",
    "Hurstville Westfield",
    "Liverpool Westfield",
    "Macarthur Square",
    "Macquarie Centre",
    "Marrickville Metro",
    "Menai Central",
    "Mount Druitt Village",
    "North Sydney Shoppingworld",
    "Parramatta Westfield",
    "Penrith Plaza",
    "Sylvania Southgate",
    "Warriewood Shopping Square",
    "Warringah Mall",
    "Westgate",
    // Institutions and airports
    "Bankstown Airport",
    "Parliament House",
    "Royal North Shore Hospital",
    "Sydney Domestic Airport",
    "Sydney International Airport",
    // Post offices named after a street, square or compass point
    "Blenheim Road",
    "Kingsway West",
    "Missenden Road",
    "Sydney South",
    "Taylor Square",
    // Second spelling of a suburb already listed in the same postcode
    "Brighton Le Sands", // Brighton-Le-Sands
    "Shane Park", // Shanes Park
  ].map((n) => n.toLowerCase()),
);

/** True when the name is a real suburb rather than a postal delivery point. */
export function isRealSuburbName(name: string | null): name is string {
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    !NON_SUBURB_SUFFIX.test(n) && !NON_SUBURB_PREFIX.test(n) && !NON_SUBURB_NAMES.has(n)
  );
}

// ---------------------------------------------------------------------------
// Representative suburb overrides
//
// The automatic choice (see pickRepresentative) names the postcode after its
// best-known suburb in most cases. These are the postcodes where it picked a
// minor locality over the obvious centre.
// ---------------------------------------------------------------------------

const REPRESENTATIVE_OVERRIDES: Readonly<Record<string, string>> = {
  "2007": "Ultimo",
  "2008": "Chippendale",
  "2011": "Potts Point",
  "2019": "Botany",
  "2021": "Paddington",
  "2027": "Edgecliff",
  "2030": "Vaucluse",
  "2032": "Kingsford",
  "2036": "Matraville",
  "2040": "Leichhardt",
  "2046": "Five Dock",
  "2082": "Berowra Heights",
  "2083": "Brooklyn",
  "2084": "Terrey Hills",
  "2087": "Forestville",
  "2096": "Freshwater",
  "2100": "Brookvale",
  "2105": "Church Point",
  "2107": "Avalon Beach",
  "2108": "Palm Beach",
  "2114": "West Ryde",
  "2119": "Beecroft",
  "2127": "Sydney Olympic Park",
  "2137": "Concord",
  "2153": "Baulkham Hills",
  "2157": "Glenorie",
  "2159": "Galston",
  "2162": "Chester Hill",
  "2163": "Villawood",
  "2168": "Miller",
  "2176": "Bossley Park",
  "2178": "Kemps Creek",
  "2219": "Sans Souci",
  "2221": "Blakehurst",
  "2232": "Sutherland",
  "2571": "Picton",
  "2745": "Glenmore Park",
  "2747": "Kingswood",
  "2754": "North Richmond",
  "2756": "Windsor",
  "2759": "St Clair",
  "2765": "Riverstone",
  "2768": "Glenwood",
};

// ---------------------------------------------------------------------------
// Data access (per suburb row)
// ---------------------------------------------------------------------------

const suburbs = suburbData as Record<string, Suburb>;

export const LOW_SAMPLE_BOND_THRESHOLD = 100;

function getAllSuburbs(): Suburb[] {
  return Object.values(suburbs);
}

export function getSuburbByKey(key: string): Suburb | undefined {
  return Object.hasOwn(suburbs, key) ? suburbs[key] : undefined;
}

/** The representative suburb row for a postcode. */
export function getSuburbByPostcode(postcode: string): Suburb | undefined {
  const area = getPostcodeArea(postcode);
  return area ? suburbs[area.suburb_key] : undefined;
}

// ---------------------------------------------------------------------------
// Postcode areas
// ---------------------------------------------------------------------------

/** Lower-case, treat hyphens as spaces, drop dots and apostrophes. */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[-\s]+/g, " ")
    .trim();
}

const stationNames: ReadonlySet<string> = new Set(
  (stationData as { name: string }[]).map((s) =>
    normaliseName(s.name.replace(/\s*\(.*\)$/, "")),
  ),
);

/**
 * Choose the suburb a postcode is named after. Candidates are the real suburb
 * names. In order:
 *  1. an explicit override, when listed;
 *  2. the name most often embedded in the postcode's other names ("Penrith"
 *     in "South Penrith", "Penrith Plaza"): delivery points and satellite
 *     localities are named after the main suburb;
 *  3. a name that is also a station name, a sign of an established centre;
 *  4. nearest to the postcode centroid;
 *  5. alphabetical.
 */
function pickRepresentative(
  postcode: string,
  candidates: Suburb[],
  rows: Suburb[],
  lat: number | null,
  lng: number | null,
): Suburb {
  const override = REPRESENTATIVE_OVERRIDES[postcode];
  if (override) {
    const hit = candidates.find((c) => c.suburb_name === override);
    if (hit) return hit;
  }

  const padded = rows
    .filter((r) => r.suburb_name)
    .map((r) => ({ key: r.suburb_key, name: ` ${normaliseName(r.suburb_name!)} ` }));

  const scored = candidates.map((c) => {
    const name = normaliseName(c.suburb_name ?? "");
    return {
      row: c,
      embedded: padded.filter((p) => p.key !== c.suburb_key && p.name.includes(` ${name} `))
        .length,
      station: stationNames.has(name) ? 1 : 0,
      dist:
        lat != null && lng != null && c.lat != null && c.lng != null
          ? haversineKm(lat, lng, c.lat, c.lng)
          : Infinity,
    };
  });

  scored.sort(
    (a, b) =>
      b.embedded - a.embedded ||
      b.station - a.station ||
      a.dist - b.dist ||
      (a.row.suburb_name ?? "").localeCompare(b.row.suburb_name ?? ""),
  );
  return scored[0].row;
}

function buildPostcodeArea(postcode: string, rows: Suburb[]): PostcodeArea {
  // Centroid = mean of ALL rows with coordinates (delivery points included).
  const located = rows.filter((r) => r.lat != null && r.lng != null);
  const lat = located.length
    ? located.reduce((sum, r) => sum + r.lat!, 0) / located.length
    : null;
  const lng = located.length
    ? located.reduce((sum, r) => sum + r.lng!, 0) / located.length
    : null;

  const named = rows.filter((r) => r.suburb_name);
  const real = named.filter((r) => isRealSuburbName(r.suburb_name));
  const candidates = real.length > 0 ? real : named;

  const rep =
    candidates.length > 0 ? pickRepresentative(postcode, candidates, rows, lat, lng) : rows[0];
  const data = rows[0]; // figures are identical on every row of a postcode

  return {
    postcode,
    suburb_key: rep.suburb_key,
    suburb_name: rep.suburb_name ?? `Postcode ${postcode}`,
    suburb_names: [...new Set(candidates.map((r) => r.suburb_name!))].sort((a, b) =>
      a.localeCompare(b),
    ),
    lat,
    lng,
    median_rent_overall: data.median_rent_overall,
    avg_rent: data.avg_rent,
    total_bonds: data.total_bonds,
    median_rent_1bed: data.median_rent_1bed,
    median_rent_2bed: data.median_rent_2bed,
    median_rent_3bed: data.median_rent_3bed,
    median_rent_4bed: data.median_rent_4bed,
    "median_rent_5+bed": data["median_rent_5+bed"],
    dwelling_types: data.dwelling_types,
    rent_trend: data.rent_trend,
    median_household_income_weekly: data.median_household_income_weekly,
    rent_stress_pct_1bed: data.rent_stress_pct_1bed,
    rent_stress_pct_2bed: data.rent_stress_pct_2bed,
    rent_stress_pct_3bed: data.rent_stress_pct_3bed,
    rent_stress_pct_4bed: data.rent_stress_pct_4bed,
    "rent_stress_pct_5+bed": data["rent_stress_pct_5+bed"],
    low_sample: data.total_bonds < LOW_SAMPLE_BOND_THRESHOLD,
  };
}

let areaCache: { list: PostcodeArea[]; byPostcode: Map<string, PostcodeArea> } | null = null;

function loadAreas() {
  if (areaCache) return areaCache;

  const grouped = new Map<string, Suburb[]>();
  for (const s of getAllSuburbs()) {
    const rows = grouped.get(s.postcode);
    if (rows) rows.push(s);
    else grouped.set(s.postcode, [s]);
  }

  const list = [...grouped.entries()]
    .map(([postcode, rows]) => buildPostcodeArea(postcode, rows))
    .sort((a, b) => a.postcode.localeCompare(b.postcode));

  areaCache = { list, byPostcode: new Map(list.map((a) => [a.postcode, a])) };
  return areaCache;
}

/** One entry per postcode, ordered by postcode. Computed once. */
export function getPostcodeAreas(): PostcodeArea[] {
  return loadAreas().list;
}

export function getPostcodeArea(postcode: string): PostcodeArea | undefined {
  return loadAreas().byPostcode.get(postcode);
}

/** Narrows an area to one that can be placed on a map. */
export function hasCentroid(
  area: PostcodeArea,
): area is PostcodeArea & { lat: number; lng: number } {
  return area.lat != null && area.lng != null;
}

// ---------------------------------------------------------------------------
// Search and workplace resolution
// ---------------------------------------------------------------------------

type MatchTier = 0 | 1 | 2; // exact, starts-with, contains

function matchTier(name: string, q: string): MatchTier | null {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  return null;
}

function byNameLength(a: Suburb, b: Suburb): number {
  const an = a.suburb_name ?? "";
  const bn = b.suburb_name ?? "";
  return an.length - bn.length || an.localeCompare(bn) || a.postcode.localeCompare(b.postcode);
}

/**
 * Autocomplete search over real suburb names. Priority: exact name, name
 * starts with the query, name contains it, then postcode starts with it.
 * Delivery-point names and unnamed rows are never returned.
 */
export function searchSuburbs(query: string): Suburb[] {
  const q = normaliseName(query);
  if (!q) return [];

  const tiers: Suburb[][] = [[], [], [], []];
  for (const s of getAllSuburbs()) {
    if (!isRealSuburbName(s.suburb_name)) continue;
    const tier = matchTier(normaliseName(s.suburb_name), q);
    if (tier != null) tiers[tier].push(s);
    else if (s.postcode.startsWith(q)) tiers[3].push(s);
  }

  return tiers.flatMap((t) => t.sort(byNameLength));
}

const CBD_ALIASES: ReadonlySet<string> = new Set([
  "sydney cbd",
  "cbd",
  "city",
  "the city",
  "sydney city",
]);
const CBD_SUBURB_KEY = "Sydney_2000";

function toWorkplace(s: Suburb | undefined): ResolvedWorkplace | null {
  if (!s || !s.suburb_name || s.lat == null || s.lng == null) return null;
  return {
    suburb_key: s.suburb_key,
    suburb_name: s.suburb_name,
    postcode: s.postcode,
    lat: s.lat,
    lng: s.lng,
  };
}

/**
 * Turn free text into a workplace location.
 *  - a trailing "(2150)" (or ", 2150") after a name is stripped and used only
 *    to break ties between same-named suburbs;
 *  - "cbd", "city", "sydney cbd" and similar mean Sydney 2000;
 *  - a bare postcode gives its representative suburb at the postcode centroid;
 *  - otherwise the best name match: exact > starts-with > contains, a real
 *    suburb ahead of a delivery point within each tier.
 * Returns null when nothing matches.
 */
export function resolveWorkplace(query: string): ResolvedWorkplace | null {
  let text = query.trim();
  if (!text) return null;

  // Bare postcode
  if (/^\d{4}$/.test(text)) {
    const area = getPostcodeArea(text);
    if (!area || !hasCentroid(area)) return null;
    return {
      suburb_key: area.suburb_key,
      suburb_name: area.suburb_name,
      postcode: area.postcode,
      lat: area.lat,
      lng: area.lng,
    };
  }

  // "Parramatta (2150)" / "Parramatta, 2150" / "Parramatta 2150"
  let hintPostcode: string | null = null;
  const suffix = text.match(/^(.*?)[\s,]*\(?(\d{4})\)?$/);
  if (suffix && suffix[1].trim()) {
    text = suffix[1].trim();
    hintPostcode = suffix[2];
  }

  const q = normaliseName(text);
  if (!q) return null;
  if (CBD_ALIASES.has(q)) return toWorkplace(getSuburbByKey(CBD_SUBURB_KEY));

  let best: { row: Suburb; rank: number[] } | null = null;
  for (const s of getAllSuburbs()) {
    if (!s.suburb_name) continue;
    const tier = matchTier(normaliseName(s.suburb_name), q);
    if (tier == null) continue;
    const rank = [
      tier,
      isRealSuburbName(s.suburb_name) ? 0 : 1,
      hintPostcode && s.postcode === hintPostcode ? 0 : 1,
      s.suburb_name.length,
    ];
    if (!best) {
      best = { row: s, rank };
      continue;
    }
    let cmp = 0;
    for (let i = 0; i < rank.length && cmp === 0; i++) cmp = rank[i] - best.rank[i];
    if (cmp === 0) cmp = byNameLength(s, best.row);
    if (cmp < 0) best = { row: s, rank };
  }

  return toWorkplace(best?.row);
}

// ---------------------------------------------------------------------------
// Affordability helpers
// ---------------------------------------------------------------------------

/**
 * Get the median rent field name for a given bedroom count.
 * Accepts 1-5; values >= 5 map to "5+bed".
 */
export function medianRentKey(bedrooms: number): RentField {
  const label = bedrooms >= 5 ? "5+" : String(bedrooms);
  return `median_rent_${label}bed` as RentField;
}

/**
 * Sydney-wide median of a rent field: the median across postcodes (each
 * postcode counted once), leaving out low-sample postcodes. Whole dollars.
 */
export function sydneyMedianRent(field: RentField = "median_rent_overall"): number {
  const values = getPostcodeAreas()
    .filter((a) => !a.low_sample)
    .map((a) => a[field])
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[mid]
    : Math.round((values[mid - 1] + values[mid]) / 2);
}
