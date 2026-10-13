"use client";

import { Suspense, useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Home,
  DollarSign,
  Wallet,
  AlertTriangle,
  Map,
  Train,
  Clock,
  Trophy,
  GraduationCap,
  Heart,
  Baby,
  School,
  Users,
  Flame,
  SlidersHorizontal,
  ChevronDown,
  X,
} from "lucide-react";
import MapWrapper, { type MapPoint } from "@/components/MapWrapper";
import { roundCoord } from "@/lib/route-params";
import AreaCard from "./AreaCard";
import { COMMUTE_TOP_N, useCommutes, type CommuteTarget } from "./useCommutes";
import {
  DEFAULT_FILTERS,
  SORT_MODES,
  WELL_UNDER_BUDGET_PCT,
  commuteFor,
  overallScore,
  type AreaEnriched,
  type FacilityFilters,
  type RecommendResponse,
  type SearchMode,
  type SortMode,
  type WorkplacePoint,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BEDROOM_LABELS: Record<string, string> = {
  "1": "1-bedroom",
  "2": "2-bedroom",
  "3": "3-bedroom",
  "4": "4-bedroom",
};

/** How far from the workplace each sort looks (km). null = all of Sydney. */
const SORT_RADIUS_KM: Record<SortMode, number | null> = {
  best_overall: 25,
  shortest_commute: 20,
  best_affordability: 40,
  lowest_rent: null,
};

interface SortOption {
  value: SortMode;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  needsWorkplace?: boolean;
  description: (workplace: string | null, isIncome: boolean) => string;
}

const SORT_OPTIONS: SortOption[] = [
  {
    value: "best_overall",
    label: "Best Overall",
    shortLabel: "Overall",
    icon: <Trophy className="h-3.5 w-3.5" />,
    description: (wp, isIncome) => {
      const first = isIncome ? "rental stress" : "rent against your budget";
      return wp
        ? `Balanced score of ${first}, drive time, amenities & supply`
        : `Balanced score of ${first}, amenities & supply`;
    },
  },
  {
    value: "shortest_commute",
    label: "Shortest Commute",
    shortLabel: "Commute",
    icon: <Clock className="h-3.5 w-3.5" />,
    needsWorkplace: true,
    description: (wp) => `Sorted by shortest drive to ${wp ?? "your workplace"}`,
  },
  {
    value: "best_affordability",
    label: "Best Affordability",
    shortLabel: "Affordable",
    icon: <Wallet className="h-3.5 w-3.5" />,
    description: (wp, isIncome) =>
      isIncome
        ? wp ? "Lowest rental stress within 40 km, nearest first" : "Sorted by lowest rental stress across Sydney"
        : wp ? "Furthest under budget within 40 km, nearest first" : "Sorted by lowest rent relative to your budget",
  },
  {
    value: "lowest_rent",
    label: "Lowest Rent",
    shortLabel: "Cheapest",
    icon: <DollarSign className="h-3.5 w-3.5" />,
    description: () => "All matching Sydney areas sorted by cheapest weekly rent",
  },
];

const FACILITY_FILTER_OPTIONS: { key: keyof FacilityFilters; label: string; icon: React.ReactNode }[] = [
  { key: "hospital", label: "Hospital", icon: <Heart className="h-3.5 w-3.5" /> },
  { key: "school", label: "School", icon: <School className="h-3.5 w-3.5" /> },
  { key: "university", label: "Uni", icon: <GraduationCap className="h-3.5 w-3.5" /> },
  { key: "train", label: "Train", icon: <Train className="h-3.5 w-3.5" /> },
  { key: "fireStation", label: "Fire Stn", icon: <Flame className="h-3.5 w-3.5" /> },
  { key: "childcare", label: "Childcare", icon: <Baby className="h-3.5 w-3.5" /> },
];

interface FilterPreset {
  label: string;
  icon: React.ReactNode;
  filters: Partial<FacilityFilters>;
}

const FILTER_PRESETS: FilterPreset[] = [
  { label: "Family Friendly", icon: <Users className="h-3.5 w-3.5" />, filters: { hospital: true, school: true, childcare: true } },
  { label: "Transit Access", icon: <Train className="h-3.5 w-3.5" />, filters: { train: true } },
  { label: "Near Health", icon: <Heart className="h-3.5 w-3.5" />, filters: { hospital: true } },
];

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SavedUiState {
  sortMode: SortMode;
  filters: FacilityFilters;
  selectedKey: string | null;
}

/** Sort, filters and selection survive a trip to a detail page and back. */
function readSavedUiState(stateKey: string): SavedUiState {
  const fallback: SavedUiState = { sortMode: "best_overall", filters: DEFAULT_FILTERS, selectedKey: null };
  try {
    const raw = sessionStorage.getItem(stateKey);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as {
      sortMode?: unknown;
      filters?: Partial<Record<keyof FacilityFilters, unknown>>;
      selectedSuburbKey?: unknown;
    };
    const filters = { ...DEFAULT_FILTERS };
    for (const key of Object.keys(DEFAULT_FILTERS) as (keyof FacilityFilters)[]) {
      filters[key] = saved.filters?.[key] === true;
    }
    return {
      sortMode: SORT_MODES.includes(saved.sortMode as SortMode) ? (saved.sortMode as SortMode) : "best_overall",
      filters,
      selectedKey: typeof saved.selectedSuburbKey === "string" ? saved.selectedSuburbKey : null,
    };
  } catch {
    return fallback; // no sessionStorage (server render, private mode) or bad JSON
  }
}

/** An amenity-based "must have" is on (everything except the train filter). */
function needsAmenityData(f: FacilityFilters): boolean {
  return f.hospital || f.school || f.university || f.fireStation || f.childcare;
}

function passesTrainFilter(area: AreaEnriched, f: FacilityFilters): boolean {
  return !f.train || (area.nearest_station !== null && area.nearest_station.distance_km <= 3);
}

/** Only call with amenity data present. */
function passesAmenityFilters(a: NonNullable<AreaEnriched["amenities"]>, f: FacilityFilters): boolean {
  if (f.hospital && a.hospital_count === 0) return false;
  if (f.school && a.school_count === 0) return false;
  if (f.university && a.university_count === 0) return false;
  if (f.fireStation && a.fire_station_count === 0) return false;
  if (f.childcare && a.childcare_count === 0) return false;
  return true;
}

function compareBySort(sortMode: SortMode, a: AreaEnriched, b: AreaEnriched): number {
  switch (sortMode) {
    case "best_overall":
      return b.overall_score - a.overall_score;
    case "shortest_commute":
      // Same number the card shows: routed minutes, else the estimate
      return (a.commute_min ?? Infinity) - (b.commute_min ?? Infinity);
    case "best_affordability": {
      // Rent share first; within 3 points of each other, nearer wins
      const diff = a.rent_stress_pct - b.rent_stress_pct;
      if (Math.abs(diff) > 3) return diff;
      return (a.distance_to_workplace_km ?? 0) - (b.distance_to_workplace_km ?? 0) || diff;
    }
    case "lowest_rent":
    default:
      return a.median_rent - b.median_rent;
  }
}

function detailHref(suburbKey: string, workplace: WorkplacePoint | null): string {
  if (!workplace) return `/suburb/${suburbKey}`;
  const params = new URLSearchParams({
    wp_lat: String(roundCoord(workplace.lat)),
    wp_lng: String(roundCoord(workplace.lng)),
    wp_name: workplace.name,
  });
  return `/suburb/${suburbKey}?${params}`;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-AU")} ${word}${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResultsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30">
          <div className="flex flex-col items-center gap-3">
            <span className="h-10 w-10 animate-spin rounded-full border-3 border-slate-200 border-t-primary" />
            <p className="text-sm text-slate-500">Loading results...</p>
          </div>
        </div>
      }
    >
      <ResultsContentKeyed />
    </Suspense>
  );
}

