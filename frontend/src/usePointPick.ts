import { useState } from "react";
import type { Inspection, MapFeature } from "@atlas/map";

export interface PointPick {
  inspection: Inspection;
  at: { x: number; y: number };
}
/** What the user chose from the point menu: one feature, or the cell's numerical substrate. */
export type PointChoice = { feature: MapFeature } | { substrate: true };

/** A click only lists what is there; `show` runs when one item is chosen. */
export function usePointPick(show: (feature: MapFeature | null, cell: Inspection | null) => void) {
  const [pick, setPick] = useState<PointPick | null>(null);
  return {
    pick,
    cancel: () => setPick(null),
    inspect: (inspection: Inspection, at: PointPick["at"]) => setPick({ inspection, at }),
    choose: (picked: PointPick, choice: PointChoice) => {
      setPick(null);
      if ("feature" in choice) show(choice.feature, null);
      else show(null, picked.inspection);
    },
  };
}
