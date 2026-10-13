import {
  getPostcodeArea,
  getPostcodeAreas,
  resolveWorkplace,
  sydneyMedianRent,
  LOW_SAMPLE_BOND_THRESHOLD,
  type PostcodeArea,
  type RentField,
} from "./suburbs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedBy<T>(arr: T[], fn: (item: T) => number, desc = false): T[] {
  return [...arr].sort((a, b) => (desc ? fn(b) - fn(a) : fn(a) - fn(b)));
}

const num = (n: number) => n.toLocaleString("en-AU");

/**
 * "Parramatta (2150)" plus up to two other suburb names in the postcode, so
 * the model knows which suburbs a postcode-level figure covers.
 */
function label(a: PostcodeArea): string {
  const others = a.suburb_names.filter((n) => n !== a.suburb_name);
  if (others.length === 0) return `${a.suburb_name} (${a.postcode})`;
  const shown = others.slice(0, 2).join(", ");
  const more = others.length > 2 ? ` +${others.length - 2} more` : "";
  return `${a.suburb_name} (${a.postcode}) [also ${shown}${more}]`;
}

function rentGrowth(a: PostcodeArea): { abs: number; pct: number } | null {
  const t = a.rent_trend;
  const r22 = t["2022"];
  const r25 = t["2025"];
  if (!r22 || !r25 || r22 < 100) return null;
  return { abs: r25 - r22, pct: Math.round(((r25 - r22) / r22) * 100) };
}

function rentChange2425(a: PostcodeArea): number | null {
  const t = a.rent_trend;
  const r24 = t["2024"];
  const r25 = t["2025"];
  if (r24 == null || r25 == null) return null;
  return r25 - r24;
}

// ---------------------------------------------------------------------------
// Dataset totals (computed, never hard-coded)
// ---------------------------------------------------------------------------

export interface DatasetTotals {
  /** Number of postcodes with rent data. */
  postcodeCount: number;
  /** Postcodes with enough bonds to quote a reliable median. */
  reliablePostcodeCount: number;
  totalBonds: number;
  firstYear: number;
  lastYear: number;
}

function buildDatasetTotals(): DatasetTotals {
  const areas = getPostcodeAreas();
  const years = areas.flatMap((a) => Object.keys(a.rent_trend).map(Number));
  return {
    postcodeCount: areas.length,
    reliablePostcodeCount: areas.filter((a) => !a.low_sample).length,
    totalBonds: areas.reduce((sum, a) => sum + a.total_bonds, 0),
    firstYear: Math.min(...years),
    lastYear: Math.max(...years),
  };
}

export const DATASET_TOTALS = buildDatasetTotals();

// ---------------------------------------------------------------------------
// Build the data summary
// ---------------------------------------------------------------------------

