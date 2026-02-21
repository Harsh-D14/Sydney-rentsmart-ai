import { NextRequest, NextResponse } from "next/server";
import { getAllSuburbs, searchSuburbs } from "@/lib/suburbs";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get("search");

    const results = search ? searchSuburbs(search) : getAllSuburbs();

    return NextResponse.json({ count: results.length, suburbs: results });
  } catch (error) {
    console.error("GET /api/suburbs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
