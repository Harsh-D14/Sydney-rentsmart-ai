import { describe, expect, it } from "vitest";
import { getRentStressRating, stressBand } from "@/lib/stress";

describe("getRentStressRating", () => {
  it.each([
    [0, "comfortable"],
    [24.9, "comfortable"],
    [25, "manageable"],
    [30, "manageable"],
    [30.1, "stressed"],
    [40, "stressed"],
    [40.1, "severe"],
    [100, "severe"],
  ] as const)("%s%% is %s", (pct, rating) => {
    expect(getRentStressRating(pct)).toBe(rating);
  });
});

describe("stressBand", () => {
  it("returns the band matching the rating, with a label", () => {
    expect(stressBand(10)).toMatchObject({ rating: "comfortable", label: "Comfortable" });
    expect(stressBand(25)).toMatchObject({ rating: "manageable", label: "Manageable" });
    expect(stressBand(40)).toMatchObject({ rating: "stressed", label: "Stressed" });
    expect(stressBand(41)).toMatchObject({ rating: "severe", label: "Severe" });
  });
});