function buildDataSummary(): string {
  const totals = DATASET_TOTALS;
  const all = getPostcodeAreas();
  // Postcodes with too few bonds are never ranked: their medians are noise.
  const reliable = all.filter((a) => !a.low_sample);
  const withRent = reliable.filter((a) => a.median_rent_overall != null);

  const lines: string[] = [];

  lines.push(
    `SYDNEY RENTAL MARKET DATA (from NSW Government bond lodgement data ${totals.firstYear}-${totals.lastYear})`,
  );
  lines.push(
    `Total: ${totals.postcodeCount} postcodes, ${num(totals.totalBonds)} rental bonds analysed.`,
  );
  lines.push(
    `All figures are per POSTCODE. Each line names the postcode's main suburb; every suburb sharing that postcode has the same figures.`,
  );
  lines.push(
    `Postcodes with fewer than ${LOW_SAMPLE_BOND_THRESHOLD} bonds (${totals.postcodeCount - totals.reliablePostcodeCount} of them) are left out of the rankings below because their medians are unreliable.\n`,
  );

  lines.push("SYDNEY-WIDE MEDIAN RENTS (median across postcodes):");
  lines.push(
    `  Overall: $${sydneyMedianRent("median_rent_overall")}/wk | 1-bed: $${sydneyMedianRent("median_rent_1bed")}/wk | 2-bed: $${sydneyMedianRent("median_rent_2bed")}/wk | 3-bed: $${sydneyMedianRent("median_rent_3bed")}/wk\n`,
  );

  // --- Cheapest per bedroom ---
  for (const [bed, key] of [
    ["1-bed", "median_rent_1bed"],
    ["2-bed", "median_rent_2bed"],
    ["3-bed", "median_rent_3bed"],
  ] as const) {
    const ranked = sortedBy(
      reliable.filter((a) => a[key] != null),
      (a) => a[key]!,
    );
    lines.push(`CHEAPEST 10 POSTCODES (${bed}):`);
    for (const a of ranked.slice(0, 10)) {
      lines.push(`  ${label(a)}: $${a[key]}/wk, bonds=${num(a.total_bonds)}`);
    }
    lines.push("");
  }

  // --- Most expensive ---
  lines.push("MOST EXPENSIVE 10 POSTCODES (overall):");
  for (const a of sortedBy(withRent, (a) => a.median_rent_overall!, true).slice(0, 10)) {
    lines.push(`  ${label(a)}: $${a.median_rent_overall}/wk`);
  }
  lines.push("");

  // --- Highest supply ---
  lines.push("HIGHEST RENTAL SUPPLY (most bonds = most available rentals):");
  for (const a of sortedBy(withRent, (a) => a.total_bonds, true).slice(0, 15)) {
    lines.push(`  ${label(a)}: ${num(a.total_bonds)} bonds, $${a.median_rent_overall}/wk`);
  }
  lines.push("");

  // --- Biggest rent growth ---
  const growthList = reliable
    .map((a) => ({ a, g: rentGrowth(a) }))
    .filter((x): x is { a: PostcodeArea; g: { abs: number; pct: number } } => x.g != null)
    .sort((x, y) => y.g.pct - x.g.pct);

  lines.push("FASTEST RENT GROWTH (2022→2025):");
  for (const { a, g } of growthList.slice(0, 15)) {
    lines.push(
      `  ${label(a)}: +${g.pct}% (+$${g.abs}/wk) [$${a.rent_trend["2022"]}→$${a.rent_trend["2025"]}]`,
    );
  }
  lines.push("");

  // --- Rents dropping ---
  const dropList = reliable
    .map((a) => ({ a, ch: rentChange2425(a) }))
    .filter((x): x is { a: PostcodeArea; ch: number } => x.ch != null && x.ch < 0)
    .sort((x, y) => x.ch - y.ch);

  lines.push("RENTS DROPPING (2024→2025):");
  for (const { a, ch } of dropList.slice(0, 15)) {
    lines.push(
      `  ${label(a)}: -$${Math.abs(ch)}/wk [$${a.rent_trend["2024"]}→$${a.rent_trend["2025"]}]`,
    );
  }
  if (dropList.length === 0) lines.push("  None.");
  lines.push("");

  // --- Stable rents in big postcodes ---
  const stableList = reliable
    .filter((a) => {
      const ch = rentChange2425(a);
      return ch != null && Math.abs(ch) <= 20 && a.total_bonds > 500;
    })
    .sort((x, y) => y.total_bonds - x.total_bonds);

  lines.push("STABLE RENTS (2024→2025, postcodes with 500+ bonds):");
  for (const a of stableList.slice(0, 15)) {
    const ch = rentChange2425(a)!;
    const sign = ch >= 0 ? "+" : "-";
    lines.push(
      `  ${label(a)}: ${sign}$${Math.abs(ch)}/wk, $${a.median_rent_overall}/wk, ${num(a.total_bonds)} bonds`,
    );
  }
  lines.push("");

  // --- Well-known postcodes with full detail ---
  const popular = [
    "2000", "2010", "2017", "2026", "2035", "2042", "2050", "2060", "2065",
    "2077", "2112", "2113", "2127", "2135", "2140", "2141", "2145", "2148",
    "2150", "2160", "2170", "2192", "2200", "2205", "2220", "2560", "2565",
    "2750", "2770",
  ];

  lines.push("KEY SUBURB PROFILES (well-known postcodes with full rent breakdown):");
  for (const pc of popular) {
    const a = getPostcodeArea(pc);
    if (!a) continue;
    const trend = Object.entries(a.rent_trend)
      .map(([y, v]) => `${y}:$${v}`)
      .join(" ");
    lines.push(
      `  ${label(a)}: overall=$${a.median_rent_overall ?? "?"}/wk | 1bed=$${a.median_rent_1bed ?? "?"} | 2bed=$${a.median_rent_2bed ?? "?"} | 3bed=$${a.median_rent_3bed ?? "?"} | bonds=${num(a.total_bonds)} | income=$${a.median_household_income_weekly ?? "?"}/wk | trend: ${trend}`,
    );
  }

  return lines.join("\n");
}

// Export as a cached constant so it's computed once
export const DATA_SUMMARY = buildDataSummary();

// ---------------------------------------------------------------------------
// Build personalised context when user has search params
// ---------------------------------------------------------------------------

export interface UserContextOptions {
  /**
   * Weekly dollars. In "income" mode this is the person's weekly income; in
   * "budget" mode it is the most they want to pay in rent per week (per
   * person when sharing).
   */
  weeklyIncome?: number;
  mode?: "income" | "budget";
  bedrooms?: number;
  /** Free text: suburb name, "Name (postcode)", postcode or "CBD". */
  workplace?: string;
  sharing?: number;
  shareBedroom?: boolean;
}

