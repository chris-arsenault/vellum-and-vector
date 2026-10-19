// MassWastingLayer.cs, Canonry 0f62584c: conservative rock-dependent hillslope transport.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { deposit, erode } from "./surface";
import { hillslopeFlux } from "./hillslopeFlux";

export function massWasting(map: PhysicalField, context: PhysicalContext, postFluvial = false) {
  const p = context.Profile;
  const iterations = postFluvial ? p.PostFluvialMassWastingIterations : p.MassWastingIterations;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const { cuts, fills } = hillslopeFlux(map, p);
    for (let i = 0; i < map.mesh.count; i++) {
      if (cuts[i] > 0) {
        erode(map, i, (cuts[i] * 1024) / map.mesh.areas[i]);
        map.SedimentProducedTotal += cuts[i];
      }
      if (fills[i] > 0) deposit(map, i, (fills[i] * 1024) / map.mesh.areas[i]);
    }
  }
}
