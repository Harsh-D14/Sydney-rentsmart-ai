import { NextRequest, NextResponse } from "next/server";
import { getSuburbByKey, getSuburbByPostcode, sydneyMedianRent } from "@/lib/suburbs";
import { getNearbyStations } from "@/lib/commute";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ suburbKey: string }> },
) {
  try {
    const { suburbKey } = await params;

    // Try suburb_key first (e.g. "Parramatta_2150"), fall back to postcode
    const suburb = getSuburbByKey(suburbKey) ?? getSuburbByPostcode(suburbKey);

    if (!suburb) {
      return NextResponse.json(
        { error: `Suburb "${suburbKey}" not found` },
        { status: 404 },
      );
    }

    // Nearby stations within 0.5 km
    let nearby_stations: {
      name: string;
      distance_km: number;
      type: string;
      lines: string[];
    }[] = [];
    if (suburb.lat != null && suburb.lng != null) {
      const results = getNearbyStations(suburb.lat, suburb.lng, 0.5);
      nearby_stations = results.map((ns) => ({
        name: ns.station.name,
        distance_km: ns.distanceKm,
        type: ns.station.type,
        lines: ns.station.lines,
      }));
    }

    return NextResponse.json({
      suburb,
      nearby_stations,
      // Keep backward compat: nearest_station is the first one (or null)
      nearest_station: nearby_stations.length > 0 ? nearby_stations[0] : null,
      sydney_medians: {
        overall: sydneyMedianRent("median_rent_overall"),
        "1bed": sydneyMedianRent("median_rent_1bed"),
        "2bed": sydneyMedianRent("median_rent_2bed"),
        "3bed": sydneyMedianRent("median_rent_3bed"),
      },
    });
  } catch (error) {
    console.error("GET /api/suburbs/[suburbKey] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
