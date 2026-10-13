"use client";

import { useEffect, useState } from "react";
import { Car, Navigation, Train } from "lucide-react";

// ---------------------------------------------------------------------------
// Commute between the suburb and the workplace passed in the URL.
//
// Two lookups run side by side: /api/commute (driving time, public transport
// time, straight-line distance) and /api/directions (routed driving time plus
// the geometry drawn on the map). Either may fail on its own.
// ---------------------------------------------------------------------------

interface TransitInfo {
  duration_min: number;
  transfers: number;
  summary: string;
}

interface DrivingInfo {
  duration_min: number;
  distance_km: number;
  traffic_note: string;
  /** True for the straight-line fallback, false for a routed answer. */
  is_estimate: boolean;
}

export interface CommuteData {
  transit: TransitInfo | null;
  driving: DrivingInfo | null;
  straight_line_km: number | null;
}

export interface DirectionsData {
  duration_minutes: number;
  distance_km: number;
  /** [lat, lng] pairs */
  geometry: [number, number][];
}

export interface CommuteLookup {
  loading: boolean;
  commute: CommuteData | null;
  directions: DirectionsData | null;
}

interface LookupState {
  key: string;
  commute: CommuteData | null;
  directions: DirectionsData | null;
}

// ---------------------------------------------------------------------------
// Response parsing: both endpoints can answer with { error } or a non-JSON
// error page, so nothing is trusted until it has the expected shape.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

function parseCommute(body: unknown): CommuteData | null {
  if (!isRecord(body) || "error" in body) return null;

  const t = body.transit;
  const transit: TransitInfo | null =
    isRecord(t) && isNumber(t.duration_min)
      ? {
          duration_min: t.duration_min,
          transfers: isNumber(t.transfers) ? t.transfers : 0,
          summary: typeof t.summary === "string" ? t.summary : "",
        }
      : null;

  const d = body.driving;
  const driving: DrivingInfo | null =
    isRecord(d) && isNumber(d.duration_min)
      ? {
          duration_min: d.duration_min,
          distance_km: isNumber(d.distance_km) ? d.distance_km : 0,
          traffic_note: typeof d.traffic_note === "string" ? d.traffic_note : "",
          is_estimate: d.is_estimate === true,
        }
      : null;

  const straight_line_km = isNumber(body.straight_line_km) ? body.straight_line_km : null;

  if (!transit && !driving && straight_line_km === null) return null;
  return { transit, driving, straight_line_km };
}

