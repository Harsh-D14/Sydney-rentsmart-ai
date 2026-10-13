import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRANSIT_DEPARTURE_TIME,
  formatSydneyTime,
  nextSydneyWeekday,
  parseTransitJourneys,
} from "@/lib/tfnsw-trip";

describe("nextSydneyWeekday", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // October 2026 is daylight saving time in Sydney (UTC+11).
  // 2026-10-12 is a Monday, 2026-10-16 a Friday.
  it.each([
    // [label, UTC instant, expected YYYYMMDD]
    ["Tue 07:30 Sydney (still Mon in UTC) -> same Sydney day", "2026-10-12T20:30:00Z", "20261013"],
    ["Tue 07:59 Sydney -> same Sydney day", "2026-10-12T20:59:00Z", "20261013"],
    ["Tue 08:00 Sydney (departure passed) -> Wed", "2026-10-12T21:00:00Z", "20261014"],
    ["Tue 23:30 Sydney -> Wed", "2026-10-13T12:30:00Z", "20261014"],
    ["Fri 07:00 Sydney -> Fri", "2026-10-15T20:00:00Z", "20261016"],
    ["Fri 09:00 Sydney -> Mon", "2026-10-15T22:00:00Z", "20261019"],
    ["Sat 03:00 Sydney (Fri in UTC) -> Mon", "2026-10-16T16:00:00Z", "20261019"],
    ["Sun 12:00 Sydney -> Mon", "2026-10-18T01:00:00Z", "20261019"],
    ["Sun 23:00 Sydney -> Mon", "2026-10-18T12:00:00Z", "20261019"],
    // July is standard time (UTC+10). 2026-07-02 is a Thursday.
    ["Thu 07:30 Sydney in winter -> Thu", "2026-07-01T21:30:00Z", "20260702"],
    ["Thu 08:30 Sydney in winter -> Fri", "2026-07-01T22:30:00Z", "20260703"],
    // Month and year roll-over. 2026-12-31 is a Thursday.
    ["Thu 31 Dec 09:00 Sydney -> Fri 1 Jan", "2026-12-30T22:00:00Z", "20270101"],
  ])("%s", (_label, instant, expected) => {
    vi.setSystemTime(new Date(instant));
    expect(nextSydneyWeekday()).toBe(expected);
    // Same answer when the instant is passed explicitly
    expect(nextSydneyWeekday(new Date(instant))).toBe(expected);
  });

  it("departs at 08:00", () => {
    expect(TRANSIT_DEPARTURE_TIME).toBe("0800");
  });
});

describe("formatSydneyTime", () => {
  it("formats in Sydney time, not UTC", () => {
    // 21:05 UTC on 12 Oct 2026 is 08:05 on the 13th in Sydney
    expect(formatSydneyTime(new Date("2026-10-12T21:05:00Z"))).toMatch(/^8:05\s?am$/i);
  });
});

// ---------------------------------------------------------------------------
// Journey parsing
// ---------------------------------------------------------------------------

function leg(
  cls: number,
  depart: string | undefined,
  arrive: string | undefined,
  destName?: string,
) {
  return {
    origin: { departureTimePlanned: depart },
    destination: { name: destName, arrivalTimePlanned: arrive },
    transportation: { product: { class: cls } },
  };
}

const WALK = 100;
const TRAIN = 1;
const BUS = 5;

/** 52 min: walk, bus, train, walk. */
const slowJourney = {
  legs: [
    leg(WALK, "2026-10-12T21:00:00Z", "2026-10-12T21:05:00Z", "Stop A"),
    leg(BUS, "2026-10-12T21:06:00Z", "2026-10-12T21:20:00Z", "Blacktown Station, Blacktown"),
    leg(TRAIN, "2026-10-12T21:25:00Z", "2026-10-12T21:48:00Z", "Parramatta Station, Platform 2"),
    leg(WALK, "2026-10-12T21:48:00Z", "2026-10-12T21:52:00Z", "Destination"),
  ],
};

/** 31 min: walk, train, train. */
const fastJourney = {
  legs: [
    leg(WALK, "2026-10-12T21:02:00Z", "2026-10-12T21:06:00Z", "Stop B"),
    leg(TRAIN, "2026-10-12T21:07:00Z", "2026-10-12T21:20:00Z", "Strathfield Station, Platform 3"),
    leg(TRAIN, "2026-10-12T21:23:00Z", "2026-10-12T21:33:00Z", "Central Station, Platform 16"),
  ],
};