export function buildUserContext(opts: UserContextOptions): string {
  const { weeklyIncome, mode = "income", bedrooms, workplace, sharing = 1, shareBedroom = false } = opts;
  if (!weeklyIncome || weeklyIncome <= 0) return "";

  const isBudget = mode === "budget";
  const isSharing = sharing > 1;
  const amount = Math.round(weeklyIncome);

  // Determine which bedroom rent to look up
  let lookupBeds = bedrooms ?? 0;
  if (isSharing) {
    if (sharing === 2 && shareBedroom) lookupBeds = 1;
    else lookupBeds = Math.min(sharing, 4);
  }

  const rentKey: RentField =
    lookupBeds >= 1 && lookupBeds <= 4
      ? (`median_rent_${lookupBeds}bed` as RentField)
      : "median_rent_overall";

  // The most this person pays per week: stated outright, or 30% of income.
  const maxPerPerson = isBudget ? amount : Math.round(amount * 0.3);
  const maxTotalRent = isSharing ? maxPerPerson * sharing : maxPerPerson;
  const limitLabel = isBudget ? "their stated budget" : "the 30% rule";

  // Affordable postcodes, best-supplied first
  const affordable = getPostcodeAreas()
    .filter((a) => {
      const rent = a[rentKey];
      return !a.low_sample && rent != null && rent <= maxTotalRent;
    })
    .sort((a, b) => b.total_bonds - a.total_bonds);

  const bedLabel = lookupBeds ? `${lookupBeds}-bedroom` : "";
  const heading = bedLabel ? `${bedLabel.toUpperCase()} ` : "";
  const lines: string[] = [];

  lines.push(`USER'S SITUATION:`);
  if (isBudget) {
    lines.push(
      `  Maximum rent they want to pay: $${num(amount)}/wk${isSharing ? " per person" : ""}. Their income is NOT known: do not quote rent as a share of income.`,
    );
  } else {
    lines.push(`  Weekly income: $${num(amount)}/wk (about $${num(amount * 52)}/yr)`);
  }
  if (isSharing) {
    lines.push(`  Living arrangement: SHARING with ${sharing} people total (splitting rent ${sharing} ways)`);
    if (sharing === 2 && shareBedroom) lines.push(`  Sharing a bedroom (couple/close friends), so looking at 1-bed rent ÷ 2`);
    if (!isBudget) lines.push(`  Max per-person rent (30% rule): $${num(maxPerPerson)}/wk`);
    lines.push(`  Max total rent for the group: $${num(maxTotalRent)}/wk`);
  } else if (!isBudget) {
    lines.push(`  Max affordable rent (30% rule): $${num(maxPerPerson)}/wk`);
  }
  if (bedLabel) lines.push(`  Looking for: ${bedLabel}`);
  if (workplace) {
    // Only the resolved name from our own data is ever written into the prompt.
    const wp = resolveWorkplace(workplace);
    if (wp) lines.push(`  Works near: ${wp.suburb_name} (${wp.postcode})`);
  }
  lines.push("");

  const share = (perPerson: number) =>
    isBudget
      ? `${Math.round((perPerson / amount) * 100)}% of budget`
      : `${Math.round((perPerson / amount) * 100)}% of income`;

  if (isSharing) {
    lines.push(
      `AFFORDABLE ${heading}POSTCODES FOR SHARING ÷${sharing} (total rent ≤ $${num(maxTotalRent)}/wk under ${limitLabel}, sorted by rental supply):`,
    );
    for (const a of affordable.slice(0, 20)) {
      const totalRent = a[rentKey]!;
      const perPerson = Math.round(totalRent / sharing);
      lines.push(
        `  ${label(a)}: $${totalRent}/wk total → $${perPerson}/pp (${share(perPerson)}), ${num(a.total_bonds)} bonds`,
      );
    }
  } else {
    lines.push(
      `AFFORDABLE ${heading}POSTCODES FOR THIS USER (rent ≤ $${num(maxPerPerson)}/wk under ${limitLabel}, sorted by rental supply):`,
    );
    for (const a of affordable.slice(0, 20)) {
      const rent = a[rentKey]!;
      lines.push(`  ${label(a)}: $${rent}/wk (${share(rent)}), ${num(a.total_bonds)} bonds`);
    }
  }

  if (affordable.length === 0) {
    lines.push(
      isBudget
        ? "  No postcodes found within that budget. The user may need a higher budget, fewer bedrooms or to share."
        : "  No postcodes found within the 30% rule. The user may need to consider higher rent stress or fewer bedrooms.",
    );
  }

  return lines.join("\n");
}
