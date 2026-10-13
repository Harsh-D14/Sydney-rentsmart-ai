import { describe, expect, it } from "vitest";
import { parseRoutePoints, roundCoord } from "@/lib/route-params";

const VALID = {
  from_lat: "-33.870846",
  from_lng: "151.20733",
  to_lat: "-33.813557",
  to_lng: "151.003407",
};

function parse(overrides: Record<string, string | null> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...VALID, ...overrides })) {
    if (value !== null) params.set(key, value);
  }
  return parseRoutePoints(params);
}

describe("roundCoord", () => {
  it("rounds to 3 decimals", () => {
    expect(roundCoord(-33.870846)).toBe(-33.871);
    expect(roundCoord(151.20733)).toBe(151.207);
    expect(roundCoord(151.2)).toBe(151.2);
  });
});

describe("parseRoutePoints", () => {
  it("accepts four valid in-area coordinates and rounds them to 3 decimals", () => {
    expect(parse()).toEqual({
      ok: true,
      points: { fromLat: -33.871, fromLng: 151.207, toLat: -33.814, toLng: 151.003 },
    });
  });

  it.each(["from_lat", "from_lng", "to_lat", "to_lng"])("rejects a missing %s", (key) => {
    const result = parse({ [key]: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Missing or invalid/);
  });

  it.each(["12abc", "abc", "", "   ", "NaN", "Infinity", "-33.8,151.2", "1e999"])(
    "rejects junk value %j",
    (junk) => {
      const result = parse({ from_lat: junk });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/Missing or invalid/);
    },
  );

  it("rejects a point outside Greater Sydney, at either end", () => {
    const melbourneFrom = parse({ from_lat: "-37.8136", from_lng: "144.9631" });
    expect(melbourneFrom).toEqual({
      ok: false,
      error: "Both points must be within Greater Sydney",
    });
    const melbourneTo = parse({ to_lat: "-37.8136", to_lng: "144.9631" });
    expect(melbourneTo.ok).toBe(false);
  });

  it("rejects swapped latitude and longitude", () => {
    expect(parse({ from_lat: "151.207", from_lng: "-33.871" }).ok).toBe(false);
  });
});
