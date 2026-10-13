import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as listSuburbs } from "@/app/api/suburbs/route";
import { GET as getSuburb } from "@/app/api/suburbs/[suburbKey]/route";
import { sydneyMedianRent } from "@/lib/suburbs";

async function list(query = "") {
  const res = await listSuburbs(new NextRequest(`http://localhost/api/suburbs${query}`));
  return { status: res.status, body: await res.json() };
}

async function detail(suburbKey: string) {
  const res = await getSuburb(
    new NextRequest(`http://localhost/api/suburbs/${encodeURIComponent(suburbKey)}`),
    { params: Promise.resolve({ suburbKey }) },
  );
  return { status: res.status, body: await res.json() };
}

describe("GET /api/suburbs (list)", () => {
  it("returns one slim map point per postcode that has coordinates", async () => {
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.count).toBe(body.suburbs.length);
    expect(body.suburbs).toHaveLength(234); // 237 postcodes less 3 without coordinates

    const postcodes = body.suburbs.map((s: { postcode: string }) => s.postcode);
    expect(new Set(postcodes).size).toBe(postcodes.length);

    const allowed = [
      "suburb_key",
      "postcode",
      "suburb_name",
      "suburb_names",
      "lat",
      "lng",
      "median_rent_overall",
      "median_rent_1bed",
      "median_rent_2bed",
      "median_rent_3bed",
      "median_household_income_weekly",
      "total_bonds",
      "dwelling_types",
      "low_sample",
    ].sort();
    for (const point of body.suburbs) {
      expect(Object.keys(point).sort()).toEqual(allowed);
      expect(typeof point.lat).toBe("number");
      expect(typeof point.lng).toBe("number");
    }
  });
});

describe("GET /api/suburbs?search=", () => {
  it("returns at most 10 matches, each with only key, postcode and name", async () => {
    for (const q of ["a", "st", "park", "2"]) {
      const { status, body } = await list(`?search=${q}`);
      expect(status).toBe(200);
      expect(body.suburbs).toHaveLength(10);
      expect(body.count).toBe(10);
      for (const s of body.suburbs) {
        expect(Object.keys(s).sort()).toEqual(["postcode", "suburb_key", "suburb_name"]);
      }
    }
  });

  it("puts the exact match first and leaves out delivery points", async () => {
    const { body } = await list("?search=parramatta");
    const names = body.suburbs.map((s: { suburb_name: string }) => s.suburb_name);
    expect(names[0]).toBe("Parramatta");
    expect(names).not.toContain("Parramatta Westfield");
  });

  it("returns an empty list when nothing matches", async () => {
    const { status, body } = await list("?search=zzzz");
    expect(status).toBe(200);
    expect(body).toEqual({ count: 0, suburbs: [] });
  });

  it("treats a blank search as the full list", async () => {
    const { body } = await list("?search=%20%20");
    expect(body.suburbs).toHaveLength(234);
  });

  it("rejects an over-long search", async () => {
    const { status, body } = await list(`?search=${"a".repeat(61)}`);
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
  });
});

describe("GET /api/suburbs/[suburbKey]", () => {
  it("returns a known suburb with postcode context", async () => {
    const { status, body } = await detail("Parramatta_2150");
    expect(status).toBe(200);
    expect(body.suburb.suburb_key).toBe("Parramatta_2150");
    expect(body.suburb.postcode).toBe("2150");
    expect(body.suburb.median_rent_overall).toBe(550);
    expect(body.suburb_names).toEqual(["Harris Park", "Parramatta"]);
    expect(body.low_sample).toBe(false);
    expect(body.postcode_centroid).toEqual({
      lat: expect.any(Number),
      lng: expect.any(Number),
    });
    expect(body.nearest_station).toMatchObject({
      name: expect.any(String),
      distance_km: expect.any(Number),
      lines: expect.any(Array),
    });
    expect(body.nearby_stations.length).toBeLessThanOrEqual(5);
    const distances = body.nearby_stations.map((s: { distance_km: number }) => s.distance_km);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    for (const d of distances) expect(d).toBeLessThanOrEqual(2);

    expect(body.sydney_medians).toEqual({
      overall: sydneyMedianRent("median_rent_overall"),
      "1bed": sydneyMedianRent("median_rent_1bed"),
      "2bed": sydneyMedianRent("median_rent_2bed"),
      "3bed": sydneyMedianRent("median_rent_3bed"),
      "4bed": sydneyMedianRent("median_rent_4bed"),
    });
  });

  it("accepts a bare postcode and gives its representative suburb", async () => {
    const { status, body } = await detail("2150");
    expect(status).toBe(200);
    expect(body.suburb.suburb_key).toBe("Parramatta_2150");
  });

  it("returns a non-representative suburb by its own key", async () => {
    const { status, body } = await detail("Harris_Park_2150");
    expect(status).toBe(200);
    expect(body.suburb.suburb_name).toBe("Harris Park");
    expect(body.suburb.postcode).toBe("2150");
  });

  it.each(["Nowhere_9999", "9999", "toString", "__proto__", "parramatta_2150"])(
    "404 for unknown key %s",
    async (key) => {
      const { status, body } = await detail(key);
      expect(status).toBe(404);
      expect(body).toEqual({ error: "Suburb not found" });
    },
  );
});
