import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/recommend/route";
import { getPostcodeArea } from "@/lib/suburbs";

// Amenity fields (amenities, amenity_score) are deliberately not asserted
// here: that data is being rebuilt separately.

interface Area {
  postcode: string;
  suburb_key: string;
  suburb_name: string;
  suburb_names: string[];
  lat: number;
  lng: number;
  median_rent: number;
  rent_stress_pct: number;
  rating: string | null;
  total_bonds: number;
  low_sample: boolean;
  sharing_mode: number;
  total_rent: number;
  per_person_rent: number;
  solo_rent: number | null;
  savings_vs_solo: number | null;
  rent_estimated: boolean;
  is_workplace: boolean;
  distance_to_workplace_km: number | null;
}

async function call(query: string) {
  const res = await GET(new NextRequest(`http://localhost/api/recommend${query}`));
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe("GET /api/recommend validation", () => {
  it.each([
    ["no income", ""],
    ["empty income", "?income="],
    ["non-numeric income", "?income=abc"],
    ["trailing junk", "?income=1500abc"],
    ["zero income", "?income=0"],
    ["negative income", "?income=-500"],
    ["infinite income", "?income=Infinity"],
    ["unknown mode", "?income=1500&mode=rich"],
    ["fractional sharing", "?income=1500&sharing=2.5"],
    ["sharing too high", "?income=1500&sharing=5"],
    ["sharing zero", "?income=1500&sharing=0"],
    ["bedrooms too high", "?income=1500&bedrooms=6"],
    ["fractional bedrooms", "?income=1500&bedrooms=1.5"],
    ["workplace too long", `?income=1500&workplace=${"a".repeat(101)}`],
  ])("400 for %s", async (_label, query) => {
    const { status, body } = await call(query);
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(body.suburbs).toBeUndefined();
  });
});

describe("GET /api/recommend income mode", () => {
  it("returns one result per postcode, none above 100% of income", async () => {
    const { status, body, headers } = await call("?income=1500");
    expect(status).toBe(200);
    expect(headers.get("Cache-Control")).toContain("s-maxage");
    expect(body.mode).toBe("income");
    expect(body.income_weekly).toBe(1500);
    expect(body.bedrooms).toBe("overall");
    expect(body.sharing_mode).toBe(1);

    const areas: Area[] = body.suburbs;
    expect(areas.length).toBeGreaterThan(0);
    expect(body.total_matching).toBe(areas.length);
    expect(new Set(areas.map((a) => a.postcode)).size).toBe(areas.length);

    for (const a of areas) {
      expect(a.rent_stress_pct).toBeLessThanOrEqual(100);
      expect(a.rent_stress_pct).toBeGreaterThan(0);
      expect(typeof a.lat).toBe("number");
      expect(typeof a.lng).toBe("number");
      expect(["comfortable", "manageable", "stressed", "severe"]).toContain(a.rating);
      expect(a.per_person_rent).toBe(a.total_rent);
      expect(a.median_rent).toBe(a.per_person_rent);
      expect(a.rent_stress_pct).toBe(Math.round((a.per_person_rent / 1500) * 1000) / 10);
      expect(a.low_sample).toBe(a.total_bonds < 100);
      expect(a.solo_rent).toBeNull();
      expect(a.distance_to_workplace_km).toBeNull();
      expect(a.is_workplace).toBe(false);
    }
  });

  it("sorts by rent_stress_pct ascending", async () => {
    const { body } = await call("?income=1500&bedrooms=2");
    const pcts = (body.suburbs as Area[]).map((a) => a.rent_stress_pct);
    expect(pcts.length).toBeGreaterThan(1);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
  });

  it("uses the rent for the requested bedroom count, from the postcode data", async () => {
    const { body } = await call("?income=2000&bedrooms=2");
    expect(body.bedrooms).toBe(2);
    const parramatta = (body.suburbs as Area[]).find((a) => a.postcode === "2150")!;
    expect(parramatta.suburb_name).toBe("Parramatta");
    expect(parramatta.total_rent).toBe(getPostcodeArea("2150")!.median_rent_2bed);
    expect(parramatta.total_rent).toBe(550);
    expect(parramatta.rent_stress_pct).toBe(27.5);
    expect(parramatta.rating).toBe("manageable");
  });

  it("drops areas whose rent exceeds the whole income", async () => {
    const all = (await call("?income=100000")).body.suburbs as Area[];
    const low = (await call("?income=500")).body.suburbs as Area[];
    expect(low.length).toBeLessThan(all.length);
    for (const a of low) expect(a.per_person_rent).toBeLessThanOrEqual(500);
    // Everything affordable at 500 is in the wider list too
    const allPostcodes = new Set(all.map((a) => a.postcode));
    for (const a of low) expect(allPostcodes.has(a.postcode)).toBe(true);
  });

  it("never returns the three postcodes that have no coordinates", async () => {
    const { body } = await call("?income=100000");
    const postcodes = (body.suburbs as Area[]).map((a) => a.postcode);
    for (const pc of ["2012", "2057", "2059"]) expect(postcodes).not.toContain(pc);
    expect(postcodes).toHaveLength(234);
  });
});

describe("GET /api/recommend budget mode", () => {
  it("returns only areas within the budget, with no rating", async () => {
    const budget = 600;
    const { status, body } = await call(`?income=${budget}&mode=budget`);
    expect(status).toBe(200);
    expect(body.mode).toBe("budget");

    const areas: Area[] = body.suburbs;
    expect(areas.length).toBeGreaterThan(0);
    expect(new Set(areas.map((a) => a.postcode)).size).toBe(areas.length);
    for (const a of areas) {
      expect(a.per_person_rent).toBeLessThanOrEqual(budget);
      expect(a.rating).toBeNull();
    }
    const pcts = areas.map((a) => a.rent_stress_pct);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
  });

  it("applies the budget per person when sharing", async () => {
    const budget = 350;
    const { body } = await call(`?income=${budget}&mode=budget&sharing=2`);
    const areas: Area[] = body.suburbs;
    expect(areas.length).toBeGreaterThan(0);
    for (const a of areas) {
      expect(a.sharing_mode).toBe(2);
      expect(a.per_person_rent).toBeLessThanOrEqual(budget);
      expect(a.per_person_rent).toBeCloseTo(a.total_rent / 2, 1);
      expect(a.rating).toBeNull();
    }
  });
});

describe("GET /api/recommend sharing", () => {
  it("splits the 2-bed rent between two people and reports the saving", async () => {
    const { body } = await call("?income=1500&sharing=2");
    const parramatta = (body.suburbs as Area[]).find((a) => a.postcode === "2150")!;
    expect(parramatta.total_rent).toBe(550); // 2-bed
    expect(parramatta.per_person_rent).toBe(275);
    expect(parramatta.solo_rent).toBe(500); // 1-bed
    expect(parramatta.savings_vs_solo).toBe(225);
    expect(parramatta.rent_estimated).toBe(false);
  });

  it("uses the 1-bed rent for two people sharing a bedroom", async () => {
    const { body } = await call("?income=1500&sharing=2&share_bedroom=1");
    const parramatta = (body.suburbs as Area[]).find((a) => a.postcode === "2150")!;
    expect(parramatta.total_rent).toBe(500);
    expect(parramatta.per_person_rent).toBe(250);
  });
});

describe("GET /api/recommend workplace", () => {
  it('resolves "Sydney CBD"', async () => {
    const { body } = await call("?income=1500&workplace=Sydney%20CBD");
    expect(body.workplace_resolved).toBe(true);
    expect(body.workplace).toBe("Sydney");
    expect(body.workplace_query).toBe("Sydney CBD");
    expect(body.workplace_postcode).toBe("2000");
    expect(body.workplace_suburb_key).toBe("Sydney_2000");
    expect(body.workplace_lat).toBeCloseTo(-33.870846, 6);
    expect(body.workplace_lng).toBeCloseTo(151.20733, 6);

    const areas: Area[] = body.suburbs;
    for (const a of areas) {
      expect(typeof a.distance_to_workplace_km).toBe("number");
      expect(a.is_workplace).toBe(a.postcode === "2000");
    }
  });

  it("reports an unknown workplace as unresolved, and still returns results", async () => {
    const { status, body } = await call("?income=1500&workplace=zzzz");
    expect(status).toBe(200);
    expect(body.workplace_resolved).toBe(false);
    expect(body.workplace).toBeNull();
    expect(body.workplace_query).toBe("zzzz");
    expect(body.workplace_postcode).toBeNull();
    expect(body.workplace_lat).toBeNull();
    const areas: Area[] = body.suburbs;
    expect(areas.length).toBeGreaterThan(0);
    for (const a of areas) expect(a.distance_to_workplace_km).toBeNull();
  });

  it("treats no workplace as not resolved, with a null query", async () => {
    const { body } = await call("?income=1500");
    expect(body.workplace_resolved).toBe(false);
    expect(body.workplace_query).toBeNull();
  });
});
