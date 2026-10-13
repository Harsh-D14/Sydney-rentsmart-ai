// ---------------------------------------------------------------------------
// GET /api/suburbs/[suburbKey] — one suburb (e.g. "Parramatta_2150")
//
// A bare postcode ("2150") is also accepted and gives that postcode's
// representative suburb.
//
//   {
//     suburb: Suburb,                       // the row for this suburb name; all
//                                           // rent figures are postcode-level
//     suburb_names: string[],               // real suburbs sharing the postcode, A-Z
//     low_sample: boolean,                  // postcode has < 100 bonds
//     postcode_centroid: { lat, lng } | null,
//     nearby_stations: Station[],           // within 2 km of the suburb's own
//                                           // coords, nearest first, max 5
//     nearest_station: Station | null,      // closest station at any distance
//     sydney_medians: { overall, "1bed", "2bed", "3bed", "4bed" }
//                                           // median across postcodes
//   }
//   Station = { name, distance_km, type, lines: string[] }
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import {
  getPostcodeArea,
  getSuburbByKey,
  getSuburbByPostcode,
  sydneyMedianRent,
} from "@/lib/suburbs";
import {
  getNearbyStations,
  getNearestStation,
  type NearestStationResult,
} from "@/lib/commute";

const CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";
const NEARBY_RADIUS_KM = 2;
const MAX_NEARBY_STATIONS = 5;

function toStation(ns: NearestStationResult) {
  return {
    name: ns.station.name,
    distance_km: ns.distanceKm,
    type: ns.station.type,
    lines: ns.station.lines,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ suburbKey: string }> },
) {
  try {
    const { suburbKey } = await params;

    // Try suburb_key first (e.g. "Parramatta_2150"), fall back to postcode
    const suburb = getSuburbByKey(suburbKey) ?? getSuburbByPostcode(suburbKey);

    if (!suburb) {
      return NextResponse.json({ error: "Suburb not found" }, { status: 404 });
    }

    const area = getPostcodeArea(suburb.postcode);

    let nearby_stations: ReturnType<typeof toStation>[] = [];
    let nearest_station: ReturnType<typeof toStation> | null = null;
    if (suburb.lat != null && suburb.lng != null) {
      nearby_stations = getNearbyStations(suburb.lat, suburb.lng, NEARBY_RADIUS_KM)
        .slice(0, MAX_NEARBY_STATIONS)
        .map(toStation);

      if (nearby_stations.length > 0) {
        nearest_station = nearby_stations[0];
      } else {
        const ns = getNearestStation(suburb.lat, suburb.lng);
        nearest_station = ns ? toStation(ns) : null;
      }
    }

    return NextResponse.json(
      {
        suburb,
        suburb_names: area?.suburb_names ?? [],
        low_sample: area?.low_sample ?? false,
        postcode_centroid:
          area && area.lat != null && area.lng != null
            ? { lat: area.lat, lng: area.lng }
            : null,
        nearby_stations,
        nearest_station,
        sydney_medians: {
          overall: sydneyMedianRent("median_rent_overall"),
          "1bed": sydneyMedianRent("median_rent_1bed"),
          "2bed": sydneyMedianRent("median_rent_2bed"),
          "3bed": sydneyMedianRent("median_rent_3bed"),
          "4bed": sydneyMedianRent("median_rent_4bed"),
        },
      },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    console.error("GET /api/suburbs/[suburbKey] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
