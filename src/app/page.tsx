"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  DollarSign,
  BedDouble,
  Briefcase,
  MapPin,
  Home,
  AlertTriangle,
  ChevronDown,
  Map,
  Users,
  RotateCcw,
  X,
} from "lucide-react";
import MapWrapper from "@/components/MapWrapper";
import type { Suburb } from "@/lib/suburbs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SuburbOption {
  suburb_key: string;
  postcode: string;
  suburb_name: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BEDROOM_OPTIONS = [
  { value: "1", label: "Studio / 1 Bed" },
  { value: "2", label: "2 Bedrooms" },
  { value: "3", label: "3 Bedrooms" },
  { value: "4", label: "4+ Bedrooms" },
];

const SHARING_OPTIONS = [
  { value: 1, label: "Solo", icon: "solo" },
  { value: 2, label: "\u00f72", icon: "share" },
  { value: 3, label: "\u00f73", icon: "share" },
  { value: 4, label: "\u00f74", icon: "share" },
] as const;

// Sydney-wide median rents by bedroom count (approximate, for instant preview)
const MEDIAN_RENTS: Record<number, number> = { 1: 520, 2: 600, 3: 700, 4: 800 };

type IncomePeriod = "weekly" | "fortnightly" | "monthly" | "annual";
type SearchMode = "budget" | "income";

const INCOME_PERIODS: { value: IncomePeriod; label: string; placeholder: string; budgetLabel: string; incomeLabel: string }[] = [
  { value: "weekly", label: "Weekly", placeholder: "e.g. 1,200", budgetLabel: "Weekly budget ($)", incomeLabel: "Weekly income ($)" },
  { value: "fortnightly", label: "Fortnightly", placeholder: "e.g. 2,400", budgetLabel: "Fortnightly budget ($)", incomeLabel: "Fortnightly income ($)" },
  { value: "monthly", label: "Monthly", placeholder: "e.g. 5,200", budgetLabel: "Monthly budget ($)", incomeLabel: "Monthly income ($)" },
  { value: "annual", label: "Annual", placeholder: "e.g. 62,400", budgetLabel: "Annual budget ($)", incomeLabel: "Annual income ($)" },
];

function toWeekly(amount: number, period: IncomePeriod): number {
  switch (period) {
    case "weekly": return amount;
    case "fortnightly": return amount / 2;
    case "monthly": return (amount * 12) / 52;
    case "annual": return amount / 52;
  }
}

// ---------------------------------------------------------------------------
// Suburb autocomplete hook
// ---------------------------------------------------------------------------

