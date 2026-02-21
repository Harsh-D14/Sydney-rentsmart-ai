"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
  Hospital,
  GraduationCap,
  School,
  Flame,
  Shield,
  Baby,
  ChevronDown,
  ExternalLink,
  Car,
  Clock,
  Navigation,
  ShoppingCart,
  TreePine,
  Dumbbell,
  BookOpen,
  Pill,
  Stethoscope,
} from "lucide-react";
import MapWrapper from "@/components/MapWrapper";
import type { Suburb } from "@/lib/suburbs";
import type { SuburbAmenities, AmenityItem } from "@/lib/amenities";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StationInfo {
  name: string;
  distance_km: number;
  type: string;
  lines: string[];
}

interface SuburbDetail {
  suburb: Suburb;
  nearest_station: StationInfo | null;
  nearby_stations?: StationInfo[];
  sydney_medians: Record<string, number>;
}

interface CommuteData {
  transit: { duration_min: number; transfers: number; modes: string[]; summary: string } | null;
  driving: { duration_min: number; distance_km: number; traffic_note: string } | null;
  straight_line_km: number;
}

interface DirectionsData {
  duration_minutes: number;
  distance_km: number;
  geometry: [number, number][];
}

interface OverpassPoi {
  name: string;
  distance_km: number;
  lat: number;
  lng: number;
}

interface OverpassAmenities {
  hospitals: OverpassPoi[];
  schools: OverpassPoi[];
  universities: OverpassPoi[];
  fire_stations: OverpassPoi[];
  pharmacies: OverpassPoi[];
  medical_clinics: OverpassPoi[];
  childcare: OverpassPoi[];
  supermarkets: OverpassPoi[];
  parks: OverpassPoi[];
  gyms: OverpassPoi[];
  libraries: OverpassPoi[];
  train_stations: OverpassPoi[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BEDROOM_KEYS = [
  { key: "median_rent_1bed", label: "1 Bed" },
  { key: "median_rent_2bed", label: "2 Bed" },
  { key: "median_rent_3bed", label: "3 Bed" },
  { key: "median_rent_4bed", label: "4 Bed" },
  { key: "median_rent_5+bed", label: "5+ Bed" },
] as const;

function stressColor(pct: number | null): string {
  if (pct == null) return "text-slate-400";
  if (pct < 25) return "text-emerald-600";
  if (pct <= 30) return "text-amber-600";
  if (pct <= 40) return "text-orange-600";
  return "text-red-600";
}

function stressLabel(pct: number | null): string {
  if (pct == null) return "N/A";
  if (pct < 25) return "Comfortable";
  if (pct <= 30) return "Manageable";
  if (pct <= 40) return "Stressed";
  return "Severe";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SuburbDetailPageWrapper() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30">
        <span className="h-10 w-10 animate-spin rounded-full border-3 border-slate-200 border-t-primary" />
      </div>
    }>
      <SuburbDetailPage />
    </Suspense>
  );
}

