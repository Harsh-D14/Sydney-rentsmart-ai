// ---------------------------------------------------------------------------
// Rent stress bands — one definition for the server, cards and About page
// ---------------------------------------------------------------------------

export type RentStressRating = "comfortable" | "manageable" | "stressed" | "severe";

export interface StressBand {
  rating: RentStressRating;
  label: string;
  /** Tailwind classes */
  text: string;
  dot: string;
  badge: string;
}

const BANDS: Record<RentStressRating, StressBand> = {
  comfortable: {
    rating: "comfortable",
    label: "Comfortable",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 border-emerald-200",
  },
  manageable: {
    rating: "manageable",
    label: "Manageable",
    text: "text-amber-700",
    dot: "bg-amber-500",
    badge: "bg-amber-50 border-amber-200",
  },
  stressed: {
    rating: "stressed",
    label: "Stressed",
    text: "text-orange-700",
    dot: "bg-orange-500",
    badge: "bg-orange-50 border-orange-200",
  },
  severe: {
    rating: "severe",
    label: "Severe",
    text: "text-red-700",
    dot: "bg-red-500",
    badge: "bg-red-50 border-red-200",
  },
};

/** Under 25% comfortable, 25–30% manageable, 30–40% stressed, over 40% severe. */
export function getRentStressRating(percentage: number): RentStressRating {
  if (percentage < 25) return "comfortable";
  if (percentage <= 30) return "manageable";
  if (percentage <= 40) return "stressed";
  return "severe";
}

export function stressBand(percentage: number): StressBand {
  return BANDS[getRentStressRating(percentage)];
}