function parseDirections(body: unknown): DirectionsData | null {
  if (!isRecord(body) || "error" in body) return null;
  if (!isNumber(body.duration_minutes) || !isNumber(body.distance_km)) return null;

  const geometry = Array.isArray(body.geometry)
    ? body.geometry.filter(
        (p): p is [number, number] =>
          Array.isArray(p) && p.length === 2 && isNumber(p[0]) && isNumber(p[1]),
      )
    : [];

  return {
    duration_minutes: body.duration_minutes,
    distance_km: body.distance_km,
    geometry,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Look up the commute between two points. Pass coordinates already rounded to
 * 3 decimals (both endpoints are cached by full URL); pass null for any of
 * them to skip the lookup.
 */
export function useCommute(
  fromLat: number | null,
  fromLng: number | null,
  toLat: number | null,
  toLng: number | null,
): CommuteLookup {
  const [state, setState] = useState<LookupState | null>(null);

  const key =
    fromLat != null && fromLng != null && toLat != null && toLng != null
      ? `from_lat=${fromLat}&from_lng=${fromLng}&to_lat=${toLat}&to_lng=${toLng}`
      : null;

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();

    Promise.allSettled([
      fetchJson(`/api/commute?${key}`, controller.signal),
      fetchJson(`/api/directions?${key}&mode=driving`, controller.signal),
    ]).then(([commuteResult, directionsResult]) => {
      if (controller.signal.aborted) return;
      setState({
        key,
        commute:
          commuteResult.status === "fulfilled" ? parseCommute(commuteResult.value) : null,
        directions:
          directionsResult.status === "fulfilled"
            ? parseDirections(directionsResult.value)
            : null,
      });
    });

    return () => controller.abort();
  }, [key]);

  const current = key !== null && state?.key === key ? state : null;
  return {
    loading: key !== null && current === null,
    commute: current?.commute ?? null,
    directions: current?.directions ?? null,
  };
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

const CARD = "rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm";
const CARD_TITLE = "mb-3 flex items-center gap-2 text-sm font-semibold text-primary";

export function CommuteSection({
  workplaceName,
  lookup,
}: {
  /** Null when the link carried coordinates but no name. */
  workplaceName: string | null;
  lookup: CommuteLookup;
}) {
  const { loading, commute, directions } = lookup;

  // A routed result from /api/directions wins; otherwise whatever /api/commute
  // gave, which is either routed or a flagged straight-line estimate.
  const fallback = commute?.driving ?? null;
  const driving = directions
    ? {
        minutes: directions.duration_minutes,
        km: directions.distance_km,
        isEstimate: false,
        note: "",
      }
    : fallback
      ? {
          minutes: fallback.duration_min,
          km: fallback.distance_km,
          isEstimate: fallback.is_estimate,
          note: fallback.is_estimate ? "" : fallback.traffic_note,
        }
      : null;

  const transit = commute?.transit ?? null;
  const straightLineKm = commute?.straight_line_km ?? null;
  const nothingToShow = !driving && !transit && straightLineKm === null;

  return (
    <div className="mt-10 animate-slide-up" style={{ animationDelay: "560ms" }}>
      <h2 className="mb-6 text-xl font-bold text-primary">
        Commute to {workplaceName ?? "workplace"}
      </h2>
      {loading ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm"
        >
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-primary" />
          <span className="text-sm text-slate-500">Calculating route...</span>
        </div>
      ) : nothingToShow ? (
        <p className="rounded-xl border border-slate-200/80 bg-white p-6 text-sm text-slate-500 shadow-sm">
          Commute times aren&apos;t available right now.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Driving */}
          {driving && (
            <section className={CARD}>
              <div className={CARD_TITLE}>
                <Car className="h-4 w-4" aria-hidden="true" />
                Driving
                {driving.isEstimate && (
                  <span className="ml-auto rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                    Estimate
                  </span>
                )}
              </div>
              <p className="text-2xl font-extrabold text-slate-900">
                {driving.isEstimate ? "~" : ""}
                {driving.minutes} min
              </p>
              {driving.isEstimate ? (
                <p className="mt-1 text-sm text-slate-500">
                  Estimated from straight-line distance, not a routed driving
                  time.
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">
                  {driving.km} km by road
                  {driving.note && (
                    <span className="text-xs text-slate-400"> &middot; {driving.note}</span>
                  )}
                </p>
              )}
            </section>
          )}

          {/* Public transport: only when a journey was actually found */}
          {transit && (
            <section className={CARD}>
              <div className={CARD_TITLE}>
                <Train className="h-4 w-4" aria-hidden="true" />
                Public Transport
              </div>
              <p className="text-2xl font-extrabold text-slate-900">
                {transit.duration_min} min
              </p>
              {transit.summary && (
                <p className="mt-1 text-sm text-slate-500">{transit.summary}</p>
              )}
              {transit.transfers > 0 && (
                <p className="mt-0.5 text-xs text-slate-400">
                  {transit.transfers} transfer{transit.transfers > 1 ? "s" : ""}
                </p>
              )}
            </section>
          )}

          {/* Straight line distance */}
          {straightLineKm !== null && (
            <section className={CARD}>
              <div className={CARD_TITLE}>
                <Navigation className="h-4 w-4" aria-hidden="true" />
                Distance
              </div>
              <p className="text-2xl font-extrabold text-slate-900">
                {straightLineKm} km
              </p>
              <p className="mt-1 text-sm text-slate-500">straight line</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