/** Reads search params and remounts ResultsContent when they change, ensuring fresh state. */
function ResultsContentKeyed() {
  const searchParams = useSearchParams();
  // Key forces full remount on new search — clears selected area, sort, filters, commutes
  return <ResultsContent key={searchParams.toString()} />;
}

type FetchResult = { data: RecommendResponse; error: "" } | { data: null; error: string };

function ResultsContent() {
  const searchParams = useSearchParams();

  const mode: SearchMode = (searchParams.get("mode") ?? "budget") === "income" ? "income" : "budget";
  const isIncomeMode = mode === "income";
  const originalIncome = Number(searchParams.get("income") ?? 0);
  const incomePeriod = searchParams.get("period") ?? "annual";
  const bedrooms = searchParams.get("bedrooms") ?? "2";
  const workplaceText = (searchParams.get("workplace") ?? "").trim();
  const sharingMode = Math.min(4, Math.max(1, Number(searchParams.get("sharing") ?? 1) || 1));
  const shareBedroom = searchParams.get("share_bedroom") === "1";
  const isSharing = sharingMode > 1;
  // Weekly income (income mode) or maximum weekly rent (budget mode).
  // Prefer the explicit weekly param; fall back to income/52 for old-format URLs.
  const weeklyIncome = Number(searchParams.get("weekly") ?? 0) || Math.round(originalIncome / 52);
  const invalidAmount = !(weeklyIncome > 0);
  const incomeDisplay = originalIncome > 0
    ? `$${originalIncome.toLocaleString("en-AU")}/${incomePeriod === "weekly" ? "wk" : incomePeriod === "fortnightly" ? "fn" : incomePeriod === "monthly" ? "mo" : "yr"}`
    : `$${weeklyIncome.toLocaleString("en-AU")}/wk`;
  const weeklyDisplay = `$${weeklyIncome.toLocaleString("en-AU")}/wk`;
  const bedroomLabel = BEDROOM_LABELS[bedrooms] ?? bedrooms;

  // -------------------------------------------------------------------
  // Fetch recommendations. The response is CDN-cached and the browser
  // keeps it for back-navigation, so there is no client-side copy.
  // Query params go in a fixed order so equal searches share a cache entry.
  // -------------------------------------------------------------------
  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({ income: String(weeklyIncome), mode });
    if (sharingMode > 1) {
      // The server picks the dwelling size from the sharing count
      params.set("sharing", String(sharingMode));
      if (shareBedroom) params.set("share_bedroom", "1");
    } else {
      params.set("bedrooms", bedrooms);
    }
    if (workplaceText) params.set("workplace", workplaceText);
    return `/api/recommend?${params}`;
  }, [weeklyIncome, mode, bedrooms, sharingMode, shareBedroom, workplaceText]);

  const [result, setResult] = useState<FetchResult | null>(null);

  useEffect(() => {
    if (invalidAmount) return;
    const controller = new AbortController();

    fetch(requestUrl, { signal: controller.signal })
      .then(async (resp) => {
        const body: unknown = await resp.json().catch(() => null);
        if (controller.signal.aborted) return;
        const apiError =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "";
        if (!resp.ok || apiError || body === null) {
          setResult({ data: null, error: apiError || "Something went wrong. Please try again." });
        } else {
          setResult({ data: body as RecommendResponse, error: "" });
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResult({ data: null, error: "Network error. Please try again." });
      });

    return () => controller.abort();
  }, [requestUrl, invalidAmount]);

  const data = result?.data ?? null;
  const error = invalidAmount
    ? "Invalid amount. Please go back and try again."
    : result?.error ?? "";
  const loading = !invalidAmount && result === null;

  // -------------------------------------------------------------------
  // UI state (sort, filters, selection), persisted per search
  // -------------------------------------------------------------------
  // The key is tied to the search params so each search starts fresh, but
  // back-navigation within the same search restores sort and selection.
  const stateKey = `rentsmart_ui_${searchParams.toString()}`;
  const [saved] = useState(() => readSavedUiState(stateKey));
  const [sortMode, setSortMode] = useState<SortMode>(saved.sortMode);
  const [facilityFilters, setFacilityFilters] = useState<FacilityFilters>(saved.filters);
  const [selectedKey, setSelectedKey] = useState<string | null>(saved.selectedKey);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const restoredScrollRef = useRef(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(stateKey, JSON.stringify({
        sortMode,
        filters: facilityFilters,
        selectedSuburbKey: selectedKey,
      }));
    } catch { /* quota or unavailable */ }
  }, [stateKey, sortMode, facilityFilters, selectedKey]);

  const activeFilterCount = Object.values(facilityFilters).filter(Boolean).length;
  const anyFilterActive = activeFilterCount > 0;

  const toggleFilter = (key: keyof FacilityFilters) => {
    setFacilityFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const applyPreset = (preset: FilterPreset) => {
    setFacilityFilters({ ...DEFAULT_FILTERS, ...preset.filters });
  };
  const clearFilters = () => setFacilityFilters(DEFAULT_FILTERS);

  const scrollToMapOnMobile = () => {
    // Below the lg breakpoint the map sits under the cards
    if (window.innerWidth < 1024) {
      mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const selectArea = (key: string) => {
    if (key === selectedKey) return;
    setSelectedKey(key);
    scrollToMapOnMobile();
  };
  const toggleArea = (key: string) => {
    if (key === selectedKey) {
      setSelectedKey(null);
    } else {
      setSelectedKey(key);
      scrollToMapOnMobile();
    }
  };

  // -------------------------------------------------------------------
  // Workplace (only when the server resolved it)
  // -------------------------------------------------------------------
  const workplace = useMemo<WorkplacePoint | null>(() => {
    if (!data || data.workplace_lat === null || data.workplace_lng === null) return null;
    return {
      name: data.workplace ?? data.workplace_query ?? "Workplace",
      lat: data.workplace_lat,
      lng: data.workplace_lng,
    };
  }, [data]);
  const hasWorkplace = workplace !== null;
  const workplaceNotFound = !!data?.workplace_query && !data.workplace_resolved;

  // A restored "Shortest Commute" makes no sense without a workplace
  const activeSort: SortMode = sortMode === "shortest_commute" && !hasWorkplace ? "best_overall" : sortMode;
  const radiusKm = hasWorkplace ? SORT_RADIUS_KM[activeSort] : null;

  // -------------------------------------------------------------------
  // Routed commute times known so far, and a way to ask for more (below,
  // once we know which cards are at the top of the list)
  // -------------------------------------------------------------------
  const { snapshot: commutes, request: requestCommutes } = useCommutes();

  // -------------------------------------------------------------------
  // Enrich: one commute number per area, and the overall score built on it
  // -------------------------------------------------------------------
  const enriched = useMemo<AreaEnriched[]>(() => {
    if (!data) return [];
    return data.suburbs.map((s) => {
      const commute = commuteFor(s, commutes.minutes[s.postcode]);
      return {
        ...s,
        commute_min: commute.minutes,
        commute_is_estimate: commute.isEstimate,
        commute_loading: commutes.loading[s.postcode] === true,
        overall_score: overallScore(s, mode, commute.minutes),
      };
    });
  }, [data, mode, commutes]);

  // Within range of the workplace for this sort (before facility filters — used for the map)
  const distanceFiltered = useMemo<AreaEnriched[]>(() => {
    if (radiusKm === null) return enriched;
    return enriched.filter(
      (s) => s.distance_to_workplace_km !== null && s.distance_to_workplace_km <= radiusKm,
    );
  }, [enriched, radiusKm]);

  // Facility filters. An area with no amenity data cannot prove it has a
  // hospital, school, etc., so it is left out and counted separately.
  const { facilityFiltered, hiddenForNoAmenityData } = useMemo(() => {
    if (!anyFilterActive) return { facilityFiltered: distanceFiltered, hiddenForNoAmenityData: 0 };
    const amenityFilterOn = needsAmenityData(facilityFilters);
    const kept: AreaEnriched[] = [];
    let unknown = 0;
    for (const s of distanceFiltered) {
      if (!passesTrainFilter(s, facilityFilters)) continue;
      if (amenityFilterOn) {
        if (s.amenities === null) {
          unknown++;
          continue;
        }
        if (!passesAmenityFilters(s.amenities, facilityFilters)) continue;
      }
      kept.push(s);
    }
    return { facilityFiltered: kept, hiddenForNoAmenityData: unknown };
  }, [distanceFiltered, facilityFilters, anyFilterActive]);

  // Sorted. Thin-sample areas always rank after well-sampled ones.
  const sorted = useMemo<AreaEnriched[]>(() => {
    return [...facilityFiltered].sort(
      (a, b) =>
        Number(a.low_sample) - Number(b.low_sample) ||
        compareBySort(activeSort, a, b) ||
        a.postcode.localeCompare(b.postcode),
    );
  }, [facilityFiltered, activeSort]);

  // Fetch routed drive times for the cards actually on screen: the first
  // COMMUTE_TOP_N of the list as currently sorted and filtered. Re-evaluated
  // whenever that list changes (sort, filters, or routed times arriving and
  // re-ordering it). The store never re-requests an area and stops at its
  // cap, so this settles instead of looping.
  const topCards = useMemo<CommuteTarget[]>(() => {
    return sorted
      .slice(0, COMMUTE_TOP_N)
      .filter((s) => !s.is_workplace)
      .map((s) => ({ postcode: s.postcode, lat: s.lat, lng: s.lng }));
  }, [sorted]);

  useEffect(() => {
    if (workplace && topCards.length > 0) requestCommutes(workplace, topCards);
  }, [requestCommutes, workplace, topCards]);

  // -------------------------------------------------------------------
  // Map data: every area in range; ones filtered out by facilities are dimmed
  // -------------------------------------------------------------------
  const mapPoints = useMemo<MapPoint[]>(() => {
    return distanceFiltered.map((s) => ({
      key: s.suburb_key,
      postcode: s.postcode,
      name: s.suburb_name,
      names: s.suburb_names.filter((n) => n !== s.suburb_name),
      lat: s.lat,
      lng: s.lng,
      rent: s.median_rent,
      bonds: s.total_bonds,
      lowSample: s.low_sample,
      dwellingTypes: s.dwelling_types,
      // medianIncome deliberately not set: the page only knows the user's own
      // income, which is not the area's median household income.
    }));
  }, [distanceFiltered]);

  const highlightedKeys = useMemo(() => new Set(sorted.map((s) => s.suburb_key)), [sorted]);

  // Scroll to the previously-selected card on back-navigation
  useEffect(() => {
    if (restoredScrollRef.current || !selectedKey || sorted.length === 0) return;
    restoredScrollRef.current = true;
    // Wait a frame so the cards are painted
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`suburb-card-${selectedKey}`)
        ?.scrollIntoView({ behavior: "instant", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [sorted, selectedKey]);

  const activeSortOption = SORT_OPTIONS.find((o) => o.value === activeSort);
  const sortDescription = activeSortOption?.description(workplace?.name ?? null, isIncomeMode) ?? "";
  const availableSorts = SORT_OPTIONS.filter((o) => !o.needsWorkplace || hasWorkplace);

  // Summary counts over everything the server returned
  const summaryCount = useMemo(() => {
    const limit = isIncomeMode ? 30 : WELL_UNDER_BUDGET_PCT;
    return (data?.suburbs ?? []).filter((s) => s.rent_stress_pct <= limit).length;
  }, [data, isIncomeMode]);

  // --- Loading state ---
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30">
        <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
            <div className="h-8 w-16 animate-pulse-soft rounded-lg bg-slate-200" />
            <div className="flex-1">
              <div className="h-5 w-48 animate-pulse-soft rounded bg-slate-200" />
              <div className="mt-1.5 h-3 w-32 animate-pulse-soft rounded bg-slate-100" />
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="mb-4 flex items-center justify-center gap-3 py-2">
            <span className="h-8 w-8 animate-spin rounded-full border-3 border-slate-200 border-t-primary" />
            <p className="text-sm font-medium text-slate-500">
              Analysing rents across Greater Sydney...
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm"
                style={{ animationDelay: `${n * 100}ms` }}
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="h-5 w-36 animate-pulse-soft rounded bg-slate-200" />
                    <div className="mt-2 h-3 w-16 animate-pulse-soft rounded bg-slate-100" />
                  </div>
                  <div className="h-7 w-24 animate-pulse-soft rounded-full bg-slate-100" />
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[1, 2, 3, 4].map((c) => (
                    <div key={c}>
                      <div className="h-3 w-16 animate-pulse-soft rounded bg-slate-100" />
                      <div className="mt-2 h-6 w-20 animate-pulse-soft rounded bg-slate-200" />
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

  // --- Error state ---
  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30 px-6">
        <div className="animate-fade-in flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle className="h-8 w-8 text-amber-400" />
          </div>
          <p className="text-lg font-semibold text-slate-700">{error}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-light"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to search
          </Link>
        </div>
      </div>
    );
  }

  // --- Empty state ---
  if (!data || data.suburbs.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30 px-6 text-center">
        <div className="animate-fade-in flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            <Home className="h-8 w-8 text-slate-400" />
          </div>
          <p className="text-lg font-semibold text-slate-700">No areas match your criteria</p>
          <p className="max-w-md text-sm text-slate-500">
            {isIncomeMode
              ? `No areas in Greater Sydney have median ${isSharing ? "shared" : bedroomLabel} rents within your ${weeklyDisplay} income.`
              : `No areas in Greater Sydney have median ${isSharing ? "shared" : bedroomLabel} rents at or under your ${weeklyDisplay} budget${isSharing ? " per person" : ""}.`}
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-dark"
          >
            <ArrowLeft className="h-4 w-4" />
            Adjust search
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30 pb-20">
      {/* ---------------------------------------------------------------- */}
      {/* Sticky header */}
      {/* ---------------------------------------------------------------- */}
      <header className="sticky top-14 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/"
            aria-label="Back to search"
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-primary hover:bg-blue-50 ${FOCUS_RING}`}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-primary">
              {isIncomeMode ? "Stress analysis" : "Results"} for {incomeDisplay}
              {!isIncomeMode && " budget"}
            </h1>
            <p className="text-xs text-slate-400">
              {weeklyDisplay} {isIncomeMode ? "income" : "max rent"} &middot;{" "}
              {bedroomLabel}
              {isSharing && (
                <span className="font-medium text-blue-500"> &middot; sharing &divide;{sharingMode}</span>
              )}
              {workplace && (
                <span> &middot; near {workplace.name}{data.workplace_postcode ? ` (${data.workplace_postcode})` : ""}</span>
              )}
            </p>
          </div>
        </div>

        {/* Sort pills — horizontal scroll on mobile */}
        <div className="mx-auto max-w-7xl px-4 pb-3 sm:px-6">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 scrollbar-hide">
            <div role="group" aria-label="Sort results" className="flex snap-x snap-mandatory gap-2 p-1">
              {availableSorts.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={activeSort === o.value}
                  onClick={() => setSortMode(o.value)}
                  className={`flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all ${FOCUS_RING} ${
                    activeSort === o.value
                      ? "bg-[#1e3a5f] text-white shadow-sm"
                      : "border border-[#1e3a5f]/20 bg-white text-[#1e3a5f] hover:border-[#1e3a5f] hover:bg-blue-50"
                  }`}
                >
                  {o.icon}
                  <span className="hidden sm:inline">{o.label}</span>
                  <span className="sm:hidden">{o.shortLabel}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{sortDescription}</p>
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Main: map + cards */}
      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:flex lg:gap-6">
        {/* Cards */}
        <main className="min-w-0 flex-1">
          {/* Workplace text was sent but nothing matched it */}
          {workplaceNotFound && (
            <div
              role="status"
              className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p>
                We couldn&apos;t find &ldquo;{data.workplace_query}&rdquo;. Showing results without a workplace.
              </p>
            </div>
          )}

          {/* -------------------------------------------------------------- */}
          {/* Facility filter bar */}
          {/* -------------------------------------------------------------- */}
          <div className="mb-4 rounded-xl border border-slate-200/80 bg-white shadow-sm">
            {/* Mobile toggle */}
            <button
              type="button"
              onClick={() => setShowFilterPanel((v) => !v)}
              aria-expanded={showFilterPanel}
              aria-controls="facility-filter-panel"
              className={`flex w-full items-center justify-between rounded-xl px-4 py-3 lg:hidden ${FOCUS_RING}`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <SlidersHorizontal className="h-4 w-4 text-slate-400" />
                Filter
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">
                    {activeFilterCount}
                    <span className="sr-only"> active</span>
                  </span>
                )}
              </div>
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${showFilterPanel ? "rotate-180" : ""}`} />
            </button>

            {/* Filter panel — always visible on lg+, toggleable on mobile */}
            <div id="facility-filter-panel" className={`${showFilterPanel ? "block" : "hidden"} lg:block`}>
              <div
                role="group"
                aria-labelledby="facility-filter-heading"
                className="border-t border-slate-100 px-4 py-3 lg:border-t-0"
              >
                <p id="facility-filter-heading" className="mb-2 text-xs font-medium text-slate-500">Must have nearby:</p>

                {/* Checkboxes — 2-col on mobile, inline on desktop */}
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
                  {FACILITY_FILTER_OPTIONS.map((opt) => (
                    <label
                      key={opt.key}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/60 has-[:focus-visible]:ring-offset-2 ${
                        facilityFilters[opt.key]
                          ? "border-primary/30 bg-primary/5 font-medium text-primary"
                          : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={facilityFilters[opt.key]}
                        onChange={() => toggleFilter(opt.key)}
                        className="sr-only"
                      />
                      <span className={facilityFilters[opt.key] ? "text-primary" : "text-slate-400"}>{opt.icon}</span>
                      {opt.label}
                    </label>
                  ))}
                </div>

                {/* Presets */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {FILTER_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary ${FOCUS_RING}`}
                    >
                      {preset.icon}
                      {preset.label}
                    </button>
                  ))}
                  {anyFilterActive && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className={`inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 ${FOCUS_RING}`}
                    >
                      <X className="h-3 w-3" />
                      Clear All
                    </button>
                  )}
                </div>
              </div>

              {/* Filter count */}
              {anyFilterActive && (
                <div className="border-t border-slate-100 px-4 py-2" aria-live="polite">
                  <p className="text-xs text-slate-500">
                    Showing{" "}
                    <span className="font-semibold text-slate-700">{sorted.length}</span>
                    {" "}of{" "}
                    <span className="font-semibold text-slate-700">{distanceFiltered.length}</span>
                    {" "}areas matching your filters
                    {distanceFiltered.length - sorted.length > 0 && (
                      <span className="text-slate-400"> &middot; {distanceFiltered.length - sorted.length} hidden</span>
                    )}
                  </p>
                  {hiddenForNoAmenityData > 0 && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      {plural(hiddenForNoAmenityData, "area")} hidden because amenity data is unavailable
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Showing count */}
          <div className="mb-4">
            <p className="text-sm text-slate-500">
              Showing <span className="font-semibold text-slate-700">{sorted.length}</span>{" "}
              area{sorted.length !== 1 && "s"}
              {radiusKm === null
                ? activeSort === "lowest_rent" && " across all of Sydney"
                : ` within ${radiusKm} km of ${workplace?.name ?? "your workplace"}`}
              <span className="text-slate-400"> &middot; one result per postcode</span>
            </p>
          </div>

          {/* Nothing to show */}
          {sorted.length === 0 && anyFilterActive && (
            <div className="mb-4 animate-fade-in rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
              <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-400" />
              <p className="font-semibold text-slate-700">No areas match all your requirements</p>
              <p className="mt-1 text-sm text-slate-500">Try unchecking some filters to see more results.</p>
              <button
                type="button"
                onClick={clearFilters}
                className={`mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 ${FOCUS_RING}`}
              >
                <X className="h-3.5 w-3.5" />
                Clear all filters
              </button>
            </div>
          )}
          {sorted.length === 0 && !anyFilterActive && radiusKm !== null && (
            <div className="mb-4 animate-fade-in rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
              <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-400" />
              <p className="font-semibold text-slate-700">
                No matching areas within {radiusKm} km of {workplace?.name ?? "your workplace"}
              </p>
              <button
                type="button"
                onClick={() => setSortMode("lowest_rent")}
                className={`mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 ${FOCUS_RING}`}
              >
                <DollarSign className="h-3.5 w-3.5" />
                Show all of Sydney by lowest rent
              </button>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {sorted.map((s, i) => (
              <AreaCard
                key={s.suburb_key}
                area={s}
                index={i}
                weeklyAmount={weeklyIncome}
                sortMode={activeSort}
                isSelected={s.suburb_key === selectedKey}
                hasWorkplace={hasWorkplace}
                isSharing={isSharing}
                isIncomeMode={isIncomeMode}
                detailHref={detailHref(s.suburb_key, workplace)}
                onSelect={() => selectArea(s.suburb_key)}
                onToggle={() => toggleArea(s.suburb_key)}
                onNavigate={() => setSelectedKey(s.suburb_key)}
              />
            ))}
          </div>

          {/* Summary */}
          <div className="mt-8 animate-fade-in rounded-xl border border-slate-200/80 bg-white p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Home className="h-4 w-4" />
              Analysis Summary
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              {isIncomeMode ? (
                <>
                  <p>
                    Based on your income of{" "}
                    <span className="font-semibold text-slate-900">{incomeDisplay}</span>{" "}
                    ({weeklyDisplay}), we found{" "}
                    <span className="font-semibold text-slate-900">
                      {plural(data.total_matching, "postcode area")}
                    </span>{" "}
                    where the median {isSharing ? "shared" : bedroomLabel} rent
                    {isSharing && " per person"} is within your income.
                  </p>
                  <p>
                    In{" "}
                    <span className="font-semibold text-emerald-700">{plural(summaryCount, "area")}</span>{" "}
                    that rent is 30% of your income or less (rated Comfortable or Manageable).
                    Above 30% is generally counted as rental stress.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Based on your budget of up to{" "}
                    <span className="font-semibold text-slate-900">{weeklyDisplay}</span>{" "}
                    in rent{isSharing && " per person"}, we found{" "}
                    <span className="font-semibold text-slate-900">
                      {plural(data.total_matching, "postcode area")}
                    </span>{" "}
                    where the median {isSharing ? "shared" : bedroomLabel} rent is at or under that amount.
                  </p>
                  <p>
                    <span className="font-semibold text-emerald-700">{plural(summaryCount, "area")}</span>{" "}
                    {summaryCount === 1 ? "is" : "are"} well under budget, at {WELL_UNDER_BUDGET_PCT}% of it or less.
                    Percentages on this page are rent as a share of your budget, not of your income.
                  </p>
                </>
              )}
              <p className="text-xs text-slate-400">
                Rent figures are medians for the whole postcode. Areas marked &ldquo;Limited data&rdquo; have
                fewer than 100 rental bonds behind them and are listed last.
                {hasWorkplace && " Drive times marked (est.) are estimated from straight-line distance."}
              </p>
            </div>
          </div>
        </main>

        {/* Map */}
        <aside id="map-section" ref={mapRef} aria-label="Map of results" className="mt-6 lg:mt-0 lg:w-[380px] lg:shrink-0">
          <div className="lg:sticky lg:top-44 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
              <Map className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-primary">
                {sorted.length} area{sorted.length !== 1 && "s"}
              </span>
            </div>
            <div className="h-[280px] sm:h-[320px] lg:h-[480px]">
              <MapWrapper
                points={mapPoints}
                highlighted={highlightedKeys}
                filtersActive={anyFilterActive}
                selectedKey={selectedKey}
                workplace={workplace}
                rentLabel={isSharing ? "Your share" : "Median rent"}
                onResetView={() => setSelectedKey(null)}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
