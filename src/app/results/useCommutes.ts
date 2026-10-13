"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { roundCoord } from "@/lib/route-params";

// ---------------------------------------------------------------------------
// Routed commute times for the cards on screen
//
// The page hands over the areas currently at the top of the list (the first
// COMMUTE_TOP_N cards); this store fetches /api/commute for the ones it has
// not asked about yet.
//
//   - an area (postcode) is requested at most once per results page
//   - at most MAX_REQUESTS requests per results page, ever
//   - at most MAX_CONCURRENT in flight at once
//   - results are applied in small batches, so the list re-sorts a few times
//     rather than once per response
//
// Real times can re-order the list, which can bring new areas into the top
// rows, which are then fetched too. That settles by itself or stops at
// MAX_REQUESTS; it cannot loop.
//
// Anything that is not a routed answer (429, other non-OK, network failure,
// the server's own straight-line fallback) is simply left out, and the card
// keeps its estimate.
// ---------------------------------------------------------------------------

export const COMMUTE_TOP_N = 12;
const MAX_REQUESTS = 36;
const MAX_CONCURRENT = 6;
const FLUSH_DELAY_MS = 400;

export interface CommuteTarget {
  postcode: string;
  lat: number;
  lng: number;
}

export interface CommuteSnapshot {
  /** Routed driving minutes by postcode. Absent = no routed value. */
  minutes: Readonly<Record<string, number>>;
  /** Postcodes with a request queued or in flight. */
  loading: Readonly<Record<string, true>>;
}

const EMPTY_SNAPSHOT: CommuteSnapshot = { minutes: {}, loading: {} };

interface LatLng {
  lat: number;
  lng: number;
}

function commuteUrl(from: LatLng, to: LatLng): string {
  // Rounded to 3 decimals so equivalent requests share one CDN cache entry.
  const params = new URLSearchParams({
    from_lat: String(roundCoord(from.lat)),
    from_lng: String(roundCoord(from.lng)),
    to_lat: String(roundCoord(to.lat)),
    to_lng: String(roundCoord(to.lng)),
  });
  return `/api/commute?${params}`;
}

/** Routed driving minutes from a /api/commute body, or null if not routed. */
function routedDrivingMinutes(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const driving = (body as { driving?: unknown }).driving;
  if (typeof driving !== "object" || driving === null) return null;
  const { duration_min, is_estimate } = driving as {
    duration_min?: unknown;
    is_estimate?: unknown;
  };
  if (is_estimate !== false) return null;
  return typeof duration_min === "number" && Number.isFinite(duration_min) ? duration_min : null;
}

class CommuteStore {
  private snapshot: CommuteSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();

  /** Every postcode ever queued. Size is the request count against the cap. */
  private requested = new Set<string>();
  private queue: CommuteTarget[] = [];
  private inFlight = new Map<string, AbortController>();
  private destination: LatLng | null = null;
  /** Set after a 429: stop asking for the rest of this page. */
  private halted = false;

  private settledPostcodes: string[] = [];
  private settledMinutes: Record<string, number> = {};
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CommuteSnapshot => this.snapshot;

  /** Ask for routed times for any of `targets` not requested before. */
  request = (destination: LatLng, targets: readonly CommuteTarget[]): void => {
    if (this.halted) return;
    this.destination = destination;

    const added: CommuteTarget[] = [];
    for (const target of targets) {
      if (this.requested.size >= MAX_REQUESTS) break;
      if (this.requested.has(target.postcode)) continue;
      this.requested.add(target.postcode);
      added.push(target);
    }
    if (added.length === 0) return;

    this.queue.push(...added);
    const loading: Record<string, true> = { ...this.snapshot.loading };
    for (const target of added) loading[target.postcode] = true;
    this.setSnapshot({ minutes: this.snapshot.minutes, loading });
    this.pump();
  };

  /**
   * Abort everything outstanding. Aborted and queued areas are forgotten so
   * they can be requested again (React StrictMode re-runs effects in dev).
   */
  dispose(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    for (const [postcode, controller] of this.inFlight) {
      controller.abort();
      this.requested.delete(postcode);
    }
    for (const target of this.queue) this.requested.delete(target.postcode);
    this.inFlight.clear();
    this.queue = [];

    // Keep whatever had already come back; nothing is loading any more.
    const minutes = { ...this.snapshot.minutes, ...this.settledMinutes };
    this.settledPostcodes = [];
    this.settledMinutes = {};
    this.setSnapshot({ minutes, loading: {} });
  }

  private setSnapshot(next: CommuteSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private pump(): void {
    while (!this.halted && this.inFlight.size < MAX_CONCURRENT && this.queue.length > 0) {
      const target = this.queue.shift();
      if (target) this.start(target);
    }
  }

  private start(target: CommuteTarget): void {
    const destination = this.destination;
    if (!destination) return;

    const controller = new AbortController();
    this.inFlight.set(target.postcode, controller);

    fetch(commuteUrl(target, destination), { signal: controller.signal })
      .then(async (resp): Promise<number | null> => {
        if (resp.status === 429) {
          this.halt();
          return null;
        }
        if (!resp.ok) return null;
        return routedDrivingMinutes(await resp.json());
      })
      .catch(() => null)
      .then((minutes) => {
        if (controller.signal.aborted) return;
        this.inFlight.delete(target.postcode);
        this.settle(target.postcode, minutes);
        this.pump();
      });
  }

  /** Rate limited: drop the queue, let requests already in flight finish. */
  private halt(): void {
    if (this.halted) return;
    this.halted = true;
    for (const target of this.queue) this.settledPostcodes.push(target.postcode);
    this.queue = [];
  }

  private settle(postcode: string, minutes: number | null): void {
    this.settledPostcodes.push(postcode);
    if (minutes !== null) this.settledMinutes[postcode] = minutes;

    // Last one of a wave: apply now. Otherwise wait briefly for neighbours.
    if (this.inFlight.size === 0 && this.queue.length === 0) {
      this.flush();
    } else if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    }
  }

  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.settledPostcodes.length === 0) return;

    const loading: Record<string, true> = { ...this.snapshot.loading };
    for (const postcode of this.settledPostcodes) delete loading[postcode];
    const minutes = { ...this.snapshot.minutes, ...this.settledMinutes };
    this.settledPostcodes = [];
    this.settledMinutes = {};
    this.setSnapshot({ minutes, loading });
  }
}

const getServerSnapshot = (): CommuteSnapshot => EMPTY_SNAPSHOT;

/**
 * Routed driving minutes known so far, plus `request(destination, targets)`
 * to ask for more. Call `request` from an effect with the areas currently at
 * the top of the list; it is stable, idempotent per postcode and capped.
 */
export function useCommutes(): {
  snapshot: CommuteSnapshot;
  request: (destination: LatLng, targets: readonly CommuteTarget[]) => void;
} {
  // The store owns the "already requested" bookkeeping for this page. It lives
  // in state rather than a ref so render can read its snapshot.
  const [store] = useState(() => new CommuteStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);

  useEffect(() => () => store.dispose(), [store]);

  return { snapshot, request: store.request };
}
