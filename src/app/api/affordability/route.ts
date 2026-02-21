import { NextRequest, NextResponse } from "next/server";
import {
  getSuburbByPostcode,
  calculateRentStress,
  medianRentKey,
} from "@/lib/suburbs";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const postcode = params.get("postcode");
    const incomeStr = params.get("income");
    const bedroomsStr = params.get("bedrooms");

    // --- Validation ---
    if (!postcode || !incomeStr) {
      return NextResponse.json(
        { error: "Missing required params: postcode, income" },
        { status: 400 },
      );
    }

    const income = Number(incomeStr);
    if (isNaN(income) || income < 0) {
      return NextResponse.json(
        { error: "income must be a non-negative number (weekly $)" },
        { status: 400 },
      );
    }

    const bedrooms = bedroomsStr ? Number(bedroomsStr) : null;
    if (bedrooms !== null && (isNaN(bedrooms) || bedrooms < 1 || bedrooms > 5)) {
      return NextResponse.json(
        { error: "bedrooms must be between 1 and 5" },
        { status: 400 },
      );
    }

    // --- Lookup ---
    const suburb = getSuburbByPostcode(postcode);
    if (!suburb) {
      return NextResponse.json(
        { error: `Postcode ${postcode} not found in Sydney data` },
        { status: 404 },
      );
    }

    // Pick the relevant median rent
    const rentKey = bedrooms ? medianRentKey(bedrooms) : "median_rent_overall";
    const medianRent = suburb[rentKey] as number | null;

    if (medianRent === null) {
      return NextResponse.json(
        {
          error: `No rent data for ${bedrooms ?? "overall"}-bedroom in postcode ${postcode}`,
        },
        { status: 404 },
      );
    }

    const stress = calculateRentStress(income, medianRent);

    return NextResponse.json({
      postcode: suburb.postcode,
      suburb_name: suburb.suburb_name,
      bedrooms: bedrooms ?? "overall",
      weekly_income: income,
      median_rent: medianRent,
      rent_stress_pct: stress.percentage,
      rating: stress.rating,
      median_household_income_weekly: suburb.median_household_income_weekly,
    });
  } catch (error) {
    console.error("GET /api/affordability error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
