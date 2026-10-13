"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  DollarSign,
  BedDouble,
  Home,
  AlertTriangle,
  ChevronDown,
  Map,
  Users,
  RotateCcw,
  X,
} from "lucide-react";
import MapWrapper, { type MapPoint } from "@/components/MapWrapper";
import WorkplaceCombobox from "@/components/WorkplaceCombobox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = "weekly" | "fortnightly" | "monthly" | "annual";
type SearchMode = "budget" | "income";

interface FormState {
  searchMode: SearchMode;
  /** Digits with thousands separators, as shown in the field. */
  amount: string;
  period: Period;
  bedrooms: string;
  sharing: number;
  shareBedroom: boolean;
  workplaceText: string;
}

/** One map point per postcode, as returned by GET /api/suburbs. */
interface SuburbPoint {
  suburb_key: string;
  postcode: string;
  suburb_name: string;
  suburb_names?: string[];
  lat: number;
  lng: number;
  median_rent_overall: number | null;
  median_rent_1bed?: number | null;
  median_rent_2bed?: number | null;
  median_rent_3bed?: number | null;
  median_household_income_weekly?: number | null;
  total_bonds: number;
  dwelling_types?: Record<string, number>;
  low_sample?: boolean;
}

type SydneyMedians = Record<string, number | null | undefined>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "rentsmart_form";

const DEFAULT_FORM: FormState = {
  searchMode: "budget",
  amount: "",
  period: "weekly",
  bedrooms: "2",
  sharing: 1,
  shareBedroom: false,
  workplaceText: "",
};

const BEDROOM_OPTIONS = [
  { value: "1", label: "Studio / 1 Bed" },
  { value: "2", label: "2 Bedrooms" },
  { value: "3", label: "3 Bedrooms" },
  { value: "4", label: "4+ Bedrooms" },
];

const SHARING_OPTIONS = [
  { value: 1, label: "Solo", ariaLabel: "Living solo" },
  { value: 2, label: "÷2", ariaLabel: "Rent split between 2 people" },
  { value: 3, label: "÷3", ariaLabel: "Rent split between 3 people" },
  { value: 4, label: "÷4", ariaLabel: "Rent split between 4 people" },
] as const;

const PERIODS: {
  value: Period;
  label: string;
  incomePlaceholder: string;
  /** Null: not offered in budget mode (nobody budgets rent by the year). */
  budgetPlaceholder: string | null;
}[] = [
  { value: "weekly", label: "Weekly", incomePlaceholder: "e.g. 1,200", budgetPlaceholder: "e.g. 600" },
  { value: "fortnightly", label: "Fortnightly", incomePlaceholder: "e.g. 2,400", budgetPlaceholder: "e.g. 1,200" },
  { value: "monthly", label: "Monthly", incomePlaceholder: "e.g. 5,200", budgetPlaceholder: "e.g. 2,600" },
  { value: "annual", label: "Annual", incomePlaceholder: "e.g. 62,400", budgetPlaceholder: null },
];

/** Lowest weekly amounts accepted, to catch a wrong period or a typo. */
const MIN_WEEKLY_BUDGET = 50;
const MIN_WEEKLY_INCOME = 200;

/** Any suburb detail response carries the Sydney-wide medians. */
const MEDIANS_URL = "/api/suburbs/2000";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toWeekly(amount: number, period: Period): number {
  switch (period) {
    case "weekly": return amount;
    case "fortnightly": return amount / 2;
    case "monthly": return (amount * 12) / 52;
    case "annual": return amount / 52;
  }
}

function formatAmount(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits).toLocaleString("en-AU") : "";
}

function parseAmount(value: string): number {
  return parseFloat(value.replace(/,/g, ""));
}

function isPeriod(value: unknown): value is Period {
  return PERIODS.some((p) => p.value === value);
}

/** Read the saved form, ignoring anything that is not the expected shape. */
function loadSavedForm(): FormState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FORM;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return DEFAULT_FORM;
    const saved = v as Record<string, unknown>;

    const searchMode: SearchMode = saved.searchMode === "income" ? "income" : "budget";
    // "incomeAmount"/"incomePeriod" are the field names used by earlier versions
    const amount = saved.amount ?? saved.incomeAmount;
    const savedPeriod = saved.period ?? saved.incomePeriod;
    let period: Period = isPeriod(savedPeriod) ? savedPeriod : DEFAULT_FORM.period;
    if (searchMode === "budget" && period === "annual") period = "weekly";
    const sharing = Number(saved.sharing);

    return {
      searchMode,
      amount: typeof amount === "string" ? formatAmount(amount) : "",
      period,
      bedrooms: BEDROOM_OPTIONS.some((o) => o.value === saved.bedrooms)
        ? (saved.bedrooms as string)
        : DEFAULT_FORM.bedrooms,
      sharing: Number.isInteger(sharing) && sharing >= 1 && sharing <= 4 ? sharing : 1,
      shareBedroom: saved.shareBedroom === true && sharing === 2,
      workplaceText:
        typeof saved.workplaceText === "string" ? saved.workplaceText.slice(0, 100) : "",
    };
  } catch {
    return DEFAULT_FORM;
  }
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

