"use client";

import { Suspense, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Home,
  Building2,
  DollarSign,
  Wallet,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  Map,
  Train,
  Clock,
  Trophy,
  Car,
  GraduationCap,
  Heart,
  Baby,
  School,
  ExternalLink,
  Users,
  PiggyBank,
  Briefcase,
  Flame,
  SlidersHorizontal,
  ChevronDown,
  X,
} from "lucide-react";
import MapWrapper from "@/components/MapWrapper";
import type { Suburb } from "@/lib/suburbs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecommendedSuburb {
  suburb_key: string;
  postcode: string;
  suburb_name: string | null;
  lat: number | null;
  lng: number | null;
  median_rent: number;
  rent_stress_pct: number;
  affordability_score: number;
  rating: string;
  total_bonds: number;
  rent_trend: Record<string, number>;
  dwelling_types: Record<string, number>;
  nearest_station: {
    name: string;
    distance_km: number;
    type: string;
    lines: string[];
  } | null;
  commute_minutes: number | null;
  commute_label: string | null;
  // Sharing fields
  sharing_mode: number;
  total_rent: number;
  per_person_rent: number;
  solo_rent: number | null;
  savings_vs_solo: number | null;
  rent_estimated: boolean;
}

interface RecommendResponse {
  income_weekly: number;
  bedrooms: number | string;
  sharing_mode: number;
  workplace: string | null;
  workplace_postcode: string | null;
  workplace_suburb_key: string | null;
  workplace_lat: number | null;
  workplace_lng: number | null;
  total_matching: number;
  showing: number;
  suburbs: RecommendedSuburb[];
}

type SortMode = "best_overall" | "shortest_commute" | "best_affordability" | "lowest_rent";

interface SortOption {
  value: SortMode;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  needsWorkplace?: boolean;
  description: (workplace?: string | null, isIncome?: boolean) => string;
}

interface AmenitySummary {
  hospital_count: number;
  school_count: number;
  university_count: number;
  fire_station_count: number;
  police_count: number;
  childcare_count: number;
}

interface CommuteData {
  transit: { duration_min: number; transfers: number; modes: string[]; summary: string } | null;
  driving: { duration_min: number; distance_km: number; traffic_note: string } | null;
  straight_line_km: number;
}

