import { getAllSuburbs, type Suburb } from "./suburbs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedBy<T>(arr: T[], fn: (item: T) => number, desc = false): T[] {
  return [...arr].sort((a, b) => (desc ? fn(b) - fn(a) : fn(a) - fn(b)));
}

function fmt(s: Suburb, field: keyof Suburb): string {
  const val = s[field];
  return `${s.suburb_name} (${s.postcode}): $${val}/wk`;
}

function rentGrowth(s: Suburb): { abs: number; pct: number } | null {
  const t = s.rent_trend;
  const r22 = t["2022"];
  const r25 = t["2025"];
  if (!r22 || !r25 || r22 < 100) return null;
  return { abs: r25 - r22, pct: Math.round(((r25 - r22) / r22) * 100) };
}

function rentChange2425(s: Suburb): number | null {
  const t = s.rent_trend;
  const r24 = t["2024"];
  const r25 = t["2025"];
  if (r24 == null || r25 == null) return null;
  return r25 - r24;
}

// ---------------------------------------------------------------------------
// Build the data summary
// ---------------------------------------------------------------------------

function buildDataSummary(): string {
  const all = getAllSuburbs();
  const withRent = all.filter((s) => s.median_rent_overall != null);

  // Sydney medians by bedroom
  const medianOf = (field: keyof Suburb) => {
    const vals = all
      .map((s) => s[field] as number | null)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)] ?? 0;
  };

  const sydneyMedian1 = medianOf("median_rent_1bed");
  const sydneyMedian2 = medianOf("median_rent_2bed");
  const sydneyMedian3 = medianOf("median_rent_3bed");
  const sydneyMedianAll = medianOf("median_rent_overall");

  const lines: string[] = [];

  lines.push("SYDNEY RENTAL MARKET DATA (from NSW Government bond lodgement data 2021-2025)");
  lines.push(`Total: ${all.length} postcodes, 1,203,016 rental bonds analysed.\n`);

  lines.push("SYDNEY-WIDE MEDIAN RENTS:");
  lines.push(`  Overall: $${sydneyMedianAll}/wk | 1-bed: $${sydneyMedian1}/wk | 2-bed: $${sydneyMedian2}/wk | 3-bed: $${sydneyMedian3}/wk\n`);

  // --- Cheapest per bedroom ---
  for (const [bed, key] of [
    ["1-bed", "median_rent_1bed"],
    ["2-bed", "median_rent_2bed"],
    ["3-bed", "median_rent_3bed"],
  ] as const) {
    const ranked = sortedBy(
      all.filter((s) => (s[key] as number | null) != null),
      (s) => s[key] as number,
    );
    lines.push(`CHEAPEST 10 SUBURBS (${bed}):`);
    for (const s of ranked.slice(0, 10)) {
      lines.push(`  ${fmt(s, key)}, bonds=${s.total_bonds}`);
    }
    lines.push("");
  }

  // --- Most expensive ---
  lines.push("MOST EXPENSIVE 10 SUBURBS (overall):");
  for (const s of sortedBy(withRent, (s) => s.median_rent_overall!, true).slice(0, 10)) {
    lines.push(`  ${fmt(s, "median_rent_overall")}`);
  }
  lines.push("");

  // --- Highest supply ---
  lines.push("HIGHEST RENTAL SUPPLY (most bonds = most available rentals):");
  for (const s of sortedBy(all, (s) => s.total_bonds, true).slice(0, 15)) {
    lines.push(
      `  ${s.suburb_name} (${s.postcode}): ${s.total_bonds.toLocaleString("en-AU")} bonds, $${s.median_rent_overall}/wk`,
    );
  }
  lines.push("");

  // --- Biggest rent growth ---
  const growthList = all
    .map((s) => ({ s, g: rentGrowth(s) }))
    .filter((x): x is { s: Suburb; g: { abs: number; pct: number } } => x.g != null)
    .sort((a, b) => b.g.pct - a.g.pct);

  lines.push("FASTEST RENT GROWTH (2022→2025):");
  for (const { s, g } of growthList.slice(0, 15)) {
    lines.push(
      `  ${s.suburb_name} (${s.postcode}): +${g.pct}% (+$${g.abs}/wk) [$${s.rent_trend["2022"]}→$${s.rent_trend["2025"]}]`,
    );
  }
  lines.push("");

  // --- Rents dropping ---
  const dropList = all
    .map((s) => ({ s, ch: rentChange2425(s) }))
    .filter((x): x is { s: Suburb; ch: number } => x.ch != null && x.ch < 0)
    .sort((a, b) => a.ch - b.ch);

  lines.push("RENTS DROPPING (2024→2025):");
  for (const { s, ch } of dropList.slice(0, 15)) {
    lines.push(
      `  ${s.suburb_name} (${s.postcode}): $${ch}/wk [$${s.rent_trend["2024"]}→$${s.rent_trend["2025"]}]`,
    );
  }
  lines.push("");

  // --- Stable rents in big suburbs ---
  const stableList = all
    .filter((s) => {
      const ch = rentChange2425(s);
      return ch != null && Math.abs(ch) <= 20 && s.total_bonds > 500;
    })
    .sort((a, b) => b.total_bonds - a.total_bonds);

  lines.push("STABLE RENTS (2024→2025, major suburbs with 500+ bonds):");
  for (const s of stableList.slice(0, 15)) {
    const ch = rentChange2425(s)!;
    const sign = ch >= 0 ? "+" : "";
    lines.push(
      `  ${s.suburb_name} (${s.postcode}): ${sign}$${ch}/wk, $${s.median_rent_overall}/wk, ${s.total_bonds.toLocaleString("en-AU")} bonds`,
    );
  }
  lines.push("");

  // --- Popular middle suburbs with full detail ---
  const popular = [
    "2000", "2010", "2017", "2026", "2035", "2042", "2050", "2060", "2065",
    "2077", "2112", "2113", "2127", "2135", "2140", "2141", "2145", "2148",
    "2150", "2160", "2170", "2192", "2200", "2205", "2220", "2560", "2565",
    "2750", "2770",
  ];

  lines.push("KEY SUBURB PROFILES (major suburbs with full rent breakdown):");
  for (const pc of popular) {
    const s = all.find((x) => x.postcode === pc);
    if (!s) continue;
    const trend = Object.entries(s.rent_trend)
      .map(([y, v]) => `${y}:$${v}`)
      .join(" ");
    lines.push(
      `  ${s.suburb_name} (${pc}): overall=$${s.median_rent_overall}/wk | 1bed=$${s.median_rent_1bed ?? "?"} | 2bed=$${s.median_rent_2bed ?? "?"} | 3bed=$${s.median_rent_3bed ?? "?"} | bonds=${s.total_bonds.toLocaleString("en-AU")} | income=$${s.median_household_income_weekly ?? "?"}/wk | trend: ${trend}`,
    );
  }

  return lines.join("\n");
}

