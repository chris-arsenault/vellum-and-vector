import type { Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { releaseWorking, workingValues } from "../world/physicalNumerics";
import { flowThroughYear } from "./waterBalance";

/** Captured boundary supplies are ordinary water-owner inputs on any map. */
export interface BoundaryRivers {
  incoming?: Band;
  catchment?: Band;
  monthly?: Band[];
}

export function withBoundaryFlow(map: PhysicalField, read: (incoming: Band | undefined) => void) {
  if (!map.rivers.entries.length) return read(undefined);
  const incoming = workingValues(map, "float64", "water:boundary-mean", () => 0);
  for (const entry of map.rivers.entries)
    incoming.add(entry.cell, flowThroughYear(entry.monthly, 0).mean);
  try {
    read(incoming);
  } finally {
    releaseWorking(map, incoming);
  }
}

export function withBoundaryRivers(map: PhysicalField, read: (input: BoundaryRivers) => void) {
  if (!map.rivers.entries.length) return read({});
  withBoundaryFlow(map, (incoming) => {
    const catchment = workingValues(map, "float64", "water:boundary-catchment", () => 0),
      monthly = Array.from({ length: 12 }, (_, month) => {
        const band = workingValues(map, "float64", `water:boundary-month-${month}`, () => 0);
        for (const entry of map.rivers.entries) band.add(entry.cell, entry.monthly[month]);
        return band;
      });
    for (const entry of map.rivers.entries) catchment.add(entry.cell, entry.catchment);
    try {
      read({ incoming, catchment, monthly });
    } finally {
      releaseWorking(map, catchment, ...monthly);
    }
  });
}
