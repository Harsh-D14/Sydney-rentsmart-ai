// ---------------------------------------------------------------------------
// TfNSW Trip Planner helpers — pure functions (no I/O), so they can be tested
// ---------------------------------------------------------------------------

export interface TransitResult {
  duration_min: number;
  transfers: number;
  modes: string[];
  summary: string;
  departure: string;
  arrival: string;
}

const SYDNEY_TZ = "Australia/Sydney";

/** Hour of day (Sydney) at which the sample commute departs. */
const DEPARTURE_HOUR = 8;

/** itdTime for TfNSW, which reads it as Sydney local time. */
export const TRANSIT_DEPARTURE_TIME = `${String(DEPARTURE_HOUR).padStart(2, "0")}00`;

// ---------------------------------------------------------------------------
// Sydney-time date helpers
// ---------------------------------------------------------------------------

const sydneyDateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: SYDNEY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

const sydneyClock = new Intl.DateTimeFormat("en-AU", {
  timeZone: SYDNEY_TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * The next weekday (Mon-Fri) in Sydney whose 08:00 departure has not passed
 * yet, as YYYYMMDD. Uses the Sydney calendar, not the server's (UTC on Vercel).
 */
export function nextSydneyWeekday(now: Date = new Date()): string {
  const parts: Record<string, number> = {};
  for (const p of sydneyDateParts.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }

  // Work on the Sydney calendar date as a UTC-midnight timestamp so day
  // arithmetic and weekday lookup are free of any time zone or DST effects.
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.hour >= DEPARTURE_HOUR) date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/** Clock time in Sydney, e.g. "8:05 am". */
export function formatSydneyTime(date: Date): string {
  return sydneyClock.format(date);
}

// ---------------------------------------------------------------------------
// Journey parsing
// ---------------------------------------------------------------------------

interface TfnswLeg {
  origin?: { departureTimePlanned?: unknown };
  destination?: { name?: unknown; arrivalTimePlanned?: unknown };
  transportation?: { product?: { class?: unknown } };
}

interface ParsedJourney {
  legs: TfnswLeg[];
  departure: Date;
  arrival: Date;
  durationMin: number;
}

const MODE_BY_CLASS: Record<number, string> = {
  1: "train",
  2: "metro",
  4: "light_rail",
  5: "bus",
  9: "ferry",
  11: "school_bus",
};

/** TfNSW product classes 99 and 100 are walking / footpath legs. */
const WALKING_CLASSES = new Set([99, 100]);

function legClass(leg: TfnswLeg): number | undefined {
  const cls = leg.transportation?.product?.class;
  return typeof cls === "number" ? cls : undefined;
}

function parseTime(value: unknown): Date | null {
  if (typeof value !== "string" || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Returns null when the journey has no legs or no usable planned times. */
function parseJourney(journey: unknown): ParsedJourney | null {
  const rawLegs = (journey as { legs?: unknown } | null)?.legs;
  if (!Array.isArray(rawLegs) || rawLegs.length === 0) return null;

  const legs = rawLegs.filter(
    (l): l is TfnswLeg => typeof l === "object" && l !== null,
  );
  if (legs.length !== rawLegs.length) return null;

  const departure = parseTime(legs[0].origin?.departureTimePlanned);
  const arrival = parseTime(legs[legs.length - 1].destination?.arrivalTimePlanned);
  if (!departure || !arrival) return null;

  const durationMin = Math.round((arrival.getTime() - departure.getTime()) / 60000);
  if (!Number.isFinite(durationMin) || durationMin <= 0) return null;

  return { legs, departure, arrival, durationMin };
}

/**
 * Turn a TfNSW `/v1/tp/trip` rapidJSON payload into a TransitResult, using the
 * fastest usable journey. Returns null when no journey can be trusted (none
 * returned, legs missing, planned times absent or invalid): the caller must
 * report that as a failed lookup, never as a 0-minute commute.
 */
export function parseTransitJourneys(data: unknown): TransitResult | null {
  const journeys = (data as { journeys?: unknown } | null)?.journeys;
  if (!Array.isArray(journeys)) return null;

  let best: ParsedJourney | null = null;
  for (const journey of journeys) {
    const parsed = parseJourney(journey);
    if (parsed && (!best || parsed.durationMin < best.durationMin)) best = parsed;
  }
  if (!best) return null;

  const modes = new Set<string>();
  const stationNames: string[] = [];
  let transitLegCount = 0;
  let hasWalking = false;

  for (const leg of best.legs) {
    const cls = legClass(leg);
    if (cls === undefined) continue;
    if (WALKING_CLASSES.has(cls)) {
      hasWalking = true;
      continue;
    }

    transitLegCount += 1;
    if (MODE_BY_CLASS[cls]) modes.add(MODE_BY_CLASS[cls]);
    const destName = leg.destination?.name;
    if (typeof destName === "string" && destName) {
      stationNames.push(destName.split(",")[0].trim());
    }
  }

  // Walking is listed last, after the vehicle modes
  if (hasWalking) modes.add("walking");

  // Summary: primary mode via key stations
  const primaryMode =
    modes.has("train") ? "Train" :
    modes.has("metro") ? "Metro" :
    modes.has("light_rail") ? "Light Rail" :
    modes.has("ferry") ? "Ferry" :
    modes.has("bus") ? "Bus" :
    transitLegCount === 0 && hasWalking ? "Walk" :
    "Transit";

  const viaPart =
    stationNames.length > 0
      ? ` via ${stationNames.slice(0, 2).join(" → ")}`
      : "";

  return {
    duration_min: best.durationMin,
    transfers: Math.max(0, transitLegCount - 1),
    modes: Array.from(modes),
    summary: `${primaryMode}${viaPart}`,
    departure: formatSydneyTime(best.departure),
    arrival: formatSydneyTime(best.arrival),
  };
}