describe("parseTransitJourneys", () => {
  it("picks the fastest journey and counts its transfers", () => {
    const result = parseTransitJourneys({ journeys: [slowJourney, fastJourney] });
    expect(result).not.toBeNull();
    expect(result!.duration_min).toBe(31);
    expect(result!.transfers).toBe(1); // two train legs
    expect(result!.modes).toEqual(["train", "walking"]);
    expect(result!.summary).toBe("Train via Strathfield Station → Central Station");
    expect(result!.departure).toMatch(/^8:02\s?am$/i);
    expect(result!.arrival).toMatch(/^8:33\s?am$/i);
  });

  it("gives the same answer whatever order the journeys arrive in", () => {
    expect(parseTransitJourneys({ journeys: [fastJourney, slowJourney] })).toEqual(
      parseTransitJourneys({ journeys: [slowJourney, fastJourney] }),
    );
  });

  it("describes a mixed bus and train journey", () => {
    const result = parseTransitJourneys({ journeys: [slowJourney] });
    expect(result).toMatchObject({
      duration_min: 52,
      transfers: 1,
      modes: ["bus", "train", "walking"],
      summary: "Train via Blacktown Station → Parramatta Station",
    });
  });

  it("reports a walk-only journey with no transfers", () => {
    const result = parseTransitJourneys({
      journeys: [{ legs: [leg(WALK, "2026-10-12T21:00:00Z", "2026-10-12T21:12:00Z", "There")] }],
    });
    expect(result).toMatchObject({
      duration_min: 12,
      transfers: 0,
      modes: ["walking"],
      summary: "Walk",
    });
  });

  it("skips a broken journey and uses a usable one beside it", () => {
    const broken = { legs: [leg(TRAIN, undefined, undefined, "Nowhere")] };
    const result = parseTransitJourneys({ journeys: [broken, slowJourney] });
    expect(result?.duration_min).toBe(52);
  });

  it.each([
    ["null payload", null],
    ["a string payload", "error"],
    ["no journeys key", {}],
    ["journeys not an array", { journeys: "none" }],
    ["empty journeys", { journeys: [] }],
    ["a journey without legs", { journeys: [{}] }],
    ["a journey with empty legs", { journeys: [{ legs: [] }] }],
    ["a null journey", { journeys: [null] }],
    ["legs that are not objects", { journeys: [{ legs: ["x", 1] }] }],
    ["missing departure time", { journeys: [{ legs: [leg(TRAIN, undefined, "2026-10-12T21:30:00Z")] }] }],
    ["missing arrival time", { journeys: [{ legs: [leg(TRAIN, "2026-10-12T21:00:00Z", undefined)] }] }],
    ["unparseable times", { journeys: [{ legs: [leg(TRAIN, "soon", "later")] }] }],
    ["empty-string times", { journeys: [{ legs: [leg(TRAIN, "", "")] }] }],
    [
      "arrival equal to departure (0 minutes)",
      { journeys: [{ legs: [leg(TRAIN, "2026-10-12T21:00:00Z", "2026-10-12T21:00:00Z")] }] },
    ],
    [
      "arrival before departure",
      { journeys: [{ legs: [leg(TRAIN, "2026-10-12T21:30:00Z", "2026-10-12T21:00:00Z")] }] },
    ],
  ])("returns null for %s", (_label, payload) => {
    expect(parseTransitJourneys(payload)).toBeNull();
  });

  it("never reports a 0-minute result for any of the broken shapes", () => {
    const shapes: unknown[] = [
      { journeys: [{ legs: [leg(TRAIN, "2026-10-12T21:00:00Z", "2026-10-12T21:00:10Z")] }] }, // 10 s rounds to 0
      { journeys: [{ legs: [{}] }] },
      { journeys: [{ legs: [{ origin: {}, destination: {} }] }] },
    ];
    for (const shape of shapes) {
      const result = parseTransitJourneys(shape);
      if (result !== null) expect(result.duration_min).toBeGreaterThan(0);
      else expect(result).toBeNull();
    }
    expect(parseTransitJourneys(shapes[0])).toBeNull();
  });
});
