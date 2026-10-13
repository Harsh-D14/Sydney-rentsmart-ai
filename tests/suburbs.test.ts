import { describe, expect, it } from "vitest";
import {
  LOW_SAMPLE_BOND_THRESHOLD,
  getPostcodeArea,
  getPostcodeAreas,
  getSuburbByKey,
  getSuburbByPostcode,
  isRealSuburbName,
  medianRentKey,
  resolveWorkplace,
  searchSuburbs,
  sydneyMedianRent,
} from "@/lib/suburbs";
import { groupByPostcode, loadRawRows, type RawRow } from "./helpers";

const rawRows = loadRawRows();
const rawByPostcode = groupByPostcode(rawRows);

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe("getPostcodeAreas", () => {
  const areas = getPostcodeAreas();

  it("returns 237 areas, one per postcode, ordered by postcode", () => {
    expect(areas).toHaveLength(237);
    const postcodes = areas.map((a) => a.postcode);
    expect(new Set(postcodes).size).toBe(237);
    expect(postcodes).toEqual([...postcodes].sort());
    expect(new Set(postcodes)).toEqual(new Set(rawByPostcode.keys()));
  });

  it("names each area after one of its own suburbs", () => {
    for (const area of areas) {
      if (area.suburb_names.length === 0) {
        // Unnamed postcodes only
        expect(area.suburb_name).toBe(`Postcode ${area.postcode}`);
        continue;
      }
      expect(area.suburb_names, area.postcode).toContain(area.suburb_name);
    }
  });

  it("points suburb_key at a row of the same postcode", () => {
    for (const area of areas) {
      const row = getSuburbByKey(area.suburb_key);
      expect(row?.postcode, area.postcode).toBe(area.postcode);
    }
  });

  it("lists suburb_names alphabetically, without duplicates, all from the raw rows", () => {
    for (const area of areas) {
      const rawNames = new Set(rawByPostcode.get(area.postcode)!.map((r) => r.suburb_name));
      expect(new Set(area.suburb_names).size).toBe(area.suburb_names.length);
      expect(area.suburb_names).toEqual(
        [...area.suburb_names].sort((a, b) => a.localeCompare(b)),
      );
      for (const name of area.suburb_names) expect(rawNames.has(name)).toBe(true);
    }
  });

  it.each(["2000", "2150", "2113", "2756", "2170"])(
    "places the %s centroid at the mean of its rows' coordinates",
    (postcode) => {
      const located = rawByPostcode
        .get(postcode)!
        .filter((r): r is RawRow & { lat: number; lng: number } => r.lat != null && r.lng != null);
      expect(located.length).toBeGreaterThan(0);
      const area = getPostcodeArea(postcode)!;
      expect(area.lat).toBeCloseTo(mean(located.map((r) => r.lat)), 9);
      expect(area.lng).toBeCloseTo(mean(located.map((r) => r.lng)), 9);
    },
  );

  it("computes every centroid as the mean of the raw rows (null when none have coordinates)", () => {
    for (const area of areas) {
      const located = rawByPostcode
        .get(area.postcode)!
        .filter((r): r is RawRow & { lat: number; lng: number } => r.lat != null && r.lng != null);
      if (located.length === 0) {
        expect(area.lat).toBeNull();
        expect(area.lng).toBeNull();
      } else {
        expect(area.lat).toBeCloseTo(mean(located.map((r) => r.lat)), 9);
        expect(area.lng).toBeCloseTo(mean(located.map((r) => r.lng)), 9);
      }
    }
  });

  it("has exactly three postcodes without coordinates: 2012, 2057, 2059", () => {
    expect(areas.filter((a) => a.lat == null).map((a) => a.postcode)).toEqual([
      "2012",
      "2057",
      "2059",
    ]);
  });

  it("flags low_sample exactly when total_bonds is under the threshold", () => {
    expect(LOW_SAMPLE_BOND_THRESHOLD).toBe(100);
    for (const area of areas) {
      expect(area.low_sample, area.postcode).toBe(area.total_bonds < LOW_SAMPLE_BOND_THRESHOLD);
    }
    expect(areas.filter((a) => a.low_sample)).toHaveLength(10);
  });

  it("carries the postcode's bond count, so totals match the raw file", () => {
    let rawTotal = 0;
    for (const rows of rawByPostcode.values()) rawTotal += rows[0].total_bonds;
    const areaTotal = areas.reduce((sum, a) => sum + a.total_bonds, 0);
    expect(areaTotal).toBe(rawTotal);
    expect(areaTotal).toBe(1_129_892);
  });

  it("relies on figures being identical on every row of a postcode (true of the data)", () => {
    for (const rows of rawByPostcode.values()) {
      for (const row of rows) {
        expect(row.total_bonds).toBe(rows[0].total_bonds);
        expect(row.median_rent_overall).toBe(rows[0].median_rent_overall);
      }
    }
  });
});

describe("getSuburbByKey / getSuburbByPostcode", () => {
  it("finds a known key and rejects unknown or inherited ones", () => {
    expect(getSuburbByKey("Parramatta_2150")?.suburb_name).toBe("Parramatta");
    expect(getSuburbByKey("Nowhere_9999")).toBeUndefined();
    expect(getSuburbByKey("toString")).toBeUndefined();
    expect(getSuburbByKey("__proto__")).toBeUndefined();
  });

  it("gives the representative row for a postcode", () => {
    expect(getSuburbByPostcode("2150")?.suburb_key).toBe("Parramatta_2150");
    expect(getSuburbByPostcode("9999")).toBeUndefined();
  });
});