function toMapPoints(body: unknown): MapPoint[] {
  if (typeof body !== "object" || body === null) return [];
  const list = (body as { suburbs?: unknown }).suburbs;
  if (!Array.isArray(list)) return [];

  const points: MapPoint[] = [];
  for (const s of list as SuburbPoint[]) {
    if (
      !s ||
      typeof s.suburb_key !== "string" ||
      typeof s.lat !== "number" ||
      typeof s.lng !== "number" ||
      typeof s.median_rent_overall !== "number"
    ) {
      continue;
    }
    points.push({
      key: s.suburb_key,
      postcode: s.postcode,
      name: s.suburb_name,
      names: s.suburb_names,
      lat: s.lat,
      lng: s.lng,
      rent: s.median_rent_overall,
      bonds: s.total_bonds,
      lowSample: s.low_sample,
      rent1bed: s.median_rent_1bed,
      rent2bed: s.median_rent_2bed,
      rent3bed: s.median_rent_3bed,
      medianIncome: s.median_household_income_weekly,
      dwellingTypes: s.dwelling_types,
    });
  }
  return points;
}

// False on the server and for the hydration render, true afterwards.
const subscribeNever = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const hydrated = useHydrated();

  // Map points (one per postcode) and Sydney-wide medians, loaded once
  const [points, setPoints] = useState<MapPoint[] | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [medians, setMedians] = useState<SydneyMedians | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchJson("/api/suburbs", controller.signal)
      .then((body) => setPoints(toMapPoints(body)))
      .catch(() => {
        if (!controller.signal.aborted) setMapFailed(true);
      });

    fetchJson(MEDIANS_URL, controller.signal)
      .then((body) => {
        const m = (body as { sydney_medians?: unknown } | null)?.sydney_medians;
        if (typeof m === "object" && m !== null) setMedians(m as SydneyMedians);
      })
      .catch(() => {
        // The sharing preview is simply not shown without the medians
      });

    return () => controller.abort();
  }, []);

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
            <Home className="h-4 w-4" aria-hidden="true" />
            Powered by NSW Government Open Data
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
            Sydney Rent
            <span className="text-accent">Smart</span> AI
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-blue-100/90 sm:text-xl">
            Find Sydney areas that fit what you can actually afford, using
            about 1.1 million rental bond lodgements and ABS Census income
            data.
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
            <Map className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-primary">
              Sydney Rental Heatmap
            </h2>
            <span className="text-xs text-slate-400">
              {points
                ? `${points.length} postcode areas`
                : mapFailed
                  ? "Unavailable"
                  : "Loading..."}
            </span>
          </div>
          {/* Map container */}
          <div className="h-[320px] sm:h-[420px] lg:h-[500px]">
            {points && points.length > 0 ? (
              <MapWrapper points={points} />
            ) : (
              <div className="flex h-full items-center justify-center bg-slate-50 text-slate-400">
                {mapFailed || points ? (
                  <p className="px-6 text-center text-sm">
                    The map couldn&apos;t be loaded. You can still search below.
                  </p>
                ) : (
                  <span
                    role="status"
                    aria-label="Loading map"
                    className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-primary"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Form */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative z-10 mx-auto mt-8 max-w-3xl px-4 sm:px-6">
        {/* Remounted once after hydration so the saved values can be read
            from sessionStorage as initial state. */}
        <SearchForm
          key={hydrated ? "restored" : "initial"}
          restore={hydrated}
          medians={medians}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search form
// ---------------------------------------------------------------------------

function SearchForm({
  restore,
  medians,
}: {
  /** True once it is safe to read and write sessionStorage. */
  restore: boolean;
  medians: SydneyMedians | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() =>
    restore ? loadSavedForm() : DEFAULT_FORM,
  );
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  const { searchMode, amount, period, bedrooms, sharing, shareBedroom, workplaceText } = form;
  const isBudget = searchMode === "budget";

  function update(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  // Persist form values so they survive a trip to the results page and back
  useEffect(() => {
    if (!restore) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // Storage unavailable or full: the form still works, it just won't persist
    }
  }, [restore, form]);

  function handleClear() {
    setForm(DEFAULT_FORM);
    setError("");
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const raw = parseAmount(amount);
    if (!raw || raw <= 0) {
      setError(
        isBudget
          ? "Please enter the most you want to pay in rent."
          : "Please enter your income before tax.",
      );
      return;
    }

    const weekly = Math.round(toWeekly(raw, period));
    const minWeekly = isBudget ? MIN_WEEKLY_BUDGET : MIN_WEEKLY_INCOME;
    if (weekly < minWeekly) {
      setError(
        `That works out to $${weekly.toLocaleString("en-AU")} per week, which seems too low for ${
          isBudget ? "a rent budget" : "an income"
        }. Please check the amount and the period selected.`,
      );
      return;
    }

    setSearching(true);

    const params = new URLSearchParams({
      income: String(Math.round(raw)),
      period,
      weekly: String(weekly),
      bedrooms,
      mode: searchMode,
    });

    if (sharing > 1) {
      params.set("sharing", String(sharing));
      if (sharing === 2 && shareBedroom) params.set("share_bedroom", "1");
    }

    // Sent as typed or picked ("Parramatta (2150)"): the server resolves it
    // and uses the postcode to tell same-named suburbs apart.
    const workplace = workplaceText.trim();
    if (workplace) params.set("workplace", workplace);

    // Unique timestamp ensures each search gets fresh state (no stale
    // selection or sort mode restored from a previous visit).
    params.set("_t", String(Date.now()));
    router.push(`/results?${params}`);
  }

  // Weekly equivalent of the amount entered
  const rawAmount = parseAmount(amount);
  const weeklyPreview =
    rawAmount > 0 && period !== "weekly" ? Math.round(toWeekly(rawAmount, period)) : null;

  // When sharing, the search picks the dwelling size itself (one bedroom
  // each, or a 1-bed for two people sharing a room) and ignores `bedrooms`.
  const sharedBeds =
    sharing <= 1 ? null : sharing === 2 && shareBedroom ? 1 : Math.min(sharing, 4);

  // Sharing preview: per-person share of the Sydney-wide median for that size
  const sharingPreview = (() => {
    if (sharedBeds === null || !medians) return null;
    const beds = sharedBeds;
    const totalRent = medians[`${beds}bed`];
    if (typeof totalRent !== "number" || totalRent <= 0) return null;
    return { beds, totalRent, perPerson: Math.round(totalRent / sharing) };
  })();

  const activePeriod = PERIODS.find((p) => p.value === period) ?? PERIODS[0];
  const periodOptions = isBudget
    ? PERIODS.filter((p) => p.budgetPlaceholder !== null)
    : PERIODS;
  const perPerson = sharing > 1;

  const amountLabel = isBudget
    ? `${activePeriod.label} rent budget ($)`
    : `${activePeriod.label} income before tax ($)`;
  const amountHelp = isBudget
    ? perPerson
      ? "The most you want to pay in rent, per person"
      : "The most you want to pay in rent"
    : perPerson
      ? "Your own income. The 30% benchmark is measured against income before tax."
      : "The 30% benchmark is measured against income before tax.";

  const pill = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
      active
        ? "bg-[#1e3a5f] text-white shadow-sm"
        : "border border-[#1e3a5f]/20 bg-white text-[#1e3a5f] hover:border-[#1e3a5f] hover:bg-blue-50"
    }`;

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-10"
    >
      {/* Mode toggle */}
      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Search by">
        <button
          type="button"
          aria-pressed={isBudget}
          onClick={() =>
            update({
              searchMode: "budget",
              // Annual is not offered for a rent budget
              period: period === "annual" ? "weekly" : period,
            })
          }
          className={pill(isBudget)}
        >
          Rent Budget
        </button>
        <button
          type="button"
          aria-pressed={!isBudget}
          onClick={() => update({ searchMode: "income" })}
          className={pill(!isBudget)}
        >
          Income (Rental Stress Calculator)
        </button>
      </div>

      <h2 className="mb-1 text-xl font-bold text-primary sm:text-2xl">
        {isBudget ? "What’s your rent budget?" : "Rental Stress Calculator"}
      </h2>
      <p className="mb-8 text-sm text-slate-500">
        {isBudget
          ? `Enter the most you want to pay in rent${
              perPerson ? " per person" : ""
            } and we’ll list the Sydney postcode areas where the median rent is at or under it.`
          : "Enter your income before tax and we’ll show what share of it the median rent would take in each Sydney postcode area, measured against the 30% benchmark."}
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Amount with period tabs */}
        <div>
          <label htmlFor="amount" className="mb-1.5 block text-sm font-medium text-slate-700">
            {amountLabel}
          </label>
          {/* Period tabs */}
          <div className="mb-2 flex gap-1" role="group" aria-label="Amount period">
            {periodOptions.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-pressed={period === p.value}
                onClick={() => update({ period: p.value })}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  period === p.value
                    ? "bg-[#1e3a5f] text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <DollarSign
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="amount"
              type="text"
              inputMode="numeric"
              aria-describedby="amount-help"
              placeholder={
                (isBudget ? activePeriod.budgetPlaceholder : activePeriod.incomePlaceholder) ?? ""
              }
              value={amount}
              onChange={(e) => update({ amount: formatAmount(e.target.value) })}
              className="h-12 w-full rounded-lg border border-slate-300 bg-slate-50 pl-10 pr-9 text-slate-900 placeholder:text-slate-400 transition-colors focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20 focus:outline-none"
            />
            {amount && (
              <button
                type="button"
                aria-label="Clear amount"
                onClick={() => update({ amount: "" })}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <p id="amount-help" className="mt-1.5 text-xs text-slate-500">
            {amountHelp}
          </p>
          {/* Weekly equivalent */}
          {weeklyPreview !== null && (
            <p className="mt-1 text-xs text-slate-500">
              ={" "}
              <span className="font-semibold text-primary">
                ${weeklyPreview.toLocaleString("en-AU")}
              </span>{" "}
              per week
            </p>
          )}
        </div>

        {/* Bedrooms */}
        <div>
          <label htmlFor="bedrooms" className="mb-1.5 block text-sm font-medium text-slate-700">
            Bedrooms
          </label>
          <div className="relative">
            <BedDouble
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <select
              id="bedrooms"
              value={sharedBeds ? String(sharedBeds) : bedrooms}
              disabled={sharedBeds !== null}
              aria-describedby={sharedBeds ? "bedrooms-help" : undefined}
              onChange={(e) => update({ bedrooms: e.target.value })}
              className="h-12 w-full appearance-none rounded-lg border border-slate-300 bg-slate-50 pl-10 pr-10 text-slate-900 transition-colors focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-500"
            >
              {BEDROOM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
          </div>
          {sharedBeds !== null && (
            <p id="bedrooms-help" className="mt-1.5 text-xs text-slate-500">
              Set by the living arrangement below: {sharing} people
              {shareBedroom ? " sharing a bedroom" : ""} are matched to{" "}
              {sharedBeds}-bedroom rents.
            </p>
          )}
        </div>

        {/* Workplace suburb */}
        <div className="sm:col-span-2">
          <label htmlFor="workplace" className="mb-1.5 block text-sm font-medium text-slate-700">
            Workplace Suburb{" "}
            <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <WorkplaceCombobox
            id="workplace"
            value={workplaceText}
            onChange={(text) => update({ workplaceText: text })}
            placeholder="e.g. Parramatta, Sydney CBD"
          />
        </div>
      </div>

      {/* Living Arrangement */}
      <div className="mt-6">
        <p id="sharing-label" className="mb-1.5 block text-sm font-medium text-slate-700">
          Living Arrangement
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="sharing-label">
          {SHARING_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={sharing === o.value}
              aria-label={o.ariaLabel}
              onClick={() =>
                update({
                  sharing: o.value,
                  shareBedroom: o.value === 2 ? shareBedroom : false,
                })
              }
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                sharing === o.value
                  ? "bg-[#1e3a5f] text-white shadow-sm"
                  : "border border-slate-300 bg-slate-50 text-slate-600 hover:border-[#1e3a5f] hover:bg-blue-50"
              }`}
            >
              {o.value === 1 ? (
                <Home className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Users className="h-4 w-4" aria-hidden="true" />
              )}
              {o.label}
            </button>
          ))}
        </div>

        {/* Share bedroom toggle, only when splitting between two */}
        {sharing === 2 && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={shareBedroom}
              onChange={(e) => update({ shareBedroom: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-[#1e3a5f] focus:ring-[#1e3a5f]/30"
            />
            Sharing a bedroom (couples / close friends)
          </label>
        )}

        {/* Preview */}
        {sharingPreview && (
          <p className="mt-2 text-sm text-slate-500">
            Typical per-person share:{" "}
            <span className="font-semibold text-emerald-600">
              ~${sharingPreview.perPerson}/week
            </span>
            <span className="text-slate-400">
              {" "}
              (a {sharingPreview.beds}-bed at the median across Sydney
              postcodes, ${sharingPreview.totalRent}/wk, split {sharing} ways)
            </span>
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
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
              Finding areas...
            </>
          ) : (
            <>
              <Search className="h-5 w-5" aria-hidden="true" />
              {isBudget ? "Find Areas in My Budget" : "Check Rental Stress"}
            </>
          )}
        </button>
        <button
          type="button"
          aria-label="Clear the form"
          onClick={handleClear}
          className="flex h-13 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:border-slate-400 sm:h-14"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>
    </form>
  );
}
