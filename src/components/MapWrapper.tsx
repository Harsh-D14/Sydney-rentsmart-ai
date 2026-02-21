"use client";

import dynamic from "next/dynamic";
import type { Suburb } from "@/lib/suburbs";
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

interface MapWrapperProps {
  suburbs: Suburb[];
  highlighted?: Set<string>;
  filtersActive?: boolean;
  showStations?: boolean;
  selectedSuburbKey?: string | null;
  workplaceSuburbKey?: string | null;
  workplacePostcode?: string | null;
  onResetView?: () => void;
}

export default function MapWrapper({
  suburbs,
  highlighted,
  filtersActive,
  showStations = true,
  selectedSuburbKey,
  workplaceSuburbKey,
  workplacePostcode,
  onResetView,
}: MapWrapperProps) {
  return (
    <SydneyMap
      suburbs={suburbs}
      highlighted={highlighted}
      filtersActive={filtersActive}
      showStations={showStations}
      stations={showStations ? stations : []}
      selectedSuburbKey={selectedSuburbKey}
      workplaceSuburbKey={workplaceSuburbKey}
      workplacePostcode={workplacePostcode}
      onResetView={onResetView}
    />
  );
}