describe("isRealSuburbName", () => {
  it("rejects delivery points and keeps suburbs", () => {
    expect(isRealSuburbName("Parramatta")).toBe(true);
    expect(isRealSuburbName("Parramatta Westfield")).toBe(false);
    expect(isRealSuburbName("Waterloo Dc")).toBe(false);
    expect(isRealSuburbName("Wetherill Park Bc")).toBe(false);
    expect(isRealSuburbName(null)).toBe(false);
    expect(isRealSuburbName("")).toBe(false);
  });
});

describe("resolveWorkplace", () => {
  it('resolves "Sydney CBD" and "cbd" to Sydney 2000', () => {
    for (const text of ["Sydney CBD", "cbd"]) {
      expect(resolveWorkplace(text)).toEqual({
        suburb_key: "Sydney_2000",
        suburb_name: "Sydney",
        postcode: "2000",
        lat: -33.870846,
        lng: 151.20733,
      });
    }
  });

  it("resolves a bare postcode to its representative suburb at the centroid", () => {
    const area = getPostcodeArea("2150")!;
    expect(resolveWorkplace("2150")).toEqual({
      suburb_key: "Parramatta_2150",
      suburb_name: "Parramatta",
      postcode: "2150",
      lat: area.lat,
      lng: area.lng,
    });
  });

  it('resolves "Parramatta (2150)" to the Parramatta row itself', () => {
    expect(resolveWorkplace("Parramatta (2150)")).toEqual({
      suburb_key: "Parramatta_2150",
      suburb_name: "Parramatta",
      postcode: "2150",
      lat: -33.813557,
      lng: 151.003407,
    });
  });

  it("prefers the exact name over longer names containing it, ignoring case and spaces", () => {
    for (const text of ["ryde", "  RYDE "]) {
      const hit = resolveWorkplace(text);
      expect(hit?.suburb_key).toBe("Ryde_2112");
      expect(hit?.postcode).toBe("2112");
    }
  });

  it("returns null when nothing matches", () => {
    expect(resolveWorkplace("zzzz")).toBeNull();
    expect(resolveWorkplace("")).toBeNull();
    expect(resolveWorkplace("   ")).toBeNull();
    expect(resolveWorkplace("9999")).toBeNull(); // not a postcode in the data
    expect(resolveWorkplace("2012")).toBeNull(); // postcode without coordinates
  });
});

describe("searchSuburbs", () => {
  it("returns nothing for an empty or blank query", () => {
    expect(searchSuburbs("")).toEqual([]);
    expect(searchSuburbs("   ")).toEqual([]);
  });

  it("never returns delivery-point names that exist in the data", () => {
    const rawNames = new Set(rawRows.map((r) => r.suburb_name));
    expect(rawNames.has("Parramatta Westfield")).toBe(true);
    expect(rawNames.has("Waterloo Dc")).toBe(true);

    const parramatta = searchSuburbs("parramatta").map((s) => s.suburb_name);
    expect(parramatta).toContain("Parramatta");
    expect(parramatta).not.toContain("Parramatta Westfield");

    const waterloo = searchSuburbs("waterloo").map((s) => s.suburb_name);
    expect(waterloo).toContain("Waterloo");
    expect(waterloo).not.toContain("Waterloo Dc");

    expect(searchSuburbs("westfield")).toEqual([]);
  });

  it("only ever returns real suburb names, for names and postcode prefixes alike", () => {
    for (const query of ["a", "st", "park", "dc", "20", "2150", "west", "north"]) {
      for (const s of searchSuburbs(query)) {
        expect(isRealSuburbName(s.suburb_name), `${query} -> ${s.suburb_name}`).toBe(true);
      }
    }
  });

  it("ranks exact, then starts-with, then contains", () => {
    const names = searchSuburbs("ryde").map((s) => s.suburb_name);
    expect(names[0]).toBe("Ryde");
    expect(names).toEqual(expect.arrayContaining(["East Ryde", "North Ryde", "West Ryde"]));
  });

  it("matches a postcode prefix", () => {
    const hits = searchSuburbs("2150");
    expect(hits.map((s) => s.suburb_name).sort()).toEqual(["Harris Park", "Parramatta"]);
  });
});

describe("medianRentKey", () => {
  it("maps bedroom counts to rent fields", () => {
    expect(medianRentKey(1)).toBe("median_rent_1bed");
    expect(medianRentKey(4)).toBe("median_rent_4bed");
    expect(medianRentKey(5)).toBe("median_rent_5+bed");
    expect(medianRentKey(6)).toBe("median_rent_5+bed");
  });
});

describe("sydneyMedianRent", () => {
  /** Median across postcodes (first raw row each), low-sample postcodes left out. */
  function expectedMedian(field: string): number {
    const values: number[] = [];
    for (const rows of rawByPostcode.values()) {
      const row = rows[0];
      if (row.total_bonds < 100) continue;
      const value = row[field];
      if (typeof value === "number") values.push(value);
    }
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 1
      ? values[mid]
      : Math.round((values[mid - 1] + values[mid]) / 2);
  }

  it.each([
    "median_rent_overall",
    "median_rent_1bed",
    "median_rent_2bed",
    "median_rent_3bed",
    "median_rent_4bed",
    "median_rent_5+bed",
  ] as const)("%s matches an independent recomputation from the raw file", (field) => {
    const expected = expectedMedian(field);
    expect(expected).toBeGreaterThan(0);
    expect(sydneyMedianRent(field)).toBe(expected);
  });

  it("defaults to the overall rent field", () => {
    expect(sydneyMedianRent()).toBe(sydneyMedianRent("median_rent_overall"));
  });
});