// Export as a cached constant so it's computed once
export const DATA_SUMMARY = buildDataSummary();

// ---------------------------------------------------------------------------
// Build personalised context when user has search params
// ---------------------------------------------------------------------------

export function buildUserContext(opts: {
  income?: number;
  bedrooms?: number;
  workplace?: string;
  sharing?: number;
  shareBedroom?: boolean;
}): string {
  const { income, bedrooms, workplace, sharing = 1, shareBedroom = false } = opts;
  if (!income) return "";

  const weeklyIncome = Math.round(income / 52);
  const isSharing = sharing > 1;

  // Determine which bedroom rent to look up
  let lookupBeds = bedrooms ?? 0;
  if (isSharing) {
    if (sharing === 2 && shareBedroom) lookupBeds = 1;
    else lookupBeds = Math.min(sharing, 4);
  }

  const rentKey =
    lookupBeds >= 1 && lookupBeds <= 4
      ? (`median_rent_${lookupBeds}bed` as keyof Suburb)
      : "median_rent_overall";

  const maxPerPerson = Math.round(weeklyIncome * 0.3);
  const maxTotalRent = isSharing ? maxPerPerson * sharing : maxPerPerson;
  const all = getAllSuburbs();

  // Find affordable suburbs
  const affordable = all
    .filter((s) => {
      const rent = s[rentKey] as number | null;
      return rent != null && rent <= maxTotalRent;
    })
    .sort((a, b) => (b.total_bonds ?? 0) - (a.total_bonds ?? 0));

  const bedLabel = lookupBeds ? `${lookupBeds}-bedroom` : "";
  const lines: string[] = [];

  lines.push(`USER'S SITUATION:`);
  lines.push(`  Annual income: $${income.toLocaleString("en-AU")} ($${weeklyIncome}/wk)`);
  if (isSharing) {
    lines.push(`  Living arrangement: SHARING with ${sharing} people total (splitting rent ${sharing} ways)`);
    if (sharing === 2 && shareBedroom) lines.push(`  Sharing a bedroom (couple/close friends) — looking at 1-bed rent ÷ 2`);
    lines.push(`  Max per-person rent (30% rule): $${maxPerPerson}/wk`);
    lines.push(`  Max total rent for the group: $${maxTotalRent}/wk`);
  } else {
    lines.push(`  Max affordable rent (30% rule): $${maxPerPerson}/wk`);
  }
  if (bedrooms) lines.push(`  Looking for: ${bedLabel}`);
  if (workplace) {
    const wp = all.find((s) => s.postcode === workplace);
    if (wp) lines.push(`  Works near: ${wp.suburb_name} (${workplace})`);
  }
  lines.push("");

  if (isSharing) {
    lines.push(
      `AFFORDABLE ${bedLabel.toUpperCase()} SUBURBS FOR SHARING ÷${sharing} (total rent ≤ $${maxTotalRent}/wk, sorted by supply):`,
    );
    for (const s of affordable.slice(0, 20)) {
      const totalRent = s[rentKey] as number;
      const perPerson = Math.round(totalRent / sharing);
      const stress = Math.round((perPerson / weeklyIncome) * 100);
      lines.push(
        `  ${s.suburb_name} (${s.postcode}): $${totalRent}/wk total → $${perPerson}/pp (${stress}% of income), ${s.total_bonds.toLocaleString("en-AU")} bonds`,
      );
    }
  } else {
    lines.push(
      `AFFORDABLE ${bedLabel.toUpperCase()} SUBURBS FOR THIS USER (rent ≤ $${maxPerPerson}/wk, sorted by rental supply):`,
    );
    for (const s of affordable.slice(0, 20)) {
      const rent = s[rentKey] as number;
      const stress = Math.round((rent / weeklyIncome) * 100);
      lines.push(
        `  ${s.suburb_name} (${s.postcode}): $${rent}/wk (${stress}% of income), ${s.total_bonds.toLocaleString("en-AU")} bonds`,
      );
    }
  }

  if (affordable.length === 0) {
    lines.push("  No suburbs found within the 30% rule. The user may need to consider higher rent stress or smaller bedrooms.");
  }

  return lines.join("\n");
}
