"use client";

import dynamic from "next/dynamic";
import type { TrainStation } from "@/lib/commute";
import stationData from "@/data/train_stations.json";

const SydneyMap = dynamic(() => import("./SydneyMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-xl bg-slate-100">
      <div className="flex flex-col items-center gap-2 text-slate-400">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <span className="text-sm">Loading map...</span>
      </div>
    </div>
  ),
});

const stations = stationData as TrainStation[];
const NO_STATIONS: TrainStation[] = [];

/**
 * One circle on the map. Deliberately a small local shape rather than the
 * server-side Suburb type, so the map never pulls the suburb dataset into the
 * browser bundle.
 */
export interface MapPoint {
  key: string;            // unique; suburb_key
  postcode: string;
  name: string;           // display name
  names?: string[];       // other suburb names covered
  lat: number;
  lng: number;
  rent: number;           // weekly rent shown and used for colour
  bonds: number;          // used for circle size
  lowSample?: boolean;
  rent1bed?: number | null;
  rent2bed?: number | null;
  rent3bed?: number | null;
  medianIncome?: number | null;   // AREA median household income, never the user's
  dwellingTypes?: Record<string, number>;
}

export interface MapWrapperProps {
  points: MapPoint[];
  highlighted?: Set<string>;      // MapPoint keys
  filtersActive?: boolean;
  showStations?: boolean;         // default true
  selectedKey?: string | null;
  workplace?: { name: string; lat: number; lng: number } | null;
  route?: [number, number][] | null;   // optional routed geometry [lat,lng] to draw between selected point and workplace
  rentLabel?: string;             // what MapPoint.rent is; default "Median rent"
  onResetView?: () => void;
}

export default function MapWrapper({
  points,
  highlighted,
  filtersActive,
  showStations = true,
  selectedKey,
  workplace,
  route,
  rentLabel,
  onResetView,
}: MapWrapperProps) {
  return (
    <SydneyMap
      points={points}
      highlighted={highlighted}
      filtersActive={filtersActive}
      showStations={showStations}
      stations={showStations ? stations : NO_STATIONS}
      selectedKey={selectedKey}
      workplace={workplace}
      route={route}
      rentLabel={rentLabel}
      onResetView={onResetView}
    />
  );
}
