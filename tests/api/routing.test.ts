import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { estimateCommuteMinutes, haversineKm } from "@/lib/geo";

// /api/commute and /api/directions. No test here reaches a real service:
// global fetch is replaced in every test, and API keys are blank unless a
// test sets a fake one alongside a stubbed fetch.

const IN_AREA = "from_lat=-33.870846&from_lng=151.20733&to_lat=-33.813557&to_lng=151.003407";
const OUT_OF_AREA = "from_lat=-37.8136&from_lng=144.9631&to_lat=-33.813557&to_lng=151.003407";
const JUNK = "from_lat=12abc&from_lng=151.20733&to_lat=-33.813557&to_lng=151.003407";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules(); // fresh rate-limit counters and a fresh read of the env
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("network call attempted in a test"));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENROUTE_API_KEY", "");
  vi.stubEnv("TFNSW_API_KEY", "");
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function commute(query: string) {
  const { GET } = await import("@/app/api/commute/route");
  const res = await GET(new NextRequest(`http://localhost/api/commute?${query}`));
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function directions(query: string) {
  const { GET } = await import("@/app/api/directions/route");
  const res = await GET(new NextRequest(`http://localhost/api/directions?${query}`));
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe("GET /api/commute", () => {
  it.each([
    ["out-of-area point", OUT_OF_AREA, "Both points must be within Greater Sydney"],
    ["junk coordinate", JUNK, "Missing or invalid params: from_lat, from_lng, to_lat, to_lng"],
    ["no params", "", "Missing or invalid params: from_lat, from_lng, to_lat, to_lng"],
  ])("400 for %s", async (_label, query, error) => {
    const { status, body, headers } = await commute(query);
    expect(status).toBe(400);
    expect(body).toEqual({ error });
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with no keys set, returns a flagged straight-line estimate and calls nothing", async () => {
    const { status, body, headers } = await commute(IN_AREA);
    expect(status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();

    // Coordinates are rounded to 3 decimals before use
    const km = haversineKm(-33.871, 151.207, -33.814, 151.003);
    expect(body.straight_line_km).toBe(Math.round(km * 10) / 10);
    expect(body.transit).toBeNull();
    expect(body.transit_error).toBe("not_configured");
    expect(body.driving_error).toBe("not_configured");
    expect(body.driving).toEqual({
      duration_min: estimateCommuteMinutes(km),
      distance_km: Math.round(km * 1.3 * 10) / 10,
      traffic_note: "estimate (API unavailable)",
      is_estimate: true,
    });
    expect(headers.get("Cache-Control")).toBe("no-store");
  });

  it("uses routed answers from TfNSW and Google when keys are set (fetch stubbed)", async () => {
    vi.stubEnv("TFNSW_API_KEY", "fake-tfnsw-key");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "fake-google-key");
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.transport.nsw.gov.au/v1/tp/trip?")) {
        return Response.json({
          journeys: [
            {
              legs: [
                {
                  origin: { departureTimePlanned: "2026-10-12T21:00:00Z" },
                  destination: {
                    name: "Parramatta Station, Platform 1",
                    arrivalTimePlanned: "2026-10-12T21:28:00Z",
                  },
                  transportation: { product: { class: 1 } },
                },
              ],
            },
          ],
        });
      }
      if (url === "https://routes.googleapis.com/directions/v2:computeRoutes") {
        return Response.json({
          routes: [{ duration: "1800s", staticDuration: "1800s", distanceMeters: 23456 }],
        });
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const { status, body, headers } = await commute(IN_AREA);
    expect(status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body.transit).toMatchObject({ duration_min: 28, transfers: 0, modes: ["train"] });
    expect(body.transit_error).toBeUndefined();
    expect(body.driving).toEqual({
      duration_min: 30,
      distance_km: 23.5,
      traffic_note: "typical conditions",
      is_estimate: false,
    });
    expect(body.driving_error).toBeUndefined();
    expect(headers.get("Cache-Control")).toContain("s-maxage=86400");

    // The TfNSW request asks for a Sydney weekday at 08:00, lng before lat
    const tfnswUrl = new URL(
      String(fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes("transport.nsw"))),
    );
    expect(tfnswUrl.searchParams.get("itdTime")).toBe("0800");
    expect(tfnswUrl.searchParams.get("itdDate")).toMatch(/^\d{8}$/);
    expect(tfnswUrl.searchParams.get("name_origin")).toBe("151.207:-33.871:EPSG:4326");
  });

  it("falls back to a flagged, uncached estimate when the upstreams fail", async () => {
    vi.stubEnv("TFNSW_API_KEY", "fake-tfnsw-key");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "fake-google-key");
    fetchMock.mockImplementation(async () => new Response("upstream down", { status: 500 }));

    const { status, body, headers } = await commute(IN_AREA);
    expect(status).toBe(200);
    expect(body.transit).toBeNull();
    expect(body.transit_error).toBe("unavailable");
    expect(body.driving_error).toBe("unavailable");
    expect(body.driving.is_estimate).toBe(true);
    expect(body.driving.duration_min).toBeGreaterThan(0);
    expect(headers.get("Cache-Control")).toBe("no-store");
    // Upstream error text is not passed to the client
    expect(JSON.stringify(body)).not.toContain("upstream down");
  });

  it("reports transit as unavailable, never 0 minutes, when TfNSW sends no usable journey", async () => {
    vi.stubEnv("TFNSW_API_KEY", "fake-tfnsw-key");
    fetchMock.mockImplementation(async () => Response.json({ journeys: [{ legs: [] }] }));

    const { body } = await commute(IN_AREA);
    expect(body.transit).toBeNull();
    expect(body.transit_error).toBe("unavailable");
  });
});

describe("GET /api/directions", () => {
  it.each([
    ["out-of-area point", OUT_OF_AREA],
    ["junk coordinate", JUNK],
    ["no params", ""],
    ["bad mode", `${IN_AREA}&mode=teleport`],
    ["empty mode", `${IN_AREA}&mode=`],
  ])("400 for %s", async (_label, query) => {
    const { status, body, headers } = await directions(query);
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the allowed modes when the mode is bad", async () => {
    const { body } = await directions(`${IN_AREA}&mode=walking`);
    expect(body.error).toBe('Invalid mode: must be "driving" or "cycling"');
  });

  it.each(["", "&mode=driving", "&mode=cycling"])(
    "503 without OPENROUTE_API_KEY (query suffix %j)",
    async (suffix) => {
      const { status, body, headers } = await directions(`${IN_AREA}${suffix}`);
      expect(status).toBe(503);
      expect(body).toEqual({ error: "Directions service unavailable" });
      expect(headers.get("Cache-Control")).toBe("no-store");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
