// MassWastingLayer.cs, Canonry 0f62584c: conservative rock-dependent hillslope transport.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { deposit, erode } from "./surface";
import { hillslopeFlux } from "./hillslopeFlux";
import { releaseWorking } from "./physicalNumerics";

export function massWasting(map: PhysicalField, context: PhysicalContext, postFluvial = false) {
  const p = context.Profile;
  const iterations = postFluvial ? p.PostFluvialMassWastingIterations : p.MassWastingIterations;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const { cuts, fills } = hillslopeFlux(map, p);
    for (let i = 0; i < map.mesh.count; i++) {
      const cut = cuts.get(i),
        fill = fills.get(i),
        area = map.mesh.area(i);
      if (cut > 0) {
        erode(map, i, (cut * 1024) / area);
        map.SedimentProducedTotal += cut;
      }
      if (fill > 0) deposit(map, i, (fill * 1024) / area);
    }
    releaseWorking(map, cuts, fills);
  }
}
