"use client";

import Link from "next/link";
import {
  Building2,
  DollarSign,
  Wallet,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  Train,
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
  MapPin,
} from "lucide-react";
import { stressBand } from "@/lib/stress";
import { budgetBand, type AreaEnriched, type SortMode } from "./types";

const MAX_OTHER_NAMES = 3;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2";

function topDwellingType(types: Record<string, number>): string | null {
  const entries = Object.entries(types).filter(([k]) => k !== "Unknown" && k !== "Other");
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function stationKind(type: string): string {
  if (type === "ferry") return "wharf";
  if (type === "light_rail") return "stop";
  return "station";
}

/** Count that collapses to a bare number on small screens, read out in full. */
function AmenityCount({
  icon,
  count,
  label,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
}) {
  if (count <= 0) return null;
  return (
    <div className="flex items-center gap-1 text-xs text-slate-500">
      {icon}
      <span className="sm:hidden" aria-hidden="true">{count}</span>
      <span className="sr-only sm:not-sr-only">
        {count} {label}
      </span>
    </div>
  );
}

export interface AreaCardProps {
  area: AreaEnriched;
  index: number;
  /** Weekly income (income mode) or weekly rent budget (budget mode). */
  weeklyAmount: number;
  sortMode: SortMode;
  isSelected: boolean;
  hasWorkplace: boolean;
  isSharing: boolean;
  isIncomeMode: boolean;
  detailHref: string;
  /** Select this area (mouse click anywhere on the card). */
  onSelect: () => void;
  /** Toggle selection (the "Show on map" button, keyboard-operable). */
  onToggle: () => void;
  /** Following a link to the detail page: remember this card for the way back. */
  onNavigate: () => void;
}

export default function AreaCard({
  area: s,
  index: i,
  weeklyAmount,
  sortMode,
  isSelected,
  hasWorkplace,
  isSharing,
  isIncomeMode,
  detailHref,
  onSelect,
  onToggle,
  onNavigate,
}: AreaCardProps) {
  // Income mode: the one shared stress scale. Budget mode: no stress rating.
  const band = isIncomeMode ? stressBand(s.rent_stress_pct) : null;
  const badge = band
    ? { label: band.label, text: band.text, badge: band.badge }
    : budgetBand(s.rent_stress_pct);

  const topType = topDwellingType(s.dwelling_types);
  const otherNames = s.suburb_names.filter((n) => n !== s.suburb_name);
  const showCommute = hasWorkplace && !s.is_workplace && s.commute_min !== null;
  const spare = Math.max(0, Math.round(weeklyAmount - s.median_rent));

  return (
    <article
      id={`suburb-card-${s.suburb_key}`}
      onClick={onSelect}
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
                <span className="sr-only">Rank </span>
                {i + 1}
              </span>
            )}
            <div>
              <h3 className="text-base font-bold text-slate-900 sm:text-lg">
                <Link
                  href={detailHref}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate();
                  }}
                  className={`rounded transition-colors hover:text-primary ${FOCUS_RING}`}
                >
                  {s.suburb_name}
                </Link>
              </h3>
              <span className="text-xs text-slate-400">Postcode {s.postcode}</span>
              {otherNames.length > 0 && (
                <p className="mt-0.5 text-[10px] text-slate-400">
                  Also covers: {otherNames.slice(0, MAX_OTHER_NAMES).join(", ")}
                  {otherNames.length > MAX_OTHER_NAMES &&
                    ` +${otherNames.length - MAX_OTHER_NAMES} more`}
                </p>
              )}
              {(s.is_workplace || s.low_sample) && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {s.is_workplace && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      <Briefcase className="h-3 w-3" /> Your workplace area
                    </span>
                  )}
                  {s.low_sample && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
                      title="Fewer than 100 rental bonds behind this figure, so the median is less reliable"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      Limited data &middot; {s.total_bonds.toLocaleString("en-AU")} bond
                      {s.total_bonds !== 1 && "s"}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Stress band (income mode) or budget band (budget mode) */}
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.badge} ${badge.text}`}>
              {badge.label}
            </span>

            {/* Score */}
            {sortMode === "best_overall" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-bold text-purple-700">
                <Trophy className="h-3 w-3" />
                <span className="sr-only">Overall score </span>
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
          {band ? (
            <div className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${band.dot}`} />
              <span className={`text-sm font-medium ${band.text}`}>
                {s.rent_stress_pct}% of income — {band.label}
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

        {/* Row 3: Driving time — routed when we have it, otherwise an estimate */}
        {showCommute && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Car className="h-4 w-4 text-emerald-500" />
              {s.commute_is_estimate ? (
                <span className="text-sm text-slate-500">~{s.commute_min} min (est.)</span>
              ) : (
                <span className="text-sm font-semibold text-slate-700">{s.commute_min} min</span>
              )}
              <span className="text-xs text-slate-400">drive</span>
            </div>
            {s.distance_to_workplace_km !== null && (
              <span className="text-xs text-slate-400">{s.distance_to_workplace_km} km away</span>
            )}
            {s.commute_loading && (
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
                Checking drive time...
              </span>
            )}
          </div>
        )}

        {/* Row 4: Nearest station */}
        {s.nearest_station && (
          <div className="mb-3 flex items-center gap-1.5 text-xs text-slate-500">
            <Train className="h-3.5 w-3.5 shrink-0 text-purple-500" />
            <span className="font-medium text-slate-700">{s.nearest_station.name}</span>
            <span>
              {stationKind(s.nearest_station.type)} — {s.nearest_station.distance_km} km
            </span>
          </div>
        )}

        {/* Row 5: Amenity counts (null = no data for this postcode, not zero) */}
        {s.amenities ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <AmenityCount
              icon={<Heart className="h-3.5 w-3.5 text-red-400" />}
              count={s.amenities.hospital_count}
              label={s.amenities.hospital_count === 1 ? "hospital" : "hospitals"}
            />
            <AmenityCount
              icon={<School className="h-3.5 w-3.5 text-blue-400" />}
              count={s.amenities.school_count}
              label={s.amenities.school_count === 1 ? "school" : "schools"}
            />
            <AmenityCount
              icon={<GraduationCap className="h-3.5 w-3.5 text-indigo-400" />}
              count={s.amenities.university_count}
              label={s.amenities.university_count === 1 ? "uni" : "unis"}
            />
            <AmenityCount
              icon={<Baby className="h-3.5 w-3.5 text-pink-400" />}
              count={s.amenities.childcare_count}
              label="childcare"
            />
          </div>
        ) : (
          <p className="mb-3 text-xs text-slate-400">Amenity data unavailable</p>
        )}

        {/* Row 6: what's left, map toggle, details link */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {band?.rating === "comfortable" && <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />}
            <span>
              ${spare.toLocaleString("en-AU")}/wk {isIncomeMode ? "left over" : "under budget"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={`Show ${s.suburb_name} on the map`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${FOCUS_RING} ${
                isSelected
                  ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <MapPin className="h-3 w-3" />
              {isSelected ? "On map" : "Show on map"}
            </button>
            <Link
              href={detailHref}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate();
              }}
              className={`inline-flex items-center gap-1 rounded-lg bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 ${FOCUS_RING}`}
            >
              View Details
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
