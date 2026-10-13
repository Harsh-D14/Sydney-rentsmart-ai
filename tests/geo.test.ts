import { describe, expect, it } from "vitest";
import {
  GREATER_SYDNEY_BOUNDS,
  estimateCommuteMinutes,
  haversineKm,
  isInGreaterSydney,
} from "@/lib/geo";
import { PARRAMATTA, SYDNEY_CBD, loadRawRows } from "./helpers";

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance by the spherical law of cosines: a different formula from the one under test. */
function lawOfCosinesKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return (
    6371 *
    Math.acos(
      Math.sin(rad(lat1)) * Math.sin(rad(lat2)) +
        Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1)),
    )
  );
}

describe("haversineKm", () => {
  it("matches an independent formula for Sydney CBD to Parramatta", () => {
    const expected = lawOfCosinesKm(
      SYDNEY_CBD.lat,
      SYDNEY_CBD.lng,
      PARRAMATTA.lat,
      PARRAMATTA.lng,
    );
    const actual = haversineKm(SYDNEY_CBD.lat, SYDNEY_CBD.lng, PARRAMATTA.lat, PARRAMATTA.lng);
    expect(actual).toBeCloseTo(expected, 4);
    // Sanity range for the same pair: about 19.9 km
    expect(actual).toBeGreaterThan(19.5);
    expect(actual).toBeLessThan(20.5);
  });

  it("is zero for identical points and symmetric", () => {
    expect(haversineKm(-33.87, 151.21, -33.87, 151.21)).toBe(0);
    expect(haversineKm(-33.87, 151.21, -33.81, 151.0)).toBeCloseTo(
      haversineKm(-33.81, 151.0, -33.87, 151.21),
      10,
    );
  });

  it("gives one degree of latitude as about 111.19 km", () => {
    expect(haversineKm(-34, 151, -33, 151)).toBeCloseTo((6371 * Math.PI) / 180, 6);
  });
});

describe("estimateCommuteMinutes", () => {
  it("has a 5 minute floor", () => {
    expect(estimateCommuteMinutes(0)).toBe(5);
    expect(estimateCommuteMinutes(0.2)).toBe(5);
  });

  it("uses the documented formula in each distance band", () => {
    expect(estimateCommuteMinutes(1)).toBe(7);
    expect(estimateCommuteMinutes(2.5)).toBe(18);
    expect(estimateCommuteMinutes(3)).toBe(21); // 15 + 3 * 2
    expect(estimateCommuteMinutes(5)).toBe(25);
    expect(estimateCommuteMinutes(10)).toBe(38); // 20 + 10 * 1.8
    expect(estimateCommuteMinutes(20)).toBe(56);
    expect(estimateCommuteMinutes(30)).toBe(75); // 30 + 30 * 1.5
    expect(estimateCommuteMinutes(40)).toBe(90);
  });

  it("does not go down across the 10 km and 30 km boundaries", () => {
    expect(estimateCommuteMinutes(10)).toBeGreaterThanOrEqual(estimateCommuteMinutes(9.999));
    expect(estimateCommuteMinutes(30)).toBeGreaterThanOrEqual(estimateCommuteMinutes(29.999));
  });

  it("is non-decreasing from 3 km upwards (0.01 km steps to 60 km)", () => {
    let previous = estimateCommuteMinutes(3);
    for (let i = 301; i <= 6000; i++) {
      const current = estimateCommuteMinutes(i / 100);
      expect(current, `at ${i / 100} km`).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  // KNOWN BUG in src/lib/geo.ts estimateCommuteMinutes: the under-3 km band
  // (distKm * 12) reaches 36 min just below 3 km, but the next band starts at
  // 15 + 3 * 2 = 21 min. So 2.99 km gives 36 min and 3.0 km gives 21 min: a
  // longer trip is estimated as 15 minutes quicker. Every distance from 1.80 km
  // to 2.99 km gets a higher estimate than 3.0 km does.
  // Remove `.fails` once the bands join up.
  it("is non-decreasing across the 3 km boundary", () => {
    expect(estimateCommuteMinutes(3)).toBeGreaterThanOrEqual(estimateCommuteMinutes(2.99));
  });
});

describe("isInGreaterSydney", () => {
  it("accepts points inside the box, edges included", () => {
    expect(isInGreaterSydney(SYDNEY_CBD.lat, SYDNEY_CBD.lng)).toBe(true);
    expect(isInGreaterSydney(PARRAMATTA.lat, PARRAMATTA.lng)).toBe(true);
    const b = GREATER_SYDNEY_BOUNDS;
    expect(isInGreaterSydney(b.minLat, b.minLng)).toBe(true);
    expect(isInGreaterSydney(b.maxLat, b.maxLng)).toBe(true);
  });

  it("rejects points outside the box", () => {
    expect(isInGreaterSydney(-37.8136, 144.9631)).toBe(false); // Melbourne
    expect(isInGreaterSydney(-32.9283, 151.7817)).toBe(false); // Newcastle
    expect(isInGreaterSydney(33.87, 151.21)).toBe(false); // wrong hemisphere
    expect(isInGreaterSydney(151.21, -33.87)).toBe(false); // lat/lng swapped
    expect(isInGreaterSydney(0, 0)).toBe(false);
  });

  it("rejects NaN and infinities", () => {
    expect(isInGreaterSydney(NaN, 151.2)).toBe(false);
    expect(isInGreaterSydney(-33.87, NaN)).toBe(false);
    expect(isInGreaterSydney(Infinity, 151.2)).toBe(false);
    expect(isInGreaterSydney(-33.87, -Infinity)).toBe(false);
  });

  // KNOWN DATA/BOUNDS MISMATCH: the row "Mellong_2756" in
  // src/data/sydney_suburbs.json sits at lat -33.168773, north of
  // GREATER_SYDNEY_BOUNDS.maxLat (-33.2). /api/commute and /api/directions
  // therefore answer 400 "Both points must be within Greater Sydney" for that
  // suburb's own coordinates. Remove `.fails` once the box (or the row) is fixed.
  it("contains every suburb row that has coordinates", () => {
    const outside = loadRawRows()
      .filter((r) => r.lat != null && r.lng != null && !isInGreaterSydney(r.lat, r.lng))
      .map((r) => r.suburb_key);
    expect(outside).toEqual([]);
  });
});
