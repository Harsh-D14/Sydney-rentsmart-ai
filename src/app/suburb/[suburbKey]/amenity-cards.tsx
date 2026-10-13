"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, Flame, Shield } from "lucide-react";
import { haversineKm } from "@/lib/geo";

// ---------------------------------------------------------------------------
// Lists of nearby places, each row linking to Google Maps directions from the
// suburb. Used for both the stored amenity data and the live Overpass lookup.
// ---------------------------------------------------------------------------

export interface PlaceItem {
  name: string;
  distance_km: number;
  lat: number;
  lng: number;
}

const INITIAL_COUNT = 5;

/** Keep only well-formed items from an untrusted list. */
export function toPlaceItems(value: unknown): PlaceItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PlaceItem =>
      typeof item === "object" &&
      item !== null &&
      typeof item.name === "string" &&
      Number.isFinite(item.distance_km) &&
      Number.isFinite(item.lat) &&
      Number.isFinite(item.lng),
  );
}

/**
 * Re-measure every item from the given point (2 decimals) and sort nearest
 * first. The stored amenity distances are from the postcode centroid, while
 * the page and its direction links start from the suburb itself.
 */
export function measureFrom(
  items: PlaceItem[],
  lat: number | null,
  lng: number | null,
): PlaceItem[] {
  if (lat == null || lng == null) return items;
  return items
    .map((item) => ({
      ...item,
      distance_km: Math.round(haversineKm(lat, lng, item.lat, item.lng) * 100) / 100,
    }))
    .sort((a, b) => a.distance_km - b.distance_km);
}

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

function PlaceRow({
  item,
  suburbLat,
  suburbLng,
  icon,
}: {
  item: PlaceItem;
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
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
        <span className="truncate text-sm text-slate-700 group-hover:text-primary">
          {item.name}
        </span>
        <ExternalLink
          className="hidden h-3 w-3 shrink-0 text-slate-300 group-hover:block"
          aria-hidden="true"
        />
      </div>
      <span className="shrink-0 text-xs font-medium text-slate-400">
        {item.distance_km} km
      </span>
    </a>
  );
}

function ExpandButton({
  expanded,
  total,
  onToggle,
}: {
  expanded: boolean;
  total: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-2.5 text-xs font-medium text-primary hover:bg-blue-50/40"
    >
      <ChevronDown
        className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
      {expanded ? "Show less" : `Show all ${total}`}
    </button>
  );
}

export function PlaceCard({
  icon,
  title,
  items,
  suburbLat,
  suburbLng,
}: {
  icon: React.ReactNode;
  title: string;
  items: PlaceItem[];
  suburbLat: number | null;
  suburbLng: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, INITIAL_COUNT);

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <span className="text-primary">{icon}</span>
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        <span className="ml-auto text-xs text-slate-400">{items.length} nearby</span>
      </div>
      <div className="divide-y divide-slate-50 px-1 py-1">
        {visible.map((item, i) => (
          <PlaceRow
            key={`${item.name}-${i}`}
            item={item}
            suburbLat={suburbLat}
            suburbLng={suburbLng}
          />
        ))}
      </div>
      {items.length > INITIAL_COUNT && (
        <ExpandButton
          expanded={expanded}
          total={items.length}
          onToggle={() => setExpanded(!expanded)}
        />
      )}
    </section>
  );
}

export function EmergencyServicesCard({
  fireStations,
  police,
  suburbLat,
  suburbLng,
}: {
  /** Both lists must already be sorted nearest first. */
  fireStations: PlaceItem[];
  police: PlaceItem[];
  suburbLat: number | null;
  suburbLng: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const combined = [
    ...fireStations.slice(0, 5).map((f) => ({ ...f, kind: "fire" as const })),
    ...police.slice(0, 5).map((p) => ({ ...p, kind: "police" as const })),
  ].sort((a, b) => a.distance_km - b.distance_km);

  if (combined.length === 0) return null;

  const visible = expanded ? combined : combined.slice(0, INITIAL_COUNT);

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Shield className="h-5 w-5 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-primary">Emergency Services</h3>
        <span className="ml-auto text-xs text-slate-400">{combined.length} nearby</span>
      </div>
      <div className="divide-y divide-slate-50 px-1 py-1">
        {visible.map((item, i) => (
          <PlaceRow
            key={`${item.kind}-${item.name}-${i}`}
            item={item}
            suburbLat={suburbLat}
            suburbLng={suburbLng}
            icon={
              item.kind === "fire" ? (
                <Flame className="h-3.5 w-3.5 text-red-400" aria-label="Fire station" />
              ) : (
                <Shield className="h-3.5 w-3.5 text-blue-400" aria-label="Police station" />
              )
            }
          />
        ))}
      </div>
      {combined.length > INITIAL_COUNT && (
        <ExpandButton
          expanded={expanded}
          total={combined.length}
          onToggle={() => setExpanded(!expanded)}
        />
      )}
    </section>
  );
}