function SuburbDetailPage() {
  const { suburbKey } = useParams<{ suburbKey: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<SuburbDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [amenities, setAmenities] = useState<SuburbAmenities | null>(null);
  const [amenityScore, setAmenityScore] = useState<number | null>(null);
  const [overpassPoi, setOverpassPoi] = useState<OverpassAmenities | null>(null);
  const [commuteData, setCommuteData] = useState<CommuteData | null>(null);
  const [directionsData, setDirectionsData] = useState<DirectionsData | null>(null);
  const [commuteLoading, setCommuteLoading] = useState(false);

  // Workplace coordinates from URL params (passed from results page)
  const wpLat = parseFloat(searchParams.get("wp_lat") ?? "");
  const wpLng = parseFloat(searchParams.get("wp_lng") ?? "");
  const hasWorkplace = !isNaN(wpLat) && !isNaN(wpLng);

  // Extract postcode from suburbKey (e.g. "Parramatta_2150" → "2150")
  const postcode = suburbKey?.includes("_")
    ? suburbKey.split("_").pop() ?? suburbKey
    : suburbKey;

  // Fetch suburb data + legacy amenities
  useEffect(() => {
    fetch(`/api/suburbs/${suburbKey}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((d) => setData(d))
      .catch(() => setError(`Suburb "${suburbKey}" not found.`))
      .finally(() => setLoading(false));

    fetch(`/api/amenities?postcode=${postcode}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.amenities) setAmenities(d.amenities);
        if (d.score != null) setAmenityScore(d.score);
      })
      .catch(() => {});
  }, [suburbKey, postcode]);

  // Fetch Overpass POI (supermarkets, parks, gyms, libraries, pharmacies, etc.)
  useEffect(() => {
    if (!data?.suburb?.lat || !data?.suburb?.lng) return;
    const { lat, lng } = data.suburb;

    fetch("/api/overpass-poi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, radius: 3000 }),
    })
      .then((r) => r.json())
      .then((d) => { if (!d.error) setOverpassPoi(d); })
      .catch(() => {});
  }, [data?.suburb?.lat, data?.suburb?.lng]);

  // Fetch commute + directions when workplace is known
  useEffect(() => {
    if (!hasWorkplace || !data?.suburb?.lat || !data?.suburb?.lng) return;
    const { lat, lng } = data.suburb;
    setCommuteLoading(true);

    // Parallel: commute times + ORS directions (for route geometry)
    Promise.allSettled([
      fetch(`/api/commute?from_lat=${lat}&from_lng=${lng}&to_lat=${wpLat}&to_lng=${wpLng}`)
        .then((r) => r.json()),
      fetch(`/api/directions?from_lat=${lat}&from_lng=${lng}&to_lat=${wpLat}&to_lng=${wpLng}&mode=driving`)
        .then((r) => r.json()),
    ]).then(([commuteResult, directionsResult]) => {
      if (commuteResult.status === "fulfilled" && !commuteResult.value.error) {
        setCommuteData(commuteResult.value as CommuteData);
      }
      if (directionsResult.status === "fulfilled" && !directionsResult.value.error) {
        setDirectionsData(directionsResult.value as DirectionsData);
      }
      setCommuteLoading(false);
    });
  }, [hasWorkplace, wpLat, wpLng, data?.suburb?.lat, data?.suburb?.lng]);

  const mapSuburbs = useMemo<Suburb[]>(() => {
    if (!data?.suburb?.lat || !data?.suburb?.lng) return [];
    return [data.suburb];
  }, [data]);

  // --- Loading skeleton ---
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30">
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

  // --- Error ---
  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30 px-6">
        <div className="animate-fade-in flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle className="h-8 w-8 text-amber-400" />
          </div>
          <p className="text-lg font-semibold text-slate-700">
            {error || "Something went wrong"}
          </p>
          <p className="max-w-sm text-sm text-slate-500">
            We couldn&apos;t find data for this suburb. It may not be in the
            Greater Sydney area or our dataset.
          </p>
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-light"
          >
            <ArrowLeft className="h-4 w-4" />
            Go back
          </button>
        </div>
      </div>
    );
  }

  const s = data.suburb;
  const nearbyStations = data.nearby_stations ?? (data.nearest_station ? [data.nearest_station] : []);
  const medians = data.sydney_medians;

  const trendYears = Object.entries(s.rent_trend).sort(([a], [b]) => a.localeCompare(b));
  const firstRent = trendYears.length > 1 ? trendYears[0][1] : null;
  const lastRent = trendYears.length > 1 ? trendYears[trendYears.length - 1][1] : null;
  const rentChange =
    firstRent && lastRent ? Math.round(((lastRent - firstRent) / firstRent) * 100) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30">
      {/* ---------------------------------------------------------------- */}
      {/* Header + mini map */}
      {/* ---------------------------------------------------------------- */}
      <section className="bg-gradient-to-br from-primary-dark via-primary to-primary-light">
        <div className="mx-auto max-w-5xl px-4 pt-5 pb-0 sm:px-6">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-blue-100/80 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="mt-4 flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold text-white sm:text-4xl">
                {s.suburb_name ?? `Postcode ${s.postcode}`}
              </h1>
              <div className="mt-1 flex items-center gap-2 text-blue-100/80">
                <MapPin className="h-4 w-4" />
                <span className="text-sm">{s.postcode}</span>
                {s.lat && s.lng && (
                  <span className="text-xs text-blue-200/50">
                    {s.lat.toFixed(3)}, {s.lng.toFixed(3)}
                  </span>
                )}
              </div>
            </div>

            {s.median_rent_overall != null && (
              <div className="rounded-xl bg-white/10 px-5 py-3 backdrop-blur-sm">
                <p className="text-xs text-blue-100/70">Median Rent</p>
                <p className="text-2xl font-bold text-white">
                  ${s.median_rent_overall}
                  <span className="text-sm font-normal text-blue-100/70">/wk</span>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Mini map */}
        {mapSuburbs.length > 0 && (
          <div className="h-[200px] sm:h-[250px]">
            <MapWrapper suburbs={mapSuburbs} highlighted={new Set([s.suburb_key])} selectedSuburbKey={s.suburb_key} />
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Content */}
      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ---- Rent by bedrooms ---- */}
          <section className="animate-slide-up rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm" style={{ animationDelay: "0ms" }}>
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-primary">
              <DollarSign className="h-4 w-4" />
              Rent by Bedrooms
            </div>
            <div className="space-y-3">
              {BEDROOM_KEYS.map(({ key, label }) => {
                const rent = s[key as keyof Suburb] as number | null;
                const medianKey = key.replace("median_rent_", "");
                const cityMedian = medians[medianKey] ?? null;

                return (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{label}</span>
                    <div className="flex items-center gap-3">
                      {rent != null ? (
                        <>
                          <span className="text-sm font-bold text-slate-900">
                            ${rent}/wk
                          </span>
                          {cityMedian != null && (
                            <span
                              className={`text-xs font-medium ${
                                rent <= cityMedian ? "text-emerald-600" : "text-red-500"
                              }`}
                            >
                              {rent <= cityMedian ? "below" : "above"} Sydney median (${cityMedian})
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-slate-300">No data</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- Rent Stress ---- */}
          <section className="animate-slide-up rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm" style={{ animationDelay: "80ms" }}>
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-primary">
              <Users className="h-4 w-4" />
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
                {BEDROOM_KEYS.slice(0, 4).map(({ key, label }) => {
                  const stressKey = key.replace("median_rent_", "rent_stress_pct_");
                  const pct = s[stressKey as keyof Suburb] as number | null;
                  return (
                    <div key={stressKey} className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${stressColor(pct)}`}>
                          {pct != null ? `${pct}%` : "N/A"}
                        </span>
                        <span className={`text-xs ${stressColor(pct)}`}>
                          {stressLabel(pct)}
                        </span>
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
            <section className="animate-slide-up rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm" style={{ animationDelay: "160ms" }}>
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-primary">
                <TrendingUp className="h-4 w-4" />
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
                {trendYears.map(([year, rent]) => {
                  const maxRent = Math.max(...trendYears.map(([, r]) => r));
                  const pct = maxRent > 0 ? (rent / maxRent) * 100 : 0;
                  return (
                    <div key={year} className="flex items-center gap-3">
                      <span className="w-10 shrink-0 text-xs text-slate-400">{year}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-sm font-semibold text-slate-700">
                        ${rent}/wk
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ---- Dwelling types ---- */}
          {Object.keys(s.dwelling_types).length > 0 && (
            <section className="animate-slide-up rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm" style={{ animationDelay: "240ms" }}>
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-primary">
                <Building2 className="h-4 w-4" />
                Dwelling Mix
              </div>
              <div className="space-y-2">
                {Object.entries(s.dwelling_types)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, pct]) => (
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

          {/* ---- Nearby Stations ---- */}
          {nearbyStations.length > 0 && (
            <section className="animate-slide-up rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm" style={{ animationDelay: "320ms" }}>
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-primary">
                <Train className="h-4 w-4" />
                Nearby Stations
                <span className="ml-auto text-xs font-normal text-slate-400">{nearbyStations.length} within 0.5 km</span>
              </div>
              <div className="space-y-4">
                {nearbyStations.map((station) => (
                  <div key={station.name} className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50">
                      <Train className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-900">{station.name}</p>
                      <p className="text-sm text-slate-500">
                        {station.distance_km} km away &middot;{" "}
                        {station.type === "ferry" ? "Ferry wharf" : station.type === "metro" ? "Metro station" : station.type === "light_rail" ? "Light rail stop" : "Train station"}
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
          <section className="animate-slide-up rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm" style={{ animationDelay: "400ms" }}>
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-primary">
              <Home className="h-4 w-4" />
              Rental Supply
            </div>
            <p className="text-3xl font-extrabold text-slate-900">
              {s.total_bonds.toLocaleString("en-AU")}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Total rental bonds lodged (2021–2025)
            </p>
          </section>
        </div>

        {/* -------------------------------------------------------------- */}
        {/* What's Nearby */}
        {/* -------------------------------------------------------------- */}
        {amenities && (
          <div className="mt-10 animate-slide-up" style={{ animationDelay: "480ms" }}>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-primary">
                What&apos;s Nearby in {s.suburb_name ?? postcode}
              </h2>
              {amenityScore != null && (
                <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                  Amenity Score: {amenityScore}/100
                </span>
              )}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <AmenityCard
                icon={<Hospital className="h-5 w-5" />}
                title="Hospitals & Medical"
                items={amenities.hospitals}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
              <AmenityCard
                icon={<School className="h-5 w-5" />}
                title="Schools"
                items={amenities.schools}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
              <AmenityCard
                icon={<GraduationCap className="h-5 w-5" />}
                title="Universities"
                items={amenities.universities}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
              <AmenityCard
                icon={<Baby className="h-5 w-5" />}
                title="Childcare & Early Learning"
                items={amenities.childcare}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
              <EmergencyServicesCard
                fireStations={amenities.fire_stations}
                police={amenities.police}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------- */}
        {/* Commute to Workplace */}
        {/* -------------------------------------------------------------- */}
        {hasWorkplace && (
          <div className="mt-10 animate-slide-up" style={{ animationDelay: "560ms" }}>
            <h2 className="mb-6 text-xl font-bold text-primary">
              Commute to Workplace
            </h2>
            {commuteLoading ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-primary" />
                <span className="text-sm text-slate-500">Calculating route...</span>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Driving */}
                {(commuteData?.driving || directionsData) && (
                  <section className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                      <Car className="h-4 w-4" />
                      Driving
                    </div>
                    <p className="text-2xl font-extrabold text-slate-900">
                      {directionsData?.duration_minutes ?? commuteData?.driving?.duration_min ?? "—"} min
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {directionsData?.distance_km ?? commuteData?.driving?.distance_km ?? "—"} km
                      {commuteData?.driving?.traffic_note && (
                        <span className="text-xs text-slate-400"> · {commuteData.driving.traffic_note}</span>
                      )}
                    </p>
                  </section>
                )}

                {/* Transit */}
                {commuteData?.transit && (
                  <section className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                      <Train className="h-4 w-4" />
                      Public Transport
                    </div>
                    <p className="text-2xl font-extrabold text-slate-900">
                      {commuteData.transit.duration_min} min
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {commuteData.transit.summary}
                    </p>
                    {commuteData.transit.transfers > 0 && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {commuteData.transit.transfers} transfer{commuteData.transit.transfers > 1 ? "s" : ""}
                      </p>
                    )}
                  </section>
                )}

                {/* Straight line distance */}
                {commuteData?.straight_line_km != null && (
                  <section className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                      <Navigation className="h-4 w-4" />
                      Distance
                    </div>
                    <p className="text-2xl font-extrabold text-slate-900">
                      {commuteData.straight_line_km} km
                    </p>
                    <p className="mt-1 text-sm text-slate-500">straight line</p>
                  </section>
                )}
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------- */}
        {/* Points of Interest (Overpass) */}
        {/* -------------------------------------------------------------- */}
        {overpassPoi && (
          <div className="mt-10 animate-slide-up" style={{ animationDelay: "640ms" }}>
            <h2 className="mb-6 text-xl font-bold text-primary">
              Points of Interest
            </h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <AmenityCard
                icon={<ShoppingCart className="h-5 w-5" />}
                title="Supermarkets"
                items={overpassPoi.supermarkets}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
              <AmenityCard
                icon={<TreePine className="h-5 w-5" />}
                title="Parks"
                items={overpassPoi.parks}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
              <AmenityCard
                icon={<Dumbbell className="h-5 w-5" />}
                title="Gyms & Fitness"
                items={overpassPoi.gyms}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
              <AmenityCard
                icon={<BookOpen className="h-5 w-5" />}
                title="Libraries"
                items={overpassPoi.libraries}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
              <AmenityCard
                icon={<Pill className="h-5 w-5" />}
                title="Pharmacies"
                items={overpassPoi.pharmacies}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
              <AmenityCard
                icon={<Stethoscope className="h-5 w-5" />}
                title="Medical Clinics"
                items={overpassPoi.medical_clinics}
                suburbLat={s.lat}
                suburbLng={s.lng}
              />
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Amenity sub-components
// ---------------------------------------------------------------------------

function mapsDirectionUrl(
  fromLat: number | null,
  fromLng: number | null,
  toLat: number,
  toLng: number,
): string {
  if (fromLat != null && fromLng != null) {
    return `https://www.google.com/maps/dir/${fromLat},${fromLng}/${toLat},${toLng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${toLat},${toLng}`;
}

function AmenityRow({
  item,
  suburbLat,
  suburbLng,
  icon,
}: {
  item: AmenityItem;
  suburbLat: number | null;
  suburbLng: number | null;
  icon?: React.ReactNode;
}) {
  return (
    <a
      href={mapsDirectionUrl(suburbLat, suburbLng, item.lat, item.lng)}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-blue-50/60"
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
        <span className="truncate text-sm text-slate-700 group-hover:text-primary">
          {item.name}
        </span>
        <ExternalLink className="hidden h-3 w-3 shrink-0 text-slate-300 group-hover:block" />
      </div>
      <span className="shrink-0 text-xs font-medium text-slate-400">
        {item.distance_km} km
      </span>
    </a>
  );
}

function AmenityCard({
  icon,
  title,
  items,
  suburbLat,
  suburbLng,
}: {
  icon: React.ReactNode;
  title: string;
  items: AmenityItem[];
  suburbLat: number | null;
  suburbLng: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const INITIAL_COUNT = 5;
  const hasMore = items.length > INITIAL_COUNT;
  const visible = expanded ? items : items.slice(0, INITIAL_COUNT);

  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <span className="text-primary">{icon}</span>
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        <span className="ml-auto text-xs text-slate-400">{items.length} nearby</span>
      </div>
      <div className="divide-y divide-slate-50 px-1 py-1">
        {visible.map((item, i) => (
          <AmenityRow
            key={`${item.name}-${i}`}
            item={item}
            suburbLat={suburbLat}
            suburbLng={suburbLng}
          />
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-2.5 text-xs font-medium text-primary hover:bg-blue-50/40"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

function EmergencyServicesCard({
  fireStations,
  police,
  suburbLat,
  suburbLng,
}: {
  fireStations: AmenityItem[];
  police: AmenityItem[];
  suburbLat: number | null;
  suburbLng: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const combined = [
    ...fireStations.slice(0, 5).map((f) => ({ ...f, kind: "fire" as const })),
    ...police.slice(0, 5).map((p) => ({ ...p, kind: "police" as const })),
  ].sort((a, b) => a.distance_km - b.distance_km);

  const INITIAL_COUNT = 5;
  const hasMore = combined.length > INITIAL_COUNT;
  const visible = expanded ? combined : combined.slice(0, INITIAL_COUNT);

  if (combined.length === 0) return null;

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Shield className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-semibold text-primary">Emergency Services</h3>
        <span className="ml-auto text-xs text-slate-400">{combined.length} nearby</span>
      </div>
      <div className="divide-y divide-slate-50 px-1 py-1">
        {visible.map((item, i) => (
          <AmenityRow
            key={`${item.name}-${i}`}
            item={item}
            suburbLat={suburbLat}
            suburbLng={suburbLng}
            icon={
              item.kind === "fire" ? (
                <Flame className="h-3.5 w-3.5 text-red-400" />
              ) : (
                <Shield className="h-3.5 w-3.5 text-blue-400" />
              )
            }
          />
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-2.5 text-xs font-medium text-primary hover:bg-blue-50/40"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Show less" : `Show all ${combined.length}`}
        </button>
      )}
    </section>
  );
}
