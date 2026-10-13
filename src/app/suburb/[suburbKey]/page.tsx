"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  DollarSign,
  TrendingUp,
  Home,
  Building2,
  Users,
  Train,
  AlertTriangle,
  Info,
  Hospital,
  GraduationCap,
  School,
  Baby,
  ShoppingCart,
  TreePine,
  Dumbbell,
  BookOpen,
  Pill,
  Stethoscope,
} from "lucide-react";
import MapWrapper, { type MapPoint } from "@/components/MapWrapper";
import { isInGreaterSydney } from "@/lib/geo";
import { roundCoord } from "@/lib/route-params";
import { stressBand } from "@/lib/stress";
import type { Suburb } from "@/lib/suburbs";
import {
  EmergencyServicesCard,
  PlaceCard,
  measureFrom,
  toPlaceItems,
  type PlaceItem,
} from "./amenity-cards";
import { CommuteSection, useCommute } from "./commute-section";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StationInfo {
  name: string;
  distance_km: number;
  type: string;
  lines: string[];
}

/** GET /api/suburbs/[suburbKey] */
interface SuburbDetail {
  suburb: Suburb;
  suburb_names: string[];
  low_sample: boolean;
  nearby_stations: StationInfo[];
  nearest_station: StationInfo | null;
  sydney_medians: Record<string, number | null | undefined>;
}

type DetailState =
  | { status: "loading" }
  | { status: "ok"; data: SuburbDetail }
  | { status: "not_found" }
  | { status: "error" };

/** GET /api/amenities?postcode= ; `amenities: null` means no data, not zero. */
type AmenityState =
  | { hasData: false }
  | {
      hasData: true;
      score: number | null;
      hospitals: PlaceItem[];
      schools: PlaceItem[];
      universities: PlaceItem[];
      childcare: PlaceItem[];
      fireStations: PlaceItem[];
      police: PlaceItem[];
    };

/** The categories of GET /api/overpass-poi shown on this page. */
interface PointsOfInterest {
  supermarkets: PlaceItem[];
  parks: PlaceItem[];
  gyms: PlaceItem[];
  libraries: PlaceItem[];
  pharmacies: PlaceItem[];
  medical_clinics: PlaceItem[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** `median` is the key in `sydney_medians`; there is no Sydney-wide 5+ figure. */
const BEDROOMS = [
  { label: "1 Bed", rent: "median_rent_1bed", stress: "rent_stress_pct_1bed", median: "1bed" },
  { label: "2 Bed", rent: "median_rent_2bed", stress: "rent_stress_pct_2bed", median: "2bed" },
  { label: "3 Bed", rent: "median_rent_3bed", stress: "rent_stress_pct_3bed", median: "3bed" },
  { label: "4 Bed", rent: "median_rent_4bed", stress: "rent_stress_pct_4bed", median: "4bed" },
  { label: "5+ Bed", rent: "median_rent_5+bed", stress: null, median: null },
] as const;

const POI_RADIUS_M = 3000;
const STATION_RADIUS_KM = 2;
const MAX_OTHER_SUBURBS = 4;
const MAX_WORKPLACE_NAME_LENGTH = 80;

const PAGE_BG = "bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30";
const CARD = "animate-slide-up rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm";
const CARD_TITLE = "mb-4 flex items-center gap-2 text-sm font-semibold text-primary";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Throws on a non-OK status and on a body that is not JSON. */
async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

function toStation(value: unknown): StationInfo | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  if (typeof value.distance_km !== "number") return null;
  return {
    name: value.name,
    distance_km: value.distance_km,
    type: typeof value.type === "string" ? value.type : "",
    lines: Array.isArray(value.lines)
      ? value.lines.filter((l): l is string => typeof l === "string")
      : [],
  };
}

function parseDetail(body: unknown): SuburbDetail | null {
  if (!isRecord(body) || !isRecord(body.suburb)) return null;
  const suburb = body.suburb;
  if (typeof suburb.suburb_key !== "string" || typeof suburb.postcode !== "string") {
    return null;
  }

  return {
    suburb: suburb as unknown as Suburb,
    suburb_names: Array.isArray(body.suburb_names)
      ? body.suburb_names.filter((n): n is string => typeof n === "string")
      : [],
    low_sample: body.low_sample === true,
    nearby_stations: Array.isArray(body.nearby_stations)
      ? body.nearby_stations.map(toStation).filter((s) => s !== null)
      : [],
    nearest_station: toStation(body.nearest_station),
    sydney_medians: isRecord(body.sydney_medians)
      ? (body.sydney_medians as SuburbDetail["sydney_medians"])
      : {},
  };
}

function parseAmenities(
  body: unknown,
  lat: number | null,
  lng: number | null,
): AmenityState | null {
  if (!isRecord(body) || "error" in body) return null;
  const a = body.amenities;
  if (body.has_data === false || !isRecord(a)) return { hasData: false };

  // Stored distances are from the postcode centroid: re-measure from here so
  // the list order matches the directions each row links to.
  const list = (value: unknown) => measureFrom(toPlaceItems(value), lat, lng);
  return {
    hasData: true,
    score: typeof body.score === "number" ? body.score : null,
    hospitals: list(a.hospitals),
    schools: list(a.schools),
    universities: list(a.universities),
    childcare: list(a.childcare),
    fireStations: list(a.fire_stations),
    police: list(a.police),
  };
}

function parsePointsOfInterest(body: unknown): PointsOfInterest | null {
  if (!isRecord(body) || "error" in body) return null;
  const poi: PointsOfInterest = {
    supermarkets: toPlaceItems(body.supermarkets),
    parks: toPlaceItems(body.parks),
    gyms: toPlaceItems(body.gyms),
    libraries: toPlaceItems(body.libraries),
    pharmacies: toPlaceItems(body.pharmacies),
    medical_clinics: toPlaceItems(body.medical_clinics),
  };
  return Object.values(poi).some((items) => items.length > 0) ? poi : null;
}

/** A URL coordinate: strict parse, rounded to 3 decimals. */
function parseCoordParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? roundCoord(value) : null;
}

