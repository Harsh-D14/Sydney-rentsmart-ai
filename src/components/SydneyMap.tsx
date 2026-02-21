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
import type { Suburb } from "@/lib/suburbs";
import { getSuburbByPostcode, getSuburbByKey } from "@/lib/suburbs";
import { getNearestStation, haversineKm } from "@/lib/commute";
import type { TrainStation } from "@/lib/commute";

// Fix Leaflet's broken default icon paths under webpack/Next.js bundling.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SYDNEY_CENTER: [number, number] = [-33.8688, 151.2093];
const DEFAULT_ZOOM = 11;

const RENT_TIERS = [
  { max: 500, color: "#22c55e", label: "Under $500/wk" },
  { max: 650, color: "#eab308", label: "$500–650/wk" },
  { max: 800, color: "#f97316", label: "$650–800/wk" },
  { max: Infinity, color: "#ef4444", label: "Over $800/wk" },
] as const;

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

// ---------------------------------------------------------------------------
// Map controller — flyTo for selection, toggle, and manual reset
// ---------------------------------------------------------------------------

function MapController({
  selectedSuburbKey,
  suburbs,
  viewTarget,
  workplaceInfo,
  resetKey,
}: {
  selectedSuburbKey: string | null;
  suburbs: Suburb[];
  viewTarget: "suburb" | "workplace";
  workplaceInfo: { lat: number; lng: number } | null;
  resetKey: number;
}) {
  const map = useMap();
  const prev = useRef({ suburbKey: null as string | null, target: "suburb", resetKey: 0 });

  useEffect(() => {
    // Manual reset — user clicked "Reset Map" while nothing was selected
    if (resetKey !== prev.current.resetKey) {
      prev.current.resetKey = resetKey;
      if (!selectedSuburbKey) {
        map.flyTo(SYDNEY_CENTER, DEFAULT_ZOOM, { duration: 1 });
      }
    }

    const keyChanged = selectedSuburbKey !== prev.current.suburbKey;

    if (!selectedSuburbKey) {
      if (prev.current.suburbKey) {
        map.flyTo(SYDNEY_CENTER, DEFAULT_ZOOM, { duration: 1 });
      }
      prev.current = { ...prev.current, suburbKey: null, target: "suburb" };
      return;
    }

    if (keyChanged) {
      const suburb = suburbs.find((s) => s.suburb_key === selectedSuburbKey);
      if (suburb?.lat && suburb?.lng) {
        map.flyTo([suburb.lat, suburb.lng], 14, { duration: 1.5 });
      }
      prev.current = { ...prev.current, suburbKey: selectedSuburbKey, target: "suburb" };
      return;
    }

    if (viewTarget !== prev.current.target) {
      if (viewTarget === "workplace" && workplaceInfo) {
        map.flyTo([workplaceInfo.lat, workplaceInfo.lng], 14, { duration: 2 });
      } else {
        const suburb = suburbs.find((s) => s.suburb_key === selectedSuburbKey);
        if (suburb?.lat && suburb?.lng) {
          map.flyTo([suburb.lat, suburb.lng], 14, { duration: 2 });
        }
      }
      prev.current = { ...prev.current, suburbKey: selectedSuburbKey, target: viewTarget };
    }
  }, [selectedSuburbKey, suburbs, map, viewTarget, workplaceInfo, resetKey]);

  return null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SydneyMapProps {
  suburbs: Suburb[];
  highlighted?: Set<string>;
  filtersActive?: boolean;
  showStations?: boolean;
  stations?: TrainStation[];
  selectedSuburbKey?: string | null;
  workplaceSuburbKey?: string | null;
  workplacePostcode?: string | null;
  onResetView?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const STATION_COLOR = "#7c3aed";
const ACCENT_COLOR = "#f97316";

export default function SydneyMap({
  suburbs,
  highlighted,
  filtersActive = false,
  showStations = true,
  stations = [],
  selectedSuburbKey = null,
  workplaceSuburbKey = null,
  workplacePostcode = null,
  onResetView,
}: SydneyMapProps) {
  const markers = useMemo(() => {
    return suburbs.filter(
      (s) => s.lat != null && s.lng != null && s.median_rent_overall != null,
    );
  }, [suburbs]);

  const selectedSuburb = useMemo(
    () => (selectedSuburbKey ? suburbs.find((s) => s.suburb_key === selectedSuburbKey) ?? null : null),
    [selectedSuburbKey, suburbs],
  );

  const workplaceInfo = useMemo(() => {
    // Prefer suburb key (exact suburb) over postcode (may pick wrong suburb)
    const wp = workplaceSuburbKey
      ? getSuburbByKey(workplaceSuburbKey)
      : workplacePostcode
        ? getSuburbByPostcode(workplacePostcode)
        : null;
    if (!wp?.lat || !wp?.lng) return null;
    return { name: wp.suburb_name ?? wp.postcode, lat: wp.lat, lng: wp.lng };
  }, [workplaceSuburbKey, workplacePostcode]);

  const [viewTarget, setViewTarget] = useState<"suburb" | "workplace">("suburb");
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    setViewTarget("suburb");
  }, [selectedSuburbKey]);

  const handleResetMap = () => {
    onResetView?.();
    setViewTarget("suburb");
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

  // Commute line data
  const commuteLineData = useMemo(() => {
    if (!selectedSuburbKey || (!workplaceSuburbKey && !workplacePostcode)) return null;

    const selSub = suburbs.find((s) => s.suburb_key === selectedSuburbKey);
    if (!selSub?.lat || !selSub?.lng) return null;

    const wpSub = workplaceSuburbKey
      ? getSuburbByKey(workplaceSuburbKey)
      : workplacePostcode
        ? getSuburbByPostcode(workplacePostcode)
        : null;
    if (!wpSub?.lat || !wpSub?.lng) return null;

    const suburbStation = getNearestStation(selSub.lat, selSub.lng);
    const workStation = getNearestStation(wpSub.lat, wpSub.lng);
    if (!suburbStation || !workStation) return null;

    if (suburbStation.station.name === workStation.station.name) return null;

    const stationDist = haversineKm(
      suburbStation.station.lat,
      suburbStation.station.lng,
      workStation.station.lat,
      workStation.station.lng,
    );
    const commuteMin = Math.max(5, Math.round(stationDist * 2.5));

    return {
      suburbStation,
      workStation,
      suburbName: selSub.suburb_name ?? selSub.postcode,
      workplaceName: wpSub.suburb_name ?? wpSub.postcode,
      commuteMin,
      positions: [
        [suburbStation.station.lat, suburbStation.station.lng] as [number, number],
        [workStation.station.lat, workStation.station.lng] as [number, number],
      ],
    };
  }, [selectedSuburbKey, workplaceSuburbKey, workplacePostcode, suburbs]);

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
          selectedSuburbKey={selectedSuburbKey}
          suburbs={suburbs}
          viewTarget={viewTarget}
          workplaceInfo={workplaceInfo}
          resetKey={resetKey}
        />

        {/* Suburb markers */}
        {markers.map((s) => {
          const rent = s.median_rent_overall!;
          const color = rentColor(rent);
          const radius = circleRadius(s.total_bonds);
          const isHighlighted = highlighted?.has(s.suburb_key);
          const isSelected = s.suburb_key === selectedSuburbKey;
          const isDimmed = filtersActive && !isHighlighted && !isSelected;

          return (
            <CircleMarker
              key={s.suburb_key}
              center={[s.lat!, s.lng!]}
              radius={isSelected ? radius * 2 : isDimmed ? radius * 0.7 : radius}
              pathOptions={{
                color: isSelected ? ACCENT_COLOR : isHighlighted ? "#1e3a5f" : isDimmed ? "#94a3b8" : color,
                weight: isSelected ? 3 : isHighlighted ? 3 : isDimmed ? 0.5 : 1.5,
                fillColor: isSelected ? ACCENT_COLOR : isDimmed ? "#94a3b8" : color,
                fillOpacity: isSelected ? 0.9 : isHighlighted ? 0.9 : isDimmed ? 0.15 : 0.55,
              }}
            >
              <Tooltip direction="top" offset={[0, -radius]} opacity={0.95}>
                <span className="text-xs font-semibold">
                  {s.suburb_name ?? s.postcode}
                </span>
                <br />
                <span className="text-xs">${rent}/wk</span>
              </Tooltip>

              {!isSelected && (
                <Popup>
                  <div className="min-w-[180px] text-sm leading-relaxed">
                    <p className="text-base font-bold text-slate-900">
                      {s.suburb_name ?? "Unknown"}
                    </p>
                    <p className="text-xs text-slate-400">{s.postcode}</p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                      <span className="text-slate-500">Median rent</span>
                      <span className="font-semibold">${rent}/wk</span>
                      {s.median_rent_1bed != null && (
                        <>
                          <span className="text-slate-500">1-bed</span>
                          <span>${s.median_rent_1bed}/wk</span>
                        </>
                      )}
                      {s.median_rent_2bed != null && (
                        <>
                          <span className="text-slate-500">2-bed</span>
                          <span>${s.median_rent_2bed}/wk</span>
                        </>
                      )}
                      {s.median_rent_3bed != null && (
                        <>
                          <span className="text-slate-500">3-bed</span>
                          <span>${s.median_rent_3bed}/wk</span>
                        </>
                      )}
                      {s.median_household_income_weekly != null && (
                        <>
                          <span className="text-slate-500">Median income</span>
                          <span>${s.median_household_income_weekly}/wk</span>
                        </>
                      )}
                      <span className="text-slate-500">Bonds</span>
                      <span>{s.total_bonds.toLocaleString("en-AU")}</span>
                    </div>
                    {Object.keys(s.dwelling_types).length > 0 && (
                      <p className="mt-2 text-xs text-slate-400">
                        {Object.entries(s.dwelling_types)
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

        {/* Pulsing marker + popup for selected suburb */}
        {selectedSuburb && selectedSuburb.lat != null && selectedSuburb.lng != null && (
          <Marker
            position={[selectedSuburb.lat, selectedSuburb.lng]}
            icon={pulseIcon}
            zIndexOffset={1000}
            eventHandlers={{
              add: (e) => {
                setTimeout(() => e.target.openPopup(), 1600);
              },
            }}
          >
            <Popup offset={[0, -8]}>
              <div className="min-w-[160px] text-sm leading-relaxed">
                <p className="text-base font-bold text-slate-900">
                  {selectedSuburb.suburb_name ?? selectedSuburb.postcode}
                </p>
                <p className="text-xs text-slate-400">{selectedSuburb.postcode}</p>
                {selectedSuburb.median_rent_overall != null && (
                  <p className="mt-1 text-sm font-semibold" style={{ color: "#1e3a5f" }}>
                    ${selectedSuburb.median_rent_overall}/wk median rent
                  </p>
                )}
                <p className="mt-0.5 text-xs text-slate-500">
                  {selectedSuburb.total_bonds.toLocaleString("en-AU")} rental bonds
                </p>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Workplace diamond marker — always visible */}
        {workplaceInfo && (
          <Marker
            position={[workplaceInfo.lat, workplaceInfo.lng]}
            icon={workplaceIcon}
            zIndexOffset={900}
          >
            <Tooltip
              permanent
              direction="right"
              offset={[12, 0]}
              className="workplace-tooltip"
            >
              <span>{"\ud83c\udfe2"} Your Workplace</span>
            </Tooltip>
          </Marker>
        )}

        {/* Commute connection line + endpoint station markers */}
        {commuteLineData && (
          <>
            <Polyline
              positions={commuteLineData.positions}
              pathOptions={{
                color: "#3b82f6",
                dashArray: "10, 10",
                weight: 3,
                opacity: 0.7,
              }}
            >
              <Tooltip permanent direction="center" className="commute-tooltip">
                <span>~{commuteLineData.commuteMin} min</span>
              </Tooltip>
            </Polyline>

            <CircleMarker
              center={commuteLineData.positions[0]}
              radius={8}
              pathOptions={{
                color: "#fff",
                weight: 2.5,
                fillColor: "#8b5cf6",
                fillOpacity: 0.95,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                <span className="text-xs font-semibold">
                  {commuteLineData.suburbStation.station.name}
                </span>
              </Tooltip>
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-slate-900">
                    {commuteLineData.suburbStation.station.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Nearest to {commuteLineData.suburbName}
                    {" \u00b7 "}{commuteLineData.suburbStation.distanceKm} km walk
                  </p>
                </div>
              </Popup>
            </CircleMarker>

            <CircleMarker
              center={commuteLineData.positions[1]}
              radius={8}
              pathOptions={{
                color: "#fff",
                weight: 2.5,
                fillColor: "#8b5cf6",
                fillOpacity: 0.95,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                <span className="text-xs font-semibold">
                  {commuteLineData.workStation.station.name}
                </span>
              </Tooltip>
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-slate-900">
                    {commuteLineData.workStation.station.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Nearest to {commuteLineData.workplaceName}
                    {" \u00b7 "}{commuteLineData.workStation.distanceKm} km walk
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          </>
        )}

        {/* Train station markers */}
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
                  {st.type === "ferry" ? "Ferry" : st.type === "metro" ? "Metro" : st.type === "light_rail" ? "Light Rail" : "Train"} —{" "}
                  {st.lines.join(", ")}
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
          onClick={handleResetMap}
          className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-md backdrop-blur-sm transition-colors hover:bg-white hover:text-primary"
          title="Reset to full Sydney view"
        >
          {/* Home icon (inline SVG) */}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
          >
            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
          </svg>
          Reset
        </button>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Selection controls — top-right */}
      {/* ---------------------------------------------------------------- */}
      {selectedSuburbKey && (
        <div className="pointer-events-none absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2">
          {/* Toggle suburb ↔ workplace */}
          {workplaceInfo && (
            <button
              onClick={() => setViewTarget((v) => (v === "suburb" ? "workplace" : "suburb"))}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-blue-200 bg-white/95 px-4 py-2 text-xs font-semibold text-blue-600 shadow-md backdrop-blur-sm transition-colors hover:bg-blue-50"
            >
              {viewTarget === "suburb" ? "Show Workplace \u2192" : "\u2190 Show Suburb"}
            </button>
          )}

          {/* View indicator badge */}
          <div className="pointer-events-none rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur-sm">
            {viewTarget === "suburb"
              ? `\ud83d\udccd ${selectedSuburb?.suburb_name ?? selectedSuburbKey}`
              : `\ud83c\udfe2 ${workplaceInfo?.name ?? workplacePostcode}`}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Legend — bottom-left */}
      {/* ---------------------------------------------------------------- */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-[1000]">
        <div className="pointer-events-auto rounded-lg border border-slate-200 bg-white/95 px-3 py-2.5 shadow-md backdrop-blur-sm">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Median Weekly Rent
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
                <span className="text-xs text-slate-600">Train station</span>
              </div>
            )}
            {workplaceInfo && (
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