function useSuburbSearch() {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SuburbOption[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (query.length < 2) {
      setOptions([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/suburbs?search=${encodeURIComponent(query)}`);
        const data = await res.json();
        setOptions(
          (data.suburbs ?? [])
            .slice(0, 8)
            .map((s: SuburbOption) => ({ suburb_key: s.suburb_key, postcode: s.postcode, suburb_name: s.suburb_name })),
        );
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return { query, setQuery, options, loading, setOptions };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const router = useRouter();

  // Form state
  const [searchMode, setSearchMode] = useState<SearchMode>("budget");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomePeriod, setIncomePeriod] = useState<IncomePeriod>("weekly");
  const [incomeType, setIncomeType] = useState<"takehome" | "gross">("takehome");
  const [bedrooms, setBedrooms] = useState("2");
  const [sharing, setSharing] = useState(1);
  const [shareBedroom, setShareBedroom] = useState(false);
  const [workplaceText, setWorkplaceText] = useState("");
  const suburb = useSuburbSearch();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Restore form values from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("rentsmart_form");
      if (saved) {
        const v = JSON.parse(saved);
        if (v.searchMode) setSearchMode(v.searchMode);
        if (v.incomeAmount) setIncomeAmount(v.incomeAmount);
        if (v.incomePeriod) setIncomePeriod(v.incomePeriod);
        if (v.incomeType) setIncomeType(v.incomeType);
        if (v.bedrooms) setBedrooms(v.bedrooms);
        if (v.sharing) setSharing(v.sharing);
        if (v.shareBedroom) setShareBedroom(v.shareBedroom);
        if (v.workplaceText) setWorkplaceText(v.workplaceText);
      }
    } catch { /* ignore */ }
  }, []);

  // Persist form values to sessionStorage on change
  useEffect(() => {
    try {
      sessionStorage.setItem("rentsmart_form", JSON.stringify({
        searchMode, incomeAmount, incomePeriod, incomeType, bedrooms, sharing, shareBedroom, workplaceText,
      }));
    } catch { /* quota */ }
  }, [searchMode, incomeAmount, incomePeriod, incomeType, bedrooms, sharing, shareBedroom, workplaceText]);

  const handleClear = useCallback(() => {
    setSearchMode("budget");
    setIncomeAmount("");
    setIncomePeriod("weekly");
    setIncomeType("takehome");
    setBedrooms("2");
    setSharing(1);
    setShareBedroom(false);
    setWorkplaceText("");
    setError("");
    suburb.setQuery("");
    suburb.setOptions([]);
    try { sessionStorage.removeItem("rentsmart_form"); } catch { /* ignore */ }
  }, [suburb]);

  // Map state — load all suburbs once on mount
  const [allSuburbs, setAllSuburbs] = useState<Suburb[]>([]);
  useEffect(() => {
    fetch("/api/suburbs")
      .then((r) => r.json())
      .then((d) => setAllSuburbs(d.suburbs ?? []))
      .catch(() => {});
  }, []);

  // Form UI state
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Compute weekly income for live preview
  const weeklyPreview = (() => {
    const raw = parseFloat(incomeAmount.replace(/,/g, ""));
    if (!raw || raw <= 0) return null;
    return Math.round(toWeekly(raw, incomePeriod));
  })();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      const raw = parseFloat(incomeAmount.replace(/,/g, ""));
      if (!raw || raw <= 0) {
        setError("Please enter your income or budget.");
        return;
      }

      const weekly = Math.round(toWeekly(raw, incomePeriod));
      if (weekly < 200) {
        setError("This seems too low. Please check the amount and period selected.");
        return;
      }

      setSearching(true);

      const params = new URLSearchParams({
        income: String(Math.round(raw)),
        period: incomePeriod,
        weekly: String(weekly),
        bedrooms,
        mode: searchMode,
      });

      if (sharing > 1) {
        params.set("sharing", String(sharing));
        if (sharing === 2 && shareBedroom) {
          params.set("share_bedroom", "1");
        }
      }

      // Send workplace text — extract suburb name if from autocomplete (e.g. "Parramatta (2150)" → "Parramatta")
      if (workplaceText.trim()) {
        const wpMatch = workplaceText.match(/^(.+?)\s*\(\d{4}\)$/);
        params.set("workplace", wpMatch ? wpMatch[1].trim() : workplaceText.trim());
      }

      // Unique timestamp ensures each search gets fresh state (no stale
      // selectedSuburbKey or sort mode restored from a previous visit).
      params.set("_t", String(Date.now()));
      router.push(`/results?${params}`);
    },
    [incomeAmount, incomePeriod, searchMode, bedrooms, sharing, shareBedroom, workplaceText, router],
  );

  // Sharing preview: estimated per-person rent
  const sharingPreview = (() => {
    if (sharing <= 1) return null;
    const lookupBed = sharing === 2 && shareBedroom ? 1 : Math.min(sharing, 4);
    const totalRent = MEDIAN_RENTS[lookupBed] ?? MEDIAN_RENTS[2];
    const perPerson = Math.round(totalRent / sharing);
    return { totalRent, perPerson, bedLabel: `${lookupBed}-bed` };
  })();

  // Format number with commas
  const formatIncome = (val: string) => {
    const digits = val.replace(/\D/g, "");
    return digits ? Number(digits).toLocaleString("en-AU") : "";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30 pb-16">
      {/* ---------------------------------------------------------------- */}
      {/* Hero */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-dark via-primary to-primary-light">
        {/* Decorative shapes */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-white/5" />
          <div className="absolute -bottom-32 -left-32 h-[500px] w-[500px] rounded-full bg-accent/10" />
        </div>

        <div className="relative mx-auto max-w-4xl px-6 py-16 text-center sm:py-24">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-blue-100 backdrop-blur-sm">
            <Home className="h-4 w-4" />
            Powered by NSW Government Open Data + AI
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
            Sydney Rent
            <span className="text-accent">Smart</span> AI
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-blue-100/90 sm:text-xl">
            Find your perfect Sydney suburb based on what you can actually afford.
            We analyse 1.6 million rental bonds and ABS Census income data so you
            don&apos;t have to.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Map */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative z-10 mx-auto -mt-8 max-w-5xl px-4 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl shadow-slate-200/50">
          {/* Map header */}
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
            <Map className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-primary">
              Sydney Rental Heatmap
            </h2>
            <span className="text-xs text-slate-400">
              {allSuburbs.length > 0
                ? `${allSuburbs.filter((s) => s.lat && s.lng).length} suburbs`
                : "Loading..."}
            </span>
          </div>
          {/* Map container */}
          <div className="h-[320px] sm:h-[420px] lg:h-[500px]">
            {allSuburbs.length > 0 ? (
              <MapWrapper suburbs={allSuburbs} />
            ) : (
              <div className="flex h-full items-center justify-center bg-slate-50 text-slate-400">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Form */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative z-10 mx-auto mt-8 max-w-3xl px-4 sm:px-6">
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-10"
        >
          {/* Mode toggle */}
          <div className="mb-6 flex gap-2">
            <button
              type="button"
              onClick={() => setSearchMode("budget")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                searchMode === "budget"
                  ? "bg-[#1e3a5f] text-white shadow-sm"
                  : "border border-[#1e3a5f]/20 bg-white text-[#1e3a5f] hover:border-[#1e3a5f] hover:bg-blue-50"
              }`}
            >
              Budget
            </button>
            <button
              type="button"
              onClick={() => setSearchMode("income")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                searchMode === "income"
                  ? "bg-[#1e3a5f] text-white shadow-sm"
                  : "border border-[#1e3a5f]/20 bg-white text-[#1e3a5f] hover:border-[#1e3a5f] hover:bg-blue-50"
              }`}
            >
              Income (Rental Stress Calculator)
            </button>
          </div>

          <h2 className="mb-1 text-xl font-bold text-primary sm:text-2xl">
            {searchMode === "budget" ? "What can you afford?" : "Rental Stress Calculator"}
          </h2>
          <p className="mb-8 text-sm text-slate-500">
            {searchMode === "budget"
              ? "Enter your details and we\u2019ll find suburbs that fit your budget."
              : "Enter your income and we\u2019ll analyse rental stress across Sydney."}
          </p>

          <div className="grid gap-6 sm:grid-cols-2">
            {/* Income with period tabs */}
            <div>
              <label htmlFor="income" className="mb-1.5 block text-sm font-medium text-slate-700">
                {(() => {
                  const period = INCOME_PERIODS.find((p) => p.value === incomePeriod);
                  return searchMode === "budget" ? period?.budgetLabel ?? "Budget ($)" : period?.incomeLabel ?? "Income ($)";
                })()}
              </label>
              {/* Period tabs */}
              <div className="mb-2 flex gap-1">
                {INCOME_PERIODS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setIncomePeriod(p.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                      incomePeriod === p.value
                        ? "bg-[#1e3a5f] text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id="income"
                  type="text"
                  inputMode="numeric"
                  placeholder={INCOME_PERIODS.find((p) => p.value === incomePeriod)?.placeholder ?? ""}
                  value={incomeAmount}
                  onChange={(e) => setIncomeAmount(formatIncome(e.target.value))}
                  className="h-12 w-full rounded-lg border border-slate-300 bg-slate-50 pl-10 pr-9 text-slate-900 placeholder:text-slate-400 transition-colors focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20 focus:outline-none"
                />
                {incomeAmount && (
                  <button type="button" onClick={() => setIncomeAmount("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {/* Weekly preview */}
              {weeklyPreview !== null && incomePeriod !== "weekly" && (
                <p className="mt-1.5 text-xs text-slate-500">
                  = <span className="font-semibold text-primary">${weeklyPreview.toLocaleString("en-AU")}</span> per week
                </p>
              )}
              {/* Income type toggle — only visible in income mode */}
              {searchMode === "income" && (
                <>
                  <div className="mt-2.5 flex items-center gap-4">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                      <input
                        type="radio"
                        name="incomeType"
                        value="takehome"
                        checked={incomeType === "takehome"}
                        onChange={() => setIncomeType("takehome")}
                        className="h-3.5 w-3.5 border-slate-300 text-[#1e3a5f] focus:ring-[#1e3a5f]/30"
                      />
                      Take-home pay
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                      <input
                        type="radio"
                        name="incomeType"
                        value="gross"
                        checked={incomeType === "gross"}
                        onChange={() => setIncomeType("gross")}
                        className="h-3.5 w-3.5 border-slate-300 text-[#1e3a5f] focus:ring-[#1e3a5f]/30"
                      />
                      Before tax
                    </label>
                  </div>
                  {incomeType === "gross" && (
                    <p className="mt-1 text-[11px] text-amber-600">
                      Tip: Rent affordability is more accurate with take-home pay
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Bedrooms */}
            <div>
              <label htmlFor="bedrooms" className="mb-1.5 block text-sm font-medium text-slate-700">
                Bedrooms
              </label>
              <div className="relative">
                <BedDouble className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <select
                  id="bedrooms"
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  className="h-12 w-full appearance-none rounded-lg border border-slate-300 bg-slate-50 pl-10 pr-10 text-slate-900 transition-colors focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20 focus:outline-none"
                >
                  {BEDROOM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {/* Workplace suburb */}
            <div className="sm:col-span-2" ref={dropdownRef}>
              <label htmlFor="workplace" className="mb-1.5 block text-sm font-medium text-slate-700">
                Workplace Suburb{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <div className="relative">
                <Briefcase className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id="workplace"
                  type="text"
                  placeholder="e.g. Parramatta, Sydney CBD"
                  value={workplaceText}
                  onChange={(e) => {
                    setWorkplaceText(e.target.value);
                    suburb.setQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => suburb.options.length > 0 && setShowDropdown(true)}
                  className="h-12 w-full rounded-lg border border-slate-300 bg-slate-50 pl-10 pr-9 text-slate-900 placeholder:text-slate-400 transition-colors focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20 focus:outline-none"
                  autoComplete="off"
                />
                {workplaceText && (
                  <button
                    type="button"
                    onClick={() => { setWorkplaceText(""); suburb.setQuery(""); suburb.setOptions([]); setShowDropdown(false); }}
                    className="absolute right-3 top-1/2 z-10 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                {/* Autocomplete dropdown */}
                {showDropdown && suburb.options.length > 0 && (
                  <ul className="absolute top-full left-0 z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    {suburb.options.map((opt) => (
                      <li key={opt.suburb_key ?? opt.postcode}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-blue-50 hover:text-primary"
                          onClick={() => {
                            setWorkplaceText(`${opt.suburb_name} (${opt.postcode})`);
                            setShowDropdown(false);
                            suburb.setOptions([]);
                          }}
                        >
                          <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="font-medium">{opt.suburb_name}</span>
                          <span className="text-slate-400">{opt.postcode}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Living Arrangement */}
          <div className="mt-6">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Living Arrangement
            </label>
            <div className="flex gap-2">
              {SHARING_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    setSharing(o.value);
                    if (o.value !== 2) setShareBedroom(false);
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                    sharing === o.value
                      ? "bg-[#1e3a5f] text-white shadow-sm"
                      : "border border-slate-300 bg-slate-50 text-slate-600 hover:border-[#1e3a5f] hover:bg-blue-50"
                  }`}
                >
                  {o.value === 1 ? (
                    <Home className="h-4 w-4" />
                  ) : (
                    <Users className="h-4 w-4" />
                  )}
                  {o.label}
                </button>
              ))}
            </div>

            {/* Share bedroom toggle — only when ÷2 */}
            {sharing === 2 && (
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={shareBedroom}
                  onChange={(e) => setShareBedroom(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#1e3a5f] focus:ring-[#1e3a5f]/30"
                />
                Sharing a bedroom (couples / close friends)
              </label>
            )}

            {/* Preview */}
            {sharingPreview && (
              <p className="mt-2 text-sm text-slate-500">
                Estimated per-person share:{" "}
                <span className="font-semibold text-emerald-600">
                  ~${sharingPreview.perPerson}/week
                </span>
                <span className="text-slate-400">
                  {" "}(based on {sharingPreview.bedLabel} median ${sharingPreview.totalRent}/wk)
                </span>
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Submit + Clear */}
          <div className="mt-8 flex gap-3">
            <button
              type="submit"
              disabled={searching}
              className="flex h-13 flex-1 items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-white shadow-lg shadow-accent/25 transition-all hover:bg-accent-dark hover:shadow-accent/40 focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:outline-none disabled:opacity-60 disabled:shadow-none sm:h-14 sm:text-lg"
            >
              {searching ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Analysing suburbs...
                </>
              ) : (
                <>
                  <Search className="h-5 w-5" />
                  Find My Suburb
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="flex h-13 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:border-slate-400 sm:h-14"
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          </div>
        </form>
      </section>

    </div>
  );
}
