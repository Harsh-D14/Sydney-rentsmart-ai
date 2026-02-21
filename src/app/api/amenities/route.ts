import { NextRequest, NextResponse } from "next/server";
import { getAmenities, getAmenitySummary, getAmenityScore } from "@/lib/amenities";

export async function GET(request: NextRequest) {
  const postcode = request.nextUrl.searchParams.get("postcode");

  if (!postcode) {
    return NextResponse.json(
      { error: "Missing required param: postcode" },
      { status: 400 },
    );
  }

  const amenities = getAmenities(postcode);
  const summary = getAmenitySummary(postcode);
  const score = getAmenityScore(postcode);

  return NextResponse.json({ postcode, amenities, summary, score });
}