/** "A", "A and B", "A, B and C" */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The sentence saying which postcode the figures describe. */
function postcodeScope(postcode: string, otherSuburbs: string[]): string {
  if (otherSuburbs.length === 0) {
    return `Rent figures are for postcode ${postcode} as a whole.`;
  }
  const shown = otherSuburbs.slice(0, MAX_OTHER_SUBURBS);
  const rest = otherSuburbs.length - shown.length;
  const list =
    rest > 0
      ? `${shown.join(", ")} and ${rest} other suburb${rest === 1 ? "" : "s"}`
      : joinNames(shown);
  return `Rent figures are for postcode ${postcode}, which also covers ${list}.`;
}

function stationKind(type: string): string {
  switch (type) {
    case "ferry": return "Ferry wharf";
    case "metro": return "Metro station";
    case "light_rail": return "Light rail stop";
    default: return "Train station";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SuburbDetailPageWrapper() {
  const { suburbKey } = useParams<{ suburbKey: string }>();

  return (
    <Suspense
      fallback={
        <div className={`flex min-h-screen items-center justify-center ${PAGE_BG}`}>
          <span className="h-10 w-10 animate-spin rounded-full border-3 border-slate-200 border-t-primary" />
        </div>
      }
    >
      {/* Keyed so moving between suburbs starts from a clean loading state */}
      <SuburbDetailLoader key={suburbKey} suburbKey={suburbKey} />
    </Suspense>
  );
}

function SuburbDetailLoader({ suburbKey }: { suburbKey: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/suburbs/${encodeURIComponent(suburbKey)}`, { signal: controller.signal })
      .then(async (res): Promise<DetailState> => {
        if (res.status === 404) return { status: "not_found" };
        if (!res.ok) return { status: "error" };
        const data = parseDetail(await res.json());
        return data ? { status: "ok", data } : { status: "error" };
      })
      .catch((): DetailState => ({ status: "error" }))
      .then((next) => {
        if (!controller.signal.aborted) setDetail(next);
      });

    return () => controller.abort();
  }, [suburbKey]);

  if (detail.status === "loading") return <LoadingSkeleton />;

  if (detail.status !== "ok") {
    const notFound = detail.status === "not_found";
    return (
      <div className={`flex min-h-screen flex-col items-center justify-center gap-4 px-6 ${PAGE_BG}`}>
        <div className="animate-fade-in flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle className="h-8 w-8 text-amber-400" aria-hidden="true" />
          </div>
          <p className="text-lg font-semibold text-slate-700">
            {notFound ? "Suburb not found" : "Something went wrong"}
          </p>
          <p className="max-w-sm text-sm text-slate-500">
            {notFound
              ? "We couldn’t find data for this suburb. It may not be in the Greater Sydney area or our dataset."
              : "This suburb’s details couldn’t be loaded. Please try again in a moment."}
          </p>
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-light"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Go back
          </button>
        </div>
      </div>
    );
  }

  return <SuburbDetailView data={detail.data} />;
}

function LoadingSkeleton() {
  return (
    <div className={`min-h-screen ${PAGE_BG}`} role="status" aria-label="Loading suburb">
      <div className="bg-gradient-to-br from-primary-dark via-primary to-primary-light">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <div className="h-4 w-16 rounded bg-white/20" />
          <div className="mt-6 h-8 w-48 animate-pulse-soft rounded bg-white/20" />
          <div className="mt-2 h-4 w-24 animate-pulse-soft rounded bg-white/10" />
        </div>
        <div className="h-[200px] animate-pulse-soft bg-white/5" />
      </div>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm">
              <div className="mb-4 h-4 w-32 animate-pulse-soft rounded bg-slate-200" />
              <div className="space-y-3">
                {[1, 2, 3].map((r) => (
                  <div key={r} className="flex justify-between">
                    <div className="h-4 w-16 animate-pulse-soft rounded bg-slate-100" />
                    <div className="h-4 w-24 animate-pulse-soft rounded bg-slate-200" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function SuburbDetailView({ data }: { data: SuburbDetail }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const s = data.suburb;
  const { postcode, lat, lng } = s;
  const displayName = s.suburb_name ?? `Postcode ${postcode}`;

  // Requests are cached by full URL, so every coordinate sent is rounded
  const fromLat = lat != null ? roundCoord(lat) : null;
  const fromLng = lng != null ? roundCoord(lng) : null;

  // Workplace from the results page link: ?wp_lat=&wp_lng=&wp_name=
  const wpLat = parseCoordParam(searchParams.get("wp_lat"));
  const wpLng = parseCoordParam(searchParams.get("wp_lng"));
  const hasWorkplace = wpLat !== null && wpLng !== null && isInGreaterSydney(wpLat, wpLng);
  const workplaceName =
    searchParams.get("wp_name")?.trim().slice(0, MAX_WORKPLACE_NAME_LENGTH) || null;

  const commute = useCommute(
    hasWorkplace ? fromLat : null,
    hasWorkplace ? fromLng : null,
    hasWorkplace ? wpLat : null,
    hasWorkplace ? wpLng : null,
  );

  // Stored amenity lists for the postcode (null until loaded, or on failure)
  const [amenities, setAmenities] = useState<AmenityState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchJson(`/api/amenities?postcode=${encodeURIComponent(postcode)}`, controller.signal)
      .then((body) => setAmenities(parseAmenities(body, lat, lng)))
      .catch(() => {
        // Section is left out when the lookup fails
      });
    return () => controller.abort();
  }, [postcode, lat, lng]);

  // Live OpenStreetMap lookup (null until loaded; stays null on any error)
  const [poi, setPoi] = useState<PointsOfInterest | null>(null);
  useEffect(() => {
    if (fromLat === null || fromLng === null) return;
    const controller = new AbortController();
    fetchJson(
      `/api/overpass-poi?lat=${fromLat}&lng=${fromLng}&radius=${POI_RADIUS_M}`,
      controller.signal,
    )
      .then((body) => setPoi(parsePointsOfInterest(body)))
      .catch(() => {
        // Section is left out when the lookup fails
      });
    return () => controller.abort();
  }, [fromLat, fromLng]);

  // --- Derived values ---
  const otherSuburbs = data.suburb_names.filter((name) => name !== s.suburb_name);
  const medians = data.sydney_medians;
  const nearbyStations = data.nearby_stations;
  const stations =
    nearbyStations.length > 0
      ? nearbyStations
      : data.nearest_station
        ? [data.nearest_station]
        : [];

  const trendYears = Object.entries(s.rent_trend ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const maxTrendRent = Math.max(0, ...trendYears.map(([, rent]) => rent));
  const firstRent = trendYears.length > 1 ? trendYears[0][1] : null;
  const lastRent = trendYears.length > 1 ? trendYears[trendYears.length - 1][1] : null;
  const rentChange =
    firstRent && lastRent ? Math.round(((lastRent - firstRent) / firstRent) * 100) : null;

  const dwellingTypes = Object.entries(s.dwelling_types ?? {}).sort((a, b) => b[1] - a[1]);

  const route =
    commute.directions && commute.directions.geometry.length > 1
      ? commute.directions.geometry
      : null;

  return (
    <div className={`min-h-screen ${PAGE_BG}`}>
      {/* ---------------------------------------------------------------- */}
      {/* Header + mini map */}
      {/* ---------------------------------------------------------------- */}
      <section className="bg-gradient-to-br from-primary-dark via-primary to-primary-light">
        <div className="mx-auto max-w-5xl px-4 pt-5 pb-0 sm:px-6">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-blue-100/80 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>

          <div className="mt-4 flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold text-white sm:text-4xl">
                {displayName}
              </h1>
              <div className="mt-1 flex items-center gap-2 text-blue-100/80">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                <span className="text-sm">{postcode}</span>
                {lat != null && lng != null && (
                  <span className="text-xs text-blue-200/50">
                    {lat.toFixed(3)}, {lng.toFixed(3)}
                  </span>
                )}
              </div>
            </div>

            {s.median_rent_overall != null && (
              <div className="rounded-xl bg-white/10 px-5 py-3 backdrop-blur-sm">
                <p className="text-xs text-blue-100/70">
                  Median Rent &middot; postcode {postcode}
                </p>
                <p className="text-2xl font-bold text-white">
                  ${s.median_rent_overall}
                  <span className="text-sm font-normal text-blue-100/70">/wk</span>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Mini map */}
        {lat != null && lng != null && s.median_rent_overall != null && (
          <div className="h-[200px] sm:h-[250px]">
            <SuburbMap
              data={data}
              workplaceName={workplaceName}
              workplaceLat={hasWorkplace ? wpLat : null}
              workplaceLng={hasWorkplace ? wpLng : null}
              route={route}
            />
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Content */}
      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* What the figures cover */}
        <div className="mb-6 space-y-3">
          <p className="flex items-start gap-2 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{postcodeScope(postcode, otherSuburbs)}</span>
          </p>
          {data.low_sample && (
            <p
              role="note"
              className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Small sample.</strong> These
                figures are based on only{" "}
                {s.total_bonds.toLocaleString("en-AU")} bond
                {s.total_bonds === 1 ? "" : "s"}, so treat them as indicative.
              </span>
            </p>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ---- Rent by bedrooms ---- */}
          <section className={CARD} style={{ animationDelay: "0ms" }}>
            <div className={CARD_TITLE}>
              <DollarSign className="h-4 w-4" aria-hidden="true" />
              Rent by Bedrooms
              <span className="ml-auto text-xs font-normal text-slate-400">
                postcode {postcode}
              </span>
            </div>
            <div className="space-y-3">
              {BEDROOMS.map(({ label, rent: rentKey, median }) => {
                const rent = s[rentKey];
                const cityMedian = median ? medians[median] : null;

                return (
                  <div key={rentKey} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{label}</span>
                    <div className="flex items-center gap-3">
                      {rent != null ? (
                        <>
                          <span className="text-sm font-bold text-slate-900">
                            ${rent}/wk
                          </span>
                          {typeof cityMedian === "number" && cityMedian > 0 && (
                            <span
                              className={`text-xs font-medium ${
                                rent <= cityMedian ? "text-emerald-600" : "text-red-500"
                              }`}
                            >
                              {rent === cityMedian
                                ? "at"
                                : rent < cityMedian
                                  ? "below"
                                  : "above"}{" "}
                              Sydney median (${cityMedian})
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">No data</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- Rent Stress ---- */}
          <section className={CARD} style={{ animationDelay: "80ms" }}>
            <div className={CARD_TITLE}>
              <Users className="h-4 w-4" aria-hidden="true" />
              Rent Stress (median household income)
            </div>
            {s.median_household_income_weekly != null ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  Area median household income:{" "}
                  <span className="font-semibold text-slate-900">
                    ${s.median_household_income_weekly}/wk
                  </span>
                </p>
                {BEDROOMS.map(({ label, stress }) => {
                  if (!stress) return null;
                  const pct = s[stress];
                  const band = pct != null ? stressBand(pct) : null;
                  const colour = band?.text ?? "text-slate-400";
                  return (
                    <div key={stress} className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${colour}`}>
                          {pct != null ? `${pct}%` : "N/A"}
                        </span>
                        {band && (
                          <span className={`text-xs ${colour}`}>{band.label}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No income data available for this area.</p>
            )}
          </section>

          {/* ---- Rent trend ---- */}
          {trendYears.length > 1 && (
            <section className={CARD} style={{ animationDelay: "160ms" }}>
              <div className={CARD_TITLE}>
                <TrendingUp className="h-4 w-4" aria-hidden="true" />
                Rent Trend
                {rentChange != null && (
                  <span
                    className={`ml-auto text-xs font-medium ${
                      rentChange > 0 ? "text-red-500" : "text-emerald-600"
                    }`}
                  >
                    {rentChange > 0 ? "+" : ""}
                    {rentChange}% since {trendYears[0][0]}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {trendYears.map(([year, rent]) => (
                  <div key={year} className="flex items-center gap-3">
                    <span className="w-10 shrink-0 text-xs text-slate-400">{year}</span>
                    <div className="h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
                        style={{ width: `${maxTrendRent > 0 ? (rent / maxTrendRent) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-sm font-semibold text-slate-700">
                      ${rent}/wk
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ---- Dwelling types ---- */}
          {dwellingTypes.length > 0 && (
            <section className={CARD} style={{ animationDelay: "240ms" }}>
              <div className={CARD_TITLE}>
                <Building2 className="h-4 w-4" aria-hidden="true" />
                Dwelling Mix
              </div>
              <div className="space-y-2">
                {dwellingTypes.map(([type, pct]) => (
                  <div key={type} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-sm text-slate-600">
                      {type}
                    </span>
                    <div className="h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-accent/80"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right text-sm font-semibold text-slate-700">
                      {pct}%
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ---- Stations ---- */}
          {stations.length > 0 && (
            <section className={CARD} style={{ animationDelay: "320ms" }}>
              <div className={CARD_TITLE}>
                <Train className="h-4 w-4" aria-hidden="true" />
                {nearbyStations.length > 0 ? "Nearby Stations" : "Nearest Station"}
                <span className="ml-auto text-xs font-normal text-slate-400">
                  {nearbyStations.length > 0
                    ? `${nearbyStations.length} within ${STATION_RADIUS_KM} km`
                    : `None within ${STATION_RADIUS_KM} km`}
                </span>
              </div>
              <div className="space-y-4">
                {stations.map((station) => (
                  <div key={`${station.type}-${station.name}`} className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50">
                      <Train className="h-5 w-5 text-purple-600" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-900">{station.name}</p>
                      <p className="text-sm text-slate-500">
                        {station.distance_km} km away &middot; {stationKind(station.type)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {station.lines.map((line) => (
                          <span
                            key={line}
                            className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700"
                          >
                            {line}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ---- Supply ---- */}
          <section className={CARD} style={{ animationDelay: "400ms" }}>
            <div className={CARD_TITLE}>
              <Home className="h-4 w-4" aria-hidden="true" />
              Rental Supply
            </div>
            <p className="text-3xl font-extrabold text-slate-900">
              {s.total_bonds.toLocaleString("en-AU")}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Rental bonds lodged in postcode {postcode} (2021–2025)
            </p>
          </section>
        </div>

        {/* -------------------------------------------------------------- */}
        {/* What's Nearby */}
        {/* -------------------------------------------------------------- */}
        {amenities && (
          <div className="mt-10 animate-slide-up" style={{ animationDelay: "480ms" }}>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold text-primary">
                What&apos;s Nearby in {displayName}
              </h2>
              {amenities.hasData && amenities.score != null && (
                <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                  Amenity Score: {amenities.score}/100
                </span>
              )}
            </div>

            {amenities.hasData ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <PlaceCard
                  icon={<Hospital className="h-5 w-5" aria-hidden="true" />}
                  title="Hospitals & Medical"
                  items={amenities.hospitals}
                  suburbLat={lat}
                  suburbLng={lng}
                />
                <PlaceCard
                  icon={<School className="h-5 w-5" aria-hidden="true" />}
                  title="Schools"
                  items={amenities.schools}
                  suburbLat={lat}
                  suburbLng={lng}
                />
                <PlaceCard
                  icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
                  title="Universities"
                  items={amenities.universities}
                  suburbLat={lat}
                  suburbLng={lng}
                />
                <PlaceCard
                  icon={<Baby className="h-5 w-5" aria-hidden="true" />}
                  title="Childcare & Early Learning"
                  items={amenities.childcare}
                  suburbLat={lat}
                  suburbLng={lng}
                />
                <EmergencyServicesCard
                  fireStations={amenities.fireStations}
                  police={amenities.police}
                  suburbLat={lat}
                  suburbLng={lng}
                />
              </div>
            ) : (
              <p className="rounded-xl border border-slate-200/80 bg-white p-6 text-sm text-slate-500 shadow-sm">
                Amenity data isn&apos;t available for this postcode.
              </p>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------- */}
        {/* Commute */}
        {/* -------------------------------------------------------------- */}
        {hasWorkplace && fromLat !== null && fromLng !== null && (
          <CommuteSection workplaceName={workplaceName} lookup={commute} />
        )}

        {/* -------------------------------------------------------------- */}
        {/* Points of Interest (OpenStreetMap via Overpass) */}
        {/* -------------------------------------------------------------- */}
        {poi && (
          <div className="mt-10 animate-slide-up" style={{ animationDelay: "640ms" }}>
            <h2 className="mb-6 text-xl font-bold text-primary">
              Points of Interest
            </h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <PlaceCard
                icon={<ShoppingCart className="h-5 w-5" aria-hidden="true" />}
                title="Supermarkets"
                items={poi.supermarkets}
                suburbLat={lat}
                suburbLng={lng}
              />
              <PlaceCard
                icon={<TreePine className="h-5 w-5" aria-hidden="true" />}
                title="Parks"
                items={poi.parks}
                suburbLat={lat}
                suburbLng={lng}
              />
              <PlaceCard
                icon={<Dumbbell className="h-5 w-5" aria-hidden="true" />}
                title="Gyms & Fitness"
                items={poi.gyms}
                suburbLat={lat}
                suburbLng={lng}
              />
              <PlaceCard
                icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
                title="Libraries"
                items={poi.libraries}
                suburbLat={lat}
                suburbLng={lng}
              />
              <PlaceCard
                icon={<Pill className="h-5 w-5" aria-hidden="true" />}
                title="Pharmacies"
                items={poi.pharmacies}
                suburbLat={lat}
                suburbLng={lng}
              />
              <PlaceCard
                icon={<Stethoscope className="h-5 w-5" aria-hidden="true" />}
                title="Medical Clinics"
                items={poi.medical_clinics}
                suburbLat={lat}
                suburbLng={lng}
              />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Within {POI_RADIUS_M / 1000} km. Map data &copy;{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-primary"
              >
                OpenStreetMap
              </a>{" "}
              contributors.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini map: the suburb, plus the workplace and routed drive when known
// ---------------------------------------------------------------------------

function SuburbMap({
  data,
  workplaceName,
  workplaceLat,
  workplaceLng,
  route,
}: {
  data: SuburbDetail;
  workplaceName: string | null;
  workplaceLat: number | null;
  workplaceLng: number | null;
  route: [number, number][] | null;
}) {
  // Stable identities, so the map only re-fits when something really changed
  const points = useMemo<MapPoint[]>(() => {
    const s = data.suburb;
    if (s.lat == null || s.lng == null || s.median_rent_overall == null) return [];
    return [
      {
        key: s.suburb_key,
        postcode: s.postcode,
        name: s.suburb_name ?? `Postcode ${s.postcode}`,
        names: data.suburb_names.filter((name) => name !== s.suburb_name),
        lat: s.lat,
        lng: s.lng,
        rent: s.median_rent_overall,
        bonds: s.total_bonds,
        lowSample: data.low_sample,
        rent1bed: s.median_rent_1bed,
        rent2bed: s.median_rent_2bed,
        rent3bed: s.median_rent_3bed,
        medianIncome: s.median_household_income_weekly,
        dwellingTypes: s.dwelling_types,
      },
    ];
  }, [data]);

  const key = data.suburb.suburb_key;
  const highlighted = useMemo(() => new Set([key]), [key]);

  const workplace = useMemo(
    () =>
      workplaceLat != null && workplaceLng != null
        ? { name: workplaceName ?? "Workplace", lat: workplaceLat, lng: workplaceLng }
        : null,
    [workplaceName, workplaceLat, workplaceLng],
  );

  return (
    <MapWrapper
      points={points}
      highlighted={highlighted}
      selectedKey={key}
      workplace={workplace}
      route={route}
    />
  );
}