interface SuburbEnriched extends RecommendedSuburb {
  haversine_km: number | null;
  estimated_commute_min: number | null;
  amenities: AmenitySummary | null;
  amenity_score: number;
  commute_real: CommuteData | null;
  commute_loading: boolean;
  overall_score: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BEDROOM_LABELS: Record<string, string> = {
  "1": "1-bedroom",
  "2": "2-bedroom",
  "3": "3-bedroom",
  "4": "4-bedroom",
};

const SORT_OPTIONS: SortOption[] = [
  {
    value: "best_overall",
    label: "Best Overall",
    shortLabel: "Overall",
    icon: <Trophy className="h-3.5 w-3.5" />,
    description: (_wp, isIncome) =>
      isIncome
        ? "Balanced score of rental stress, commute, amenities & supply"
        : "Balanced score of affordability, commute, amenities & supply",
  },
  {
    value: "shortest_commute",
    label: "Shortest Commute",
    shortLabel: "Commute",
    icon: <Clock className="h-3.5 w-3.5" />,
    needsWorkplace: true,
    description: (wp) => `Sorted by fastest commute to ${wp ?? "your workplace"}`,
  },
  {
    value: "best_affordability",
    label: "Best Affordability",
    shortLabel: "Affordable",
    icon: <Wallet className="h-3.5 w-3.5" />,
    description: (wp, isIncome) =>
      isIncome
        ? wp ? "Lowest rental stress within 40 km, nearest first" : "Sorted by lowest rental stress across Sydney"
        : wp ? "Affordable suburbs within 40 km, nearest first" : "Sorted by lowest rent relative to your income",
  },
  {
    value: "lowest_rent",
    label: "Lowest Rent",
    shortLabel: "Cheapest",
    icon: <DollarSign className="h-3.5 w-3.5" />,
    description: () => "All Sydney suburbs sorted by cheapest weekly rent",
  },
];

// ---------------------------------------------------------------------------
// Facility filters
// ---------------------------------------------------------------------------

interface FacilityFilters {
  hospital: boolean;
  school: boolean;
  university: boolean;
  train: boolean;
  fireStation: boolean;
  childcare: boolean;
}

const DEFAULT_FILTERS: FacilityFilters = {
  hospital: false,
  school: false,
  university: false,
  train: false,
  fireStation: false,
  childcare: false,
};

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateCommuteMinutes(distKm: number): number {
  if (distKm < 3) return Math.max(5, Math.round(distKm * 12));
  if (distKm < 10) return Math.round(15 + distKm * 2);
  if (distKm < 30) return Math.round(20 + distKm * 1.8);
  return Math.round(30 + distKm * 1.5);
}

function budgetBadge(stressPct: number): { label: string; color: string; bg: string } {
  if (stressPct <= 25) return { label: "Great Value", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" };
  if (stressPct <= 30) return { label: "Comfortable", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" };
  if (stressPct <= 40) return { label: "Manageable", color: "text-amber-700", bg: "bg-amber-50 border-amber-200" };
  return { label: "Pricey", color: "text-red-700", bg: "bg-red-50 border-red-200" };
}

function topDwellingType(types: Record<string, number>): string | null {
  const entries = Object.entries(types).filter(([k]) => k !== "Unknown" && k !== "Other");
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
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
  // Key forces full remount on new search — clears selected suburb, sort, filters
  return <ResultsContent key={searchParams.toString()} />;
}

function ResultsContent() {
  const searchParams = useSearchParams();

  const mode = searchParams.get("mode") ?? "budget";
  const isIncomeMode = mode === "income";
  const originalIncome = Number(searchParams.get("income") ?? 0);
  const incomePeriod = searchParams.get("period") ?? "annual";
  const bedrooms = searchParams.get("bedrooms") ?? "2";
  const workplace = searchParams.get("workplace") ?? "";
  const sharingMode = Math.min(4, Math.max(1, Number(searchParams.get("sharing") ?? 1) || 1));
  const shareBedroom = searchParams.get("share_bedroom") === "1";
  const isSharing = sharingMode > 1;
  // Prefer explicit weekly param; fall back to income/52 for old-format URLs
  const weeklyIncome = Number(searchParams.get("weekly") ?? 0) || Math.round(originalIncome / 52);
  const incomeDisplay = originalIncome > 0
    ? `$${originalIncome.toLocaleString("en-AU")}/${incomePeriod === "weekly" ? "wk" : incomePeriod === "fortnightly" ? "fn" : incomePeriod === "monthly" ? "mo" : "yr"}`
    : `$${weeklyIncome.toLocaleString("en-AU")}/wk`;

  const [data, setData] = useState<RecommendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // State key is tied to search params so each search starts fresh,
  // but back-navigation within the same search restores sort/selection.
  const stateKey = `rentsmart_ui_${searchParams.toString()}`;
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try {
      const saved = sessionStorage.getItem(stateKey);
      if (saved) return (JSON.parse(saved).sortMode as SortMode) ?? "best_overall";
    } catch { /* ignore */ }
    return "best_overall";
  });
  const [facilityFilters, setFacilityFilters] = useState<FacilityFilters>(() => {
    try {
      const saved = sessionStorage.getItem(stateKey);
      if (saved) return (JSON.parse(saved).filters as FacilityFilters) ?? DEFAULT_FILTERS;
    } catch { /* ignore */ }
    return DEFAULT_FILTERS;
  });
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [selectedSuburbKey, setSelectedSuburbKey] = useState<string | null>(() => {
    try {
      const saved = sessionStorage.getItem(stateKey);
      if (saved) return (JSON.parse(saved).selectedSuburbKey as string | null) ?? null;
    } catch { /* ignore */ }
    return null;
  });
  const [amenityCache, setAmenityCache] = useState<Record<string, { summary: AmenitySummary; score: number }>>({});
  const [commuteCache, setCommuteCache] = useState<Record<string, CommuteData>>({});
  const [commuteLoading, setCommuteLoading] = useState<Set<string>>(new Set());
  const commuteRequestedRef = useRef<Set<string>>(new Set());
  const mapRef = useRef<HTMLDivElement>(null);
  const restoredScrollRef = useRef(false);

  // Persist sort mode, filters, and selected suburb to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(stateKey, JSON.stringify({
        sortMode,
        filters: facilityFilters,
        selectedSuburbKey,
      }));
    } catch { /* quota */ }
  }, [stateKey, sortMode, facilityFilters, selectedSuburbKey]);

  const activeFilterCount = Object.values(facilityFilters).filter(Boolean).length;
  const anyFilterActive = activeFilterCount > 0;

  const toggleFilter = useCallback((key: keyof FacilityFilters) => {
    setFacilityFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const applyPreset = useCallback((preset: FilterPreset) => {
    setFacilityFilters({ ...DEFAULT_FILTERS, ...preset.filters });
  }, []);

  const clearFilters = useCallback(() => {
    setFacilityFilters(DEFAULT_FILTERS);
  }, []);

  const handleCardClick = useCallback(
    (suburbKey: string) => {
      if (suburbKey === selectedSuburbKey) return;
      setSelectedSuburbKey(suburbKey);
      // On mobile (< lg breakpoint), scroll down to map section
      if (window.innerWidth < 1024) {
        mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [selectedSuburbKey],
  );

  const handleResetView = useCallback(() => {
    setSelectedSuburbKey(null);
  }, []);

  // -------------------------------------------------------------------
  // Fetch recommendations (with sessionStorage caching for back-nav)
  // -------------------------------------------------------------------
  useEffect(() => {
    if (weeklyIncome <= 0) {
      setError("Invalid income. Please go back and try again.");
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({ income: String(weeklyIncome), bedrooms });
    if (workplace) params.set("workplace", workplace);
    if (sharingMode > 1) {
      params.set("sharing", String(sharingMode));
      if (shareBedroom) params.set("share_bedroom", "1");
    }

    const cacheKey = `rentsmart_v2_${params.toString()}`;

    // Try restoring from sessionStorage (instant back-navigation)
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as RecommendResponse;
        setData(parsed);
        setLoading(false);
        return;
      }
    } catch { /* ignore */ }

    fetch(`/api/recommend?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
          try { sessionStorage.setItem(cacheKey, JSON.stringify(d)); } catch { /* quota */ }
        }
      })
      .catch(() => setError("Network error. Please try again."))
      .finally(() => setLoading(false));
  }, [weeklyIncome, bedrooms, workplace, sharingMode, shareBedroom]);

  const hasWorkplace = !!(data?.workplace_lat != null && data?.workplace_lng != null);

  // -------------------------------------------------------------------
  // Fetch amenities for all postcodes (batched)
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!data) return;
    const postcodes = data.suburbs.map((s) => s.postcode).filter((pc) => !amenityCache[pc]);
    if (postcodes.length === 0) return;

    // Fetch in batches of 10
    const batchSize = 10;
    let cancelled = false;

    async function fetchBatch(batch: string[]) {
      const results = await Promise.allSettled(
        batch.map((pc) =>
          fetch(`/api/amenities?postcode=${pc}`)
            .then((r) => r.json())
            .then((d) => ({ postcode: pc, summary: d.summary as AmenitySummary, score: d.score as number })),
        ),
      );
      if (cancelled) return;
      const updates: Record<string, { summary: AmenitySummary; score: number }> = {};
      for (const r of results) {
        if (r.status === "fulfilled") {
          updates[r.value.postcode] = { summary: r.value.summary, score: r.value.score };
        }
      }
      setAmenityCache((prev) => ({ ...prev, ...updates }));
    }

    (async () => {
      for (let i = 0; i < postcodes.length; i += batchSize) {
        if (cancelled) break;
        await fetchBatch(postcodes.slice(i, i + batchSize));
      }
    })();

    return () => { cancelled = true; };
  }, [data, amenityCache]);

  // -------------------------------------------------------------------
  // Enrich suburbs with haversine + estimated commute + amenities
  // -------------------------------------------------------------------
  const enriched = useMemo<SuburbEnriched[]>(() => {
    if (!data) return [];
    return data.suburbs.map((s) => {
      let haversineKm: number | null = null;
      let estCommute: number | null = null;
      if (hasWorkplace && s.lat != null && s.lng != null) {
        haversineKm = Math.round(haversineDistance(s.lat, s.lng, data.workplace_lat!, data.workplace_lng!) * 10) / 10;
        estCommute = estimateCommuteMinutes(haversineKm);
      }

      const am = amenityCache[s.postcode] ?? null;
      const amenityScore = am?.score ?? 0;

      // Commute time for scoring — prefer real transit, fallback to estimate
      const realCommute = commuteCache[s.postcode] ?? null;
      const transitMin = realCommute?.transit?.duration_min ?? estCommute ?? 999;

      // Overall score: 0.35 affordability, 0.35 commute, 0.15 amenities, 0.15 supply
      const affordScore = Math.max(0, 100 - s.rent_stress_pct * 2);
      const commuteScore = Math.max(0, 100 - transitMin * 1.5);
      const supplyScore = Math.min(s.total_bonds / 10, 100);

      const overall = hasWorkplace
        ? Math.round(affordScore * 0.35 + commuteScore * 0.35 + amenityScore * 0.15 + supplyScore * 0.15)
        : Math.round(affordScore * 0.45 + amenityScore * 0.25 + supplyScore * 0.3);

      return {
        ...s,
        haversine_km: haversineKm,
        estimated_commute_min: estCommute,
        amenities: am?.summary ?? null,
        amenity_score: amenityScore,
        commute_real: realCommute,
        commute_loading: commuteLoading.has(s.postcode),
        overall_score: Math.max(0, Math.min(100, overall)),
      };
    });
  }, [data, hasWorkplace, amenityCache, commuteCache, commuteLoading]);

  // -------------------------------------------------------------------
  // Distance-filtered suburbs (before facility filters — used for map)
  // -------------------------------------------------------------------
  const distanceFiltered = useMemo<SuburbEnriched[]>(() => {
    const list = [...enriched];
    switch (sortMode) {
      case "best_overall":
        return list.filter((s) => !hasWorkplace || (s.haversine_km !== null && s.haversine_km <= 25));
      case "shortest_commute":
        return list.filter((s) => s.haversine_km !== null && s.haversine_km <= 20);
      case "best_affordability":
        return list.filter((s) => !hasWorkplace || (s.haversine_km !== null && s.haversine_km <= 40));
      case "lowest_rent":
      default:
        return list;
    }
  }, [enriched, sortMode, hasWorkplace]);

  // -------------------------------------------------------------------
  // Facility-filtered suburbs
  // -------------------------------------------------------------------
  const facilityFiltered = useMemo<SuburbEnriched[]>(() => {
    if (!anyFilterActive) return distanceFiltered;
    return distanceFiltered.filter((s) => {
      // If amenity data hasn't loaded yet, don't filter this suburb out
      if (facilityFilters.hospital && s.amenities != null && s.amenities.hospital_count === 0) return false;
      if (facilityFilters.school && s.amenities != null && s.amenities.school_count === 0) return false;
      if (facilityFilters.university && s.amenities != null && s.amenities.university_count === 0) return false;
      if (facilityFilters.train && (!s.nearest_station || s.nearest_station.distance_km > 3)) return false;
      if (facilityFilters.fireStation && s.amenities != null && s.amenities.fire_station_count === 0) return false;
      if (facilityFilters.childcare && s.amenities != null && s.amenities.childcare_count === 0) return false;
      return true;
    });
  }, [distanceFiltered, facilityFilters, anyFilterActive]);

  // -------------------------------------------------------------------
  // Sorted suburbs (after all filters)
  // -------------------------------------------------------------------
  const sorted = useMemo<SuburbEnriched[]>(() => {
    const list = [...facilityFiltered];
    switch (sortMode) {
      case "best_overall":
        return list.sort((a, b) => b.overall_score - a.overall_score);
      case "shortest_commute":
        return list.sort((a, b) => {
          const aMin = a.commute_real?.transit?.duration_min ?? a.estimated_commute_min ?? 999;
          const bMin = b.commute_real?.transit?.duration_min ?? b.estimated_commute_min ?? 999;
          return aMin - bMin;
        });
      case "best_affordability":
        // Sort by rent stress (cheapest relative to income), then by distance (nearest first)
        return list.sort((a, b) => {
          const stressDiff = a.rent_stress_pct - b.rent_stress_pct;
          if (Math.abs(stressDiff) > 3) return stressDiff; // >3% difference: rent wins
          // Within similar affordability, prefer nearer suburbs
          const aDist = a.haversine_km ?? 999;
          const bDist = b.haversine_km ?? 999;
          return aDist - bDist;
        });
      case "lowest_rent":
        return list.sort((a, b) => a.median_rent - b.median_rent);
      default:
        return list;
    }
  }, [facilityFiltered, sortMode]);

  // -------------------------------------------------------------------
  // Fetch real commute data — progressive: first 6, then remaining 14
  // Uses a ref to track already-requested postcodes, preventing re-fetches
  // when sort order changes due to incoming commute data.
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!data || !hasWorkplace) return;

    // Collect unique postcodes from top 20 that haven't been requested yet
    const seen = new Set<string>();
    const toFetch: SuburbEnriched[] = [];
    for (const s of enriched) {
      if (toFetch.length >= 20) break;
      if (s.lat == null || s.lng == null) continue;
      if (seen.has(s.postcode)) continue;
      seen.add(s.postcode);
      if (commuteRequestedRef.current.has(s.postcode)) continue;
      toFetch.push(s);
    }
    if (toFetch.length === 0) return;

    // Mark as requested immediately (ref — no re-render)
    for (const s of toFetch) commuteRequestedRef.current.add(s.postcode);

    setCommuteLoading((prev) => {
      const next = new Set(prev);
      for (const s of toFetch) next.add(s.postcode);
      return next;
    });

    let cancelled = false;

    function fetchSingle(s: SuburbEnriched) {
      const params = new URLSearchParams({
        from_lat: String(s.lat),
        from_lng: String(s.lng),
        to_lat: String(data!.workplace_lat),
        to_lng: String(data!.workplace_lng),
      });
      return fetch(`/api/commute?${params}`)
        .then((r) => r.json())
        .then((d) => ({ postcode: s.postcode, data: d as CommuteData }));
    }

    function applyResults(results: PromiseSettledResult<{ postcode: string; data: CommuteData }>[]) {
      if (cancelled) return;
      const updates: Record<string, CommuteData> = {};
      const doneLoading = new Set<string>();
      for (const r of results) {
        if (r.status === "fulfilled") {
          updates[r.value.postcode] = r.value.data;
          doneLoading.add(r.value.postcode);
        }
      }
      setCommuteCache((prev) => ({ ...prev, ...updates }));
      setCommuteLoading((prev) => {
        const next = new Set(prev);
        for (const pc of doneLoading) next.delete(pc);
        return next;
      });
    }

    // Batch 1: first 6 (visible above fold), then remaining
    const FIRST_BATCH = 6;
    const batch1 = toFetch.slice(0, FIRST_BATCH);
    const batch2 = toFetch.slice(FIRST_BATCH);

    async function fetchProgressive() {
      const results1 = await Promise.allSettled(batch1.map(fetchSingle));
      applyResults(results1);

      if (cancelled || batch2.length === 0) return;

      const results2 = await Promise.allSettled(batch2.map(fetchSingle));
      applyResults(results2);
    }

    fetchProgressive();
    return () => { cancelled = true; };
    // Only re-run when data first loads — ref prevents duplicate requests
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hasWorkplace]);

  // -------------------------------------------------------------------
  // Map data
  // -------------------------------------------------------------------
  // Map shows ALL distance-filtered suburbs; facility-filtered-out ones get dimmed
  const mapSuburbs = useMemo<Suburb[]>(() => {
    return distanceFiltered
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({
        suburb_key: s.suburb_key,
        postcode: s.postcode,
        suburb_name: s.suburb_name,
        lat: s.lat,
        lng: s.lng,
        median_rent_overall: s.median_rent,
        avg_rent: null,
        total_bonds: s.total_bonds,
        median_rent_1bed: null,
        median_rent_2bed: null,
        median_rent_3bed: null,
        median_rent_4bed: null,
        "median_rent_5+bed": null,
        dwelling_types: s.dwelling_types,
        rent_trend: s.rent_trend,
        median_household_income_weekly: weeklyIncome,
        rent_stress_pct_1bed: null,
        rent_stress_pct_2bed: null,
        rent_stress_pct_3bed: null,
        rent_stress_pct_4bed: null,
        "rent_stress_pct_5+bed": null,
      }));
  }, [distanceFiltered, weeklyIncome]);

  const highlightedSuburbKeys = useMemo(() => new Set(sorted.map((s) => s.suburb_key)), [sorted]);

  // Scroll to the previously-selected suburb card on back-navigation
  useEffect(() => {
    if (restoredScrollRef.current || !selectedSuburbKey || sorted.length === 0) return;
    restoredScrollRef.current = true;
    // Use requestAnimationFrame to ensure DOM is painted
    requestAnimationFrame(() => {
      const el = document.getElementById(`suburb-card-${selectedSuburbKey}`);
      if (el) {
        el.scrollIntoView({ behavior: "instant", block: "center" });
      }
    });
  }, [sorted, selectedSuburbKey]);

  // Record of postcode -> suburb names sharing that postcode (for shared-postcode note)
  const postcodeSuburbs = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const s of enriched) {
      if (!result[s.postcode]) result[s.postcode] = [];
      if (s.suburb_name) result[s.postcode].push(s.suburb_name);
    }
    return result;
  }, [enriched]);

  const activeSortOption = SORT_OPTIONS.find((o) => o.value === sortMode);
  const sortDescription = activeSortOption?.description(data?.workplace, isIncomeMode) ?? "";
  const availableSorts = SORT_OPTIONS.filter((o) => !o.needsWorkplace || hasWorkplace);

  // Count within 30%
  const within30 = useMemo(
    () => (data?.suburbs ?? []).filter((s) => s.rent_stress_pct <= 30).length,
    [data],
  );

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
              Analysing {originalIncome > 0 ? "331" : ""} suburbs across Greater Sydney...
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
          <p className="text-lg font-semibold text-slate-700">No suburbs match your criteria</p>
          <p className="max-w-md text-sm text-slate-500">
            No suburbs in Greater Sydney have median {BEDROOM_LABELS[bedrooms] ?? ""} rents
            within your ${weeklyIncome.toLocaleString("en-AU")}/wk income.
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
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-primary hover:bg-blue-50"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-primary">
              {isIncomeMode ? "Stress analysis" : "Results"} for {incomeDisplay}
            </h1>
            <p className="text-xs text-slate-400">
              ${weeklyIncome.toLocaleString("en-AU")}/wk &middot;{" "}
              {BEDROOM_LABELS[bedrooms] ?? bedrooms}
              {isSharing && (
                <span className="font-medium text-blue-500"> &middot; sharing &divide;{sharingMode}</span>
              )}
              {data.workplace && (
                <span> &middot; near {data.workplace}{data.workplace_postcode ? ` (${data.workplace_postcode})` : ""}</span>
              )}
            </p>
          </div>
        </div>

        {/* Sort pills — horizontal scroll on mobile */}
        <div className="mx-auto max-w-7xl px-4 pb-3 sm:px-6">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 scrollbar-hide">
            <div className="flex snap-x snap-mandatory gap-2 pb-1">
              {availableSorts.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setSortMode(o.value)}
                  className={`flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                    sortMode === o.value
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
          <p className="mt-1.5 text-xs text-slate-500">{sortDescription}</p>
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Main: map + cards */}
      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:flex lg:gap-6">
        {/* Cards */}
        <main className="min-w-0 flex-1">
          {/* -------------------------------------------------------------- */}
          {/* Facility filter bar */}
          {/* -------------------------------------------------------------- */}
          <div className="mb-4 rounded-xl border border-slate-200/80 bg-white shadow-sm">
            {/* Mobile toggle */}
            <button
              onClick={() => setShowFilterPanel((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 lg:hidden"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <SlidersHorizontal className="h-4 w-4 text-slate-400" />
                Filter
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </div>
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${showFilterPanel ? "rotate-180" : ""}`} />
            </button>

            {/* Filter panel — always visible on lg+, toggleable on mobile */}
            <div className={`${showFilterPanel ? "block" : "hidden"} lg:block`}>
              <div className="border-t border-slate-100 px-4 py-3 lg:border-t-0">
                <p className="mb-2 text-xs font-medium text-slate-500">Must have nearby:</p>

                {/* Checkboxes — 2-col on mobile, inline on desktop */}
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
                  {FACILITY_FILTER_OPTIONS.map((opt) => (
                    <label
                      key={opt.key}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all select-none ${
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
                      onClick={() => applyPreset(preset)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                    >
                      {preset.icon}
                      {preset.label}
                    </button>
                  ))}
                  {anyFilterActive && (
                    <button
                      onClick={clearFilters}
                      className="inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
                    >
                      <X className="h-3 w-3" />
                      Clear All
                    </button>
                  )}
                </div>
              </div>

              {/* Filter count */}
              {anyFilterActive && (
                <div className="border-t border-slate-100 px-4 py-2">
                  <p className="text-xs text-slate-500">
                    Showing{" "}
                    <span className="font-semibold text-slate-700">{sorted.length}</span>
                    {" "}of{" "}
                    <span className="font-semibold text-slate-700">{distanceFiltered.length}</span>
                    {" "}suburbs matching your filters
                    {distanceFiltered.length - sorted.length > 0 && (
                      <span className="text-slate-400"> &middot; {distanceFiltered.length - sorted.length} hidden</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Showing count */}
          <div className="mb-4">
            <p className="text-sm text-slate-500">
              Showing <span className="font-semibold text-slate-700">{sorted.length}</span>{" "}
              suburb{sorted.length !== 1 && "s"}
              {sortMode === "lowest_rent" && " across all of Sydney"}
              {sortMode === "shortest_commute" && hasWorkplace && " within 20 km"}
              {sortMode === "best_overall" && hasWorkplace && " within 25 km"}
              {sortMode === "best_affordability" && hasWorkplace && " within 40 km"}
            </p>
          </div>

          {/* All-filtered-out state */}
          {sorted.length === 0 && anyFilterActive && (
            <div className="mb-4 animate-fade-in rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
              <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-400" />
              <p className="font-semibold text-slate-700">No suburbs match all your requirements</p>
              <p className="mt-1 text-sm text-slate-500">Try unchecking some filters to see more results.</p>
              <button
                onClick={clearFilters}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                <X className="h-3.5 w-3.5" />
                Clear all filters
              </button>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {sorted.map((s, i) => {
              const siblings = (postcodeSuburbs[s.postcode] ?? []).filter((n: string) => n !== s.suburb_name);
              const isWorkplace = !!(data?.workplace_suburb_key && s.suburb_key === data.workplace_suburb_key);
              return (
                <SuburbCard
                  key={s.suburb_key}
                  suburb={s}
                  index={i}
                  weeklyIncome={weeklyIncome}
                  sortMode={sortMode}
                  isSelected={s.suburb_key === selectedSuburbKey}
                  hasWorkplace={hasWorkplace}
                  isSharing={isSharing}
                  sharingMode={sharingMode}
                  sharedWith={siblings}
                  isWorkplace={isWorkplace}
                  isIncomeMode={isIncomeMode}
                  workplaceLat={data?.workplace_lat ?? null}
                  workplaceLng={data?.workplace_lng ?? null}
                  onClick={() => handleCardClick(s.suburb_key)}
                />
              );
            })}
          </div>

          {/* Summary */}
          <div className="mt-8 animate-fade-in rounded-xl border border-slate-200/80 bg-white p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Home className="h-4 w-4" />
              Analysis Summary
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              <p>
                Based on your {isIncomeMode ? "income" : "budget"} of{" "}
                <span className="font-semibold text-slate-900">
                  {incomeDisplay}
                </span>{" "}
                (${weeklyIncome.toLocaleString("en-AU")}/wk), we analysed{" "}
                <span className="font-semibold text-slate-900">{data.total_matching} suburbs</span>{" "}
                for {BEDROOM_LABELS[bedrooms] ?? bedrooms} rentals.
              </p>
              <p>
                <span className="font-semibold text-emerald-700">{within30} suburbs</span>{" "}
                {isIncomeMode
                  ? "have low rental stress (under 30% of income)."
                  : "are within the recommended 30% rent-to-budget ratio."}
              </p>
            </div>
          </div>
        </main>

        {/* Map */}
        <aside id="map-section" ref={mapRef} className="mt-6 lg:mt-0 lg:w-[380px] lg:shrink-0">
          <div className="lg:sticky lg:top-44 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
              <Map className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-primary">
                {sorted.length} suburb{sorted.length !== 1 && "s"}
              </span>
            </div>
            <div className="h-[280px] sm:h-[320px] lg:h-[480px]">
              <MapWrapper
                suburbs={mapSuburbs}
                highlighted={highlightedSuburbKeys}
                filtersActive={anyFilterActive}
                selectedSuburbKey={selectedSuburbKey}
                workplaceSuburbKey={data?.workplace_suburb_key ?? null}
                workplacePostcode={data?.workplace_postcode ?? null}
                onResetView={handleResetView}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuburbCard component
// ---------------------------------------------------------------------------

function SuburbCard({
  suburb: s,
  index: i,
  weeklyIncome,
  sortMode,
  isSelected,
  hasWorkplace,
  isSharing,
  sharingMode,
  sharedWith,
  isWorkplace,
  isIncomeMode,
  workplaceLat,
  workplaceLng,
  onClick,
}: {
  suburb: SuburbEnriched;
  index: number;
  weeklyIncome: number;
  sortMode: SortMode;
  isSelected: boolean;
  hasWorkplace: boolean;
  isSharing: boolean;
  sharingMode: number;
  sharedWith: string[];
  isWorkplace: boolean;
  isIncomeMode: boolean;
  workplaceLat: number | null;
  workplaceLng: number | null;
  onClick: () => void;
}) {
  // Build suburb detail URL with workplace coords if available
  const detailHref = workplaceLat != null && workplaceLng != null
    ? `/suburb/${s.suburb_key}?wp_lat=${workplaceLat}&wp_lng=${workplaceLng}`
    : `/suburb/${s.suburb_key}`;
  const badge = budgetBadge(s.rent_stress_pct);

  // Rental stress indicator (income mode only)
  const stressDot =
    s.rent_stress_pct <= 30
      ? { dot: "bg-emerald-500", label: "Low stress", text: "text-emerald-700" }
      : s.rent_stress_pct <= 40
        ? { dot: "bg-amber-500", label: "Moderate stress", text: "text-amber-700" }
        : { dot: "bg-red-500", label: "High stress", text: "text-red-700" };
  const topType = topDwellingType(s.dwelling_types);

  // Commute display: single driving time — real driving if available, else estimate
  const drivingMin = s.commute_real?.driving?.duration_min ?? null;
  const estimateMin = s.estimated_commute_min;
  const displayMin = drivingMin ?? estimateMin;
  const isEstimate = drivingMin === null;
  const showCommute = hasWorkplace && !isWorkplace && displayMin !== null;

  return (
    <article
      id={`suburb-card-${s.suburb_key}`}
      onClick={onClick}
      className={`animate-slide-up relative cursor-pointer overflow-hidden rounded-xl transition-all ${
        isSelected
          ? "border-2 border-blue-400 bg-blue-50/50 shadow-md"
          : "border border-slate-200/80 bg-white shadow-sm hover:shadow-md hover:border-slate-300"
      }`}
      style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}
    >
      <div className="p-4 sm:p-5">
        {/* Row 1: Name + badge + score */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {i < 3 && (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                {i + 1}
              </span>
            )}
            <div>
              <Link href={detailHref}>
                <h3 className="text-base font-bold text-slate-900 transition-colors hover:text-primary sm:text-lg">
                  {s.suburb_name ?? `Postcode ${s.postcode}`}
                </h3>
              </Link>
              <span className="text-xs text-slate-400">{s.postcode}</span>
              {isWorkplace && (
                <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <Briefcase className="h-3 w-3" /> Your workplace &mdash; 0 min commute
                </p>
              )}
              {sharedWith.length > 0 && (
                <p className="mt-0.5 text-[10px] text-slate-400">
                  Rent data shared with {sharedWith.join(", ")} (same postcode)
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Budget badge */}
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.bg} ${badge.color}`}>
              {badge.label}
            </span>

            {/* Score */}
            {sortMode === "best_overall" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-bold text-purple-700">
                <Trophy className="h-3 w-3" />
                {s.overall_score}
              </span>
            )}
          </div>
        </div>

        {/* Sharing info — total rent, your share, savings */}
        {isSharing && (
          <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-xs text-slate-500">
                Total: ${s.total_rent}/wk
                {s.rent_estimated && <span className="ml-1 text-amber-600">(est.)</span>}
              </span>
              <span className="text-base font-bold text-primary">
                <Users className="mb-0.5 inline h-4 w-4" /> YOUR SHARE: ${s.per_person_rent}/wk
              </span>
            </div>
            {s.savings_vs_solo != null && s.savings_vs_solo > 0 && (
              <div className="mt-1 flex items-center gap-1">
                <PiggyBank className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-xs font-semibold text-emerald-600">
                  Save ${s.savings_vs_solo}/wk vs living solo
                </span>
              </div>
            )}
          </div>
        )}

        {/* Row 2: Key stats — rent, stress, supply */}
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          {!isSharing && (
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-4 w-4 text-slate-400" />
              <span className="text-base font-bold text-primary">${s.median_rent}/wk</span>
            </div>
          )}
          {isIncomeMode ? (
            <div className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stressDot.dot}`} />
              <span className={`text-sm font-medium ${stressDot.text}`}>
                {s.rent_stress_pct}% of income — {stressDot.label}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Wallet className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-600">{s.rent_stress_pct}% of budget</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-600">{s.total_bonds.toLocaleString("en-AU")} rentals</span>
          </div>
          {topType && (
            <div className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-600">{topType}s</span>
            </div>
          )}
        </div>

        {/* Row 3: Driving time */}
        {showCommute && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2">
            {s.commute_loading ? (
              <div className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
                <span className="text-xs text-slate-400">Calculating drive time...</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Car className="h-4 w-4 text-emerald-500" />
                  <span className={`text-sm ${isEstimate ? "text-slate-500" : "font-semibold text-slate-700"}`}>
                    {isEstimate ? "~" : ""}{displayMin} min
                  </span>
                  <span className="text-xs text-slate-400">drive{isEstimate ? " (est.)" : ""}</span>
                </div>
                {s.haversine_km !== null && (
                  <span className="text-xs text-slate-400">{s.haversine_km} km away</span>
                )}
              </>
            )}
          </div>
        )}

        {/* Row 4: Nearest station */}
        {s.nearest_station && (
          <div className="mb-3 flex items-center gap-1.5 text-xs text-slate-500">
            <Train className="h-3.5 w-3.5 shrink-0 text-purple-500" />
            <span className="font-medium text-slate-700">{s.nearest_station.name}</span>
            <span>
              {s.nearest_station.type === "ferry" ? "wharf" : "station"} — {s.nearest_station.distance_km} km
            </span>
          </div>
        )}

        {/* Row 5: Amenity counts */}
        {s.amenities && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {s.amenities.hospital_count > 0 && (
              <div className="flex items-center gap-1 text-xs text-slate-500" title="Hospitals nearby">
                <Heart className="h-3.5 w-3.5 text-red-400" />
                <span className="sm:hidden">{s.amenities.hospital_count}</span>
                <span className="hidden sm:inline">{s.amenities.hospital_count} hospital{s.amenities.hospital_count !== 1 && "s"}</span>
              </div>
            )}
            {s.amenities.school_count > 0 && (
              <div className="flex items-center gap-1 text-xs text-slate-500" title="Schools nearby">
                <School className="h-3.5 w-3.5 text-blue-400" />
                <span className="sm:hidden">{s.amenities.school_count}</span>
                <span className="hidden sm:inline">{s.amenities.school_count} school{s.amenities.school_count !== 1 && "s"}</span>
              </div>
            )}
            {s.amenities.university_count > 0 && (
              <div className="flex items-center gap-1 text-xs text-slate-500" title="Universities nearby">
                <GraduationCap className="h-3.5 w-3.5 text-indigo-400" />
                <span className="sm:hidden">{s.amenities.university_count}</span>
                <span className="hidden sm:inline">{s.amenities.university_count} uni{s.amenities.university_count !== 1 && "s"}</span>
              </div>
            )}
            {s.amenities.childcare_count > 0 && (
              <div className="flex items-center gap-1 text-xs text-slate-500" title="Childcare nearby">
                <Baby className="h-3.5 w-3.5 text-pink-400" />
                <span className="sm:hidden">{s.amenities.childcare_count}</span>
                <span className="hidden sm:inline">{s.amenities.childcare_count} childcare</span>
              </div>
            )}
          </div>
        )}

        {/* Row 6: View Details link */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {s.rating === "comfortable" && <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />}
            <span>
              ${(weeklyIncome - s.median_rent).toLocaleString("en-AU")}/wk left over
            </span>
          </div>
          <Link
            href={detailHref}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-lg bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            View Details
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </article>
  );
}
