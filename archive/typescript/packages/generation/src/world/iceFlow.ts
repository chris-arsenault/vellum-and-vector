// IceFlowLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { units } from "./math";
import { canCarryIce, refreshGrounding, supportElevation } from "./glacierSurface";
import { workingValues, releaseWorking } from "./physicalNumerics";
import type { Band } from "@atlas/domain";

function assignTargets(map: PhysicalField, surface: Band) {
  for (let i = 0; i < surface.length; i++) {
    if (!canCarryIce(map, i)) continue;
    let best = -1,
      slope = 0;
    const here = surface.get(i);
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0) continue;
      const there = surface.get(j);
      if (there >= here) continue;
      const drop = (here - there) / map.mesh.edgeLength(i, edge);
      if (drop > slope) {
        best = j;
        slope = drop;
      }
    }
    map.IceFlowTargets.set(i, best);
  }
}
export function iceFlow(map: PhysicalField, c: PhysicalContext) {
  map.IceFlowTargets.fill(-1);
  refreshGrounding(map, c.Profile);
  const surface = workingValues(
    map,
    "float64",
    "ice:surface",
    (i) => supportElevation(map, i) + units(map.IceThickness.get(i))
  );
  for (let i = 0; i < map.mesh.count; i++)
    map.IceFlux.set(i, (map.IceThickness.get(i) * map.mesh.area(i)) / c.Profile.IceTransportYears);
  assignTargets(map, surface);
  for (const i of map.coverage.order(surface, true)) {
    const target = map.IceFlowTargets.get(i);
    if (target >= 0) map.IceFlux.add(target, map.IceFlux.get(i));
  }
  for (let i = 0; i < map.mesh.count; i++) {
    const flux = map.IceFlux.get(i);
    map.MaximumIceFlux.set(i, Math.max(map.MaximumIceFlux.get(i), flux));
    if (map.GroundedIce.get(i) !== 0)
      map.MaximumGroundedIceFlux.set(i, Math.max(map.MaximumGroundedIceFlux.get(i), flux));
  }
  releaseWorking(map, surface);
}
