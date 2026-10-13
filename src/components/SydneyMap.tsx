"use client";

import { useMemo, useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Popup,
  Marker,
  Polyline,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { TrainStation } from "@/lib/commute";
import type { MapPoint, MapWrapperProps } from "./MapWrapper";

// NOTE: this file must never import "@/lib/suburbs" (not even for types): it
// would pull the whole suburb dataset into the browser bundle. Everything the
// map draws arrives through `points`.
//
// Every <Marker> below uses a divIcon, so Leaflet's default image icons (and
// any URL override for them) are not needed.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SYDNEY_CENTER: [number, number] = [-33.8688, 151.2093];
const DEFAULT_ZOOM = 11;
const POPUP_OPEN_DELAY_MS = 1600; // just after the 1.5 s flyTo lands

const RENT_TIERS = [
  { max: 500, color: "#22c55e", label: "Under $500/wk" },
  { max: 650, color: "#eab308", label: "$500–650/wk" },
  { max: 800, color: "#f97316", label: "$650–800/wk" },
  { max: Infinity, color: "#ef4444", label: "Over $800/wk" },
] as const;

const STATION_COLOR = "#7c3aed";
const ACCENT_COLOR = "#f97316";
const ROUTE_COLOR = "#3b82f6";

function rentColor(rent: number): string {
  for (const tier of RENT_TIERS) {
    if (rent <= tier.max) return tier.color;
  }
  return RENT_TIERS[RENT_TIERS.length - 1].color;
}

function circleRadius(bonds: number): number {
  const minR = 4;
  const maxR = 22;
  const clamped = Math.max(1, Math.min(bonds, 35000));
  const t = Math.log(clamped) / Math.log(35000);
  return minR + t * (maxR - minR);
}

function stationTypeLabel(type: TrainStation["type"]): string {
  switch (type) {
    case "ferry":
      return "Ferry";
    case "metro":
      return "Metro";
    case "light_rail":
      return "Light Rail";
    default:
      return "Train";
  }
}

type ViewTarget = "point" | "workplace";
type LatLng = { lat: number; lng: number };

// ---------------------------------------------------------------------------
// Map controller — flyTo for selection, toggle, and manual reset
// ---------------------------------------------------------------------------

function MapController({
  selectedKey,
  selectedPoint,
  viewTarget,
  workplace,
  resetKey,
}: {
  selectedKey: string | null;
  selectedPoint: MapPoint | null;
  viewTarget: ViewTarget;
  workplace: LatLng | null;
  resetKey: number;
}) {
  const map = useMap();
  const prev = useRef<{ key: string | null; target: ViewTarget; resetKey: number }>({
    key: null,
    target: "point",
    resetKey: 0,
  });

  const pointLat = selectedPoint?.lat ?? null;
  const pointLng = selectedPoint?.lng ?? null;
  const workLat = workplace?.lat ?? null;
  const workLng = workplace?.lng ?? null;

  useEffect(() => {
    // Manual reset — user clicked "Reset" while nothing was selected
    if (resetKey !== prev.current.resetKey) {
      prev.current.resetKey = resetKey;
      if (!selectedKey) {
        map.flyTo(SYDNEY_CENTER, DEFAULT_ZOOM, { duration: 1 });
      }
    }

    if (!selectedKey) {
      if (prev.current.key) {
        map.flyTo(SYDNEY_CENTER, DEFAULT_ZOOM, { duration: 1 });
      }
      prev.current = { ...prev.current, key: null, target: "point" };
      return;
    }

    if (selectedKey !== prev.current.key) {
      if (pointLat !== null && pointLng !== null) {
        map.flyTo([pointLat, pointLng], 14, { duration: 1.5 });
      }
      prev.current = { ...prev.current, key: selectedKey, target: "point" };
      return;
    }

    if (viewTarget !== prev.current.target) {
      if (viewTarget === "workplace" && workLat !== null && workLng !== null) {
        map.flyTo([workLat, workLng], 14, { duration: 2 });
      } else if (pointLat !== null && pointLng !== null) {
        map.flyTo([pointLat, pointLng], 14, { duration: 2 });
      }
      prev.current = { ...prev.current, target: viewTarget };
    }
  }, [map, selectedKey, pointLat, pointLng, viewTarget, workLat, workLng, resetKey]);

  return null;
}

// ---------------------------------------------------------------------------
// Selected point — pulsing marker whose popup opens once the fly-to lands
// ---------------------------------------------------------------------------

function SelectedMarker({
  point,
  icon,
  rentLabel,
}: {
  point: MapPoint;
  icon: L.DivIcon;
  rentLabel: string;
}) {
  const markerRef = useRef<L.Marker | null>(null);
  const pointKey = point.key;

  useEffect(() => {
    const timer = setTimeout(() => markerRef.current?.openPopup(), POPUP_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pointKey]);

  return (
    <Marker
      ref={markerRef}
      position={[point.lat, point.lng]}
      icon={icon}
      zIndexOffset={1000}
    >
      <Popup offset={[0, -8]}>
        <div className="min-w-[160px] text-sm leading-relaxed">
          <p className="text-base font-bold text-slate-900">{point.name}</p>
          <p className="text-xs text-slate-400">{point.postcode}</p>
          <p className="mt-1 text-sm font-semibold" style={{ color: "#1e3a5f" }}>
            ${point.rent}/wk {rentLabel.toLowerCase()}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {point.bonds.toLocaleString("en-AU")} rental bonds
            {point.lowSample && " · limited data"}
          </p>
        </div>
      </Popup>
    </Marker>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SydneyMapProps extends MapWrapperProps {
  stations?: TrainStation[];
}

const NO_STATIONS: TrainStation[] = [];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SydneyMap({
  points,
  highlighted,
  filtersActive = false,
  showStations = true,
  stations = NO_STATIONS,
  selectedKey = null,
  workplace = null,
  route = null,
  rentLabel = "Median rent",
  onResetView,
}: SydneyMapProps) {
  const selectedPoint = useMemo(
    () => (selectedKey ? points.find((p) => p.key === selectedKey) ?? null : null),
    [selectedKey, points],
  );

  // The suburb/workplace toggle belongs to one selection: it is stored with
  // the key it was made for, so a new selection starts back on the point
  // without an effect having to reset it.
  const [view, setView] = useState<{ key: string | null; target: ViewTarget }>({
    key: null,
    target: "point",
  });
  const viewTarget: ViewTarget = view.key === selectedKey ? view.target : "point";
  const [resetKey, setResetKey] = useState(0);

  const toggleViewTarget = () => {
    setView({ key: selectedKey, target: viewTarget === "point" ? "workplace" : "point" });
  };

  const handleResetMap = () => {
    onResetView?.();
    setView({ key: null, target: "point" });
    setResetKey((k) => k + 1);
  };

  const pulseIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: '<div class="marker-pulse"></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    [],
  );

  const workplaceIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: '<div class="workplace-marker"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    [],
  );

  // Line between the selected point and the workplace: the routed geometry
  // when the page supplies one, otherwise a plain straight line. No time is
  // shown on it, because a straight line says nothing about travel time.
  const hasRoute = !!route && route.length >= 2;
  const straightLine: [number, number][] | null =
    !hasRoute && selectedPoint && workplace
      ? [
          [selectedPoint.lat, selectedPoint.lng],
          [workplace.lat, workplace.lng],
        ]
      : null;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={SYDNEY_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
        className="h-full w-full rounded-xl"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapController
          selectedKey={selectedKey}
          selectedPoint={selectedPoint}
          viewTarget={viewTarget}
          workplace={workplace}
          resetKey={resetKey}
        />

        {/* Area markers */}
        {points.map((p) => {
          const color = rentColor(p.rent);
          const radius = circleRadius(p.bonds);
          const isHighlighted = highlighted?.has(p.key) ?? false;
          const isSelected = p.key === selectedKey;
          const isDimmed = filtersActive && !isHighlighted && !isSelected;
          const others = (p.names ?? []).filter((n) => n !== p.name);
          const dwellingEntries = Object.entries(p.dwellingTypes ?? {});

          return (
            <CircleMarker
              key={p.key}
              center={[p.lat, p.lng]}
              radius={isSelected ? radius * 2 : isDimmed ? radius * 0.7 : radius}
              pathOptions={{
                color: isSelected ? ACCENT_COLOR : isHighlighted ? "#1e3a5f" : isDimmed ? "#94a3b8" : color,
                weight: isSelected ? 3 : isHighlighted ? 3 : isDimmed ? 0.5 : 1.5,
                // Dashed outline marks a thin sample (few bonds behind the figure)
                dashArray: p.lowSample ? "3 4" : undefined,
                fillColor: isSelected ? ACCENT_COLOR : isDimmed ? "#94a3b8" : color,
                fillOpacity: isSelected ? 0.9 : isHighlighted ? 0.9 : isDimmed ? 0.15 : 0.55,
              }}
            >
              <Tooltip direction="top" offset={[0, -radius]} opacity={0.95}>
                <span className="text-xs font-semibold">{p.name}</span>
                <br />
                <span className="text-xs">${p.rent}/wk</span>
                {p.lowSample && (
                  <>
                    <br />
                    <span className="text-xs text-slate-500">limited data</span>
                  </>
                )}
              </Tooltip>

              {!isSelected && (
                <Popup>
                  <div className="min-w-[180px] text-sm leading-relaxed">
                    <p className="text-base font-bold text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.postcode}</p>
                    {others.length > 0 && (
                      <p className="text-xs text-slate-400">
                        Also covers: {others.slice(0, 3).join(", ")}
                        {others.length > 3 && ` +${others.length - 3} more`}
                      </p>
                    )}
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                      <span className="text-slate-500">{rentLabel}</span>
                      <span className="font-semibold">${p.rent}/wk</span>
                      {p.rent1bed != null && (
                        <>
                          <span className="text-slate-500">1-bed</span>
                          <span>${p.rent1bed}/wk</span>
                        </>
                      )}
                      {p.rent2bed != null && (
                        <>
                          <span className="text-slate-500">2-bed</span>
                          <span>${p.rent2bed}/wk</span>
                        </>
                      )}
                      {p.rent3bed != null && (
                        <>
                          <span className="text-slate-500">3-bed</span>
                          <span>${p.rent3bed}/wk</span>
                        </>
                      )}
                      {p.medianIncome != null && (
                        <>
                          <span className="text-slate-500">Median income</span>
                          <span>${p.medianIncome}/wk</span>
                        </>
                      )}
                      <span className="text-slate-500">Bonds</span>
                      <span>
                        {p.bonds.toLocaleString("en-AU")}
                        {p.lowSample && " (limited data)"}
                      </span>
                    </div>
                    {dwellingEntries.length > 0 && (
                      <p className="mt-2 text-xs text-slate-400">
                        {dwellingEntries
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 3)
                          .map(([t, pct]) => `${t} ${pct}%`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                </Popup>
              )}
            </CircleMarker>
          );
        })}

        {/* Pulsing marker + popup for the selected point */}
        {selectedPoint && <SelectedMarker point={selectedPoint} icon={pulseIcon} rentLabel={rentLabel} />}

        {/* Workplace diamond marker — always visible */}
        {workplace && (
          <Marker
            position={[workplace.lat, workplace.lng]}
            icon={workplaceIcon}
            zIndexOffset={900}
          >
            <Tooltip
              permanent
              direction="right"
              offset={[12, 0]}
              className="workplace-tooltip"
            >
              <span>{"🏢"} Your Workplace</span>
            </Tooltip>
          </Marker>
        )}

        {/* Routed geometry (solid) when supplied by the page */}
        {hasRoute && route && (
          <Polyline
            positions={route}
            pathOptions={{ color: ROUTE_COLOR, weight: 4, opacity: 0.8 }}
          />
        )}

        {/* Otherwise a plain straight line, selected point to workplace */}
        {straightLine && (
          <Polyline
            positions={straightLine}
            pathOptions={{
              color: ROUTE_COLOR,
              dashArray: "10, 10",
              weight: 3,
              opacity: 0.7,
            }}
          />
        )}

        {/* Station, wharf and light rail stop markers */}
        {showStations &&
          stations.map((st) => (
            <CircleMarker
              key={`station-${st.name}`}
              center={[st.lat, st.lng]}
              radius={5}
              pathOptions={{
                color: "#fff",
                weight: 1.5,
                fillColor: STATION_COLOR,
                fillOpacity: 0.9,
              }}
            >
              <Tooltip direction="top" offset={[0, -5]} opacity={0.95}>
                <span className="text-xs font-semibold">{st.name}</span>
                <br />
                <span className="text-xs text-slate-500">
                  {stationTypeLabel(st.type)} — {st.lines.join(", ")}
                </span>
              </Tooltip>
            </CircleMarker>
          ))}
      </MapContainer>

      {/* ---------------------------------------------------------------- */}
      {/* Reset Map — always visible, top-left below zoom controls */}
      {/* ---------------------------------------------------------------- */}
      <div className="pointer-events-none absolute top-20 left-3 z-[1000]">
        <button
          type="button"
          onClick={handleResetMap}
          className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-md backdrop-blur-sm transition-colors hover:bg-white hover:text-primary"
          title="Reset to full Sydney view"
          aria-label="Reset map to full Sydney view"
        >
          {/* Home icon (inline SVG) */}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
          </svg>
          Reset
        </button>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Selection controls — top-right */}
      {/* ---------------------------------------------------------------- */}
      {selectedKey && (
        <div className="pointer-events-none absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2">
          {/* Toggle selected point ↔ workplace */}
          {workplace && (
            <button
              type="button"
              onClick={toggleViewTarget}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-blue-200 bg-white/95 px-4 py-2 text-xs font-semibold text-blue-600 shadow-md backdrop-blur-sm transition-colors hover:bg-blue-50"
            >
              {viewTarget === "point" ? "Show Workplace →" : "← Show Suburb"}
            </button>
          )}

          {/* View indicator badge */}
          <div className="pointer-events-none rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur-sm">
            {viewTarget === "workplace" && workplace
              ? `🏢 ${workplace.name}`
              : `📍 ${selectedPoint?.name ?? selectedKey}`}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Legend — bottom-left */}
      {/* ---------------------------------------------------------------- */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-[1000]">
        <div className="pointer-events-auto rounded-lg border border-slate-200 bg-white/95 px-3 py-2.5 shadow-md backdrop-blur-sm">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {rentLabel} per week
          </p>
          <div className="flex flex-col gap-1">
            {RENT_TIERS.map((tier) => (
              <div key={tier.label} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full border border-black/10"
                  style={{ backgroundColor: tier.color }}
                />
                <span className="text-xs text-slate-600">{tier.label}</span>
              </div>
            ))}
            {showStations && stations.length > 0 && (
              <div className="mt-1 flex items-center gap-2 border-t border-slate-100 pt-1">
                <span
                  className="h-3 w-3 rounded-full border border-white"
                  style={{ backgroundColor: STATION_COLOR }}
                />
                <span className="text-xs text-slate-600">Station / wharf</span>
              </div>
            )}
            {workplace && (
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rotate-45 border-2 border-white"
                  style={{ backgroundColor: "#1e3a5f" }}
                />
                <span className="text-xs text-slate-600">Workplace</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
