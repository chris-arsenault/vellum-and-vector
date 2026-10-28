// IceFlowLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { units } from "./math";
import { canCarryIce, refreshGrounding, supportElevation } from "./glacierSurface";
import { workingValues, releaseWorking } from "./physicalNumerics";
import { radixOrder, type NumericalVector } from "@atlas/domain";

function assignTargets(map: PhysicalField, surface: NumericalVector) {
  for (let i = 0; i < surface.length; i++) {
    if (!canCarryIce(map, i)) continue;
    let best = -1,
      slope = 0;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j < 0 || surface[j] >= surface[i]) continue;
      const drop = (surface[i] - surface[j]) / map.mesh.edgeLength[i * map.mesh.stride + edge];
      if (drop > slope) {
        best = j;
        slope = drop;
      }
    }
    map.IceFlowTargets[i] = best;
  }
}
export function iceFlow(map: PhysicalField, c: PhysicalContext) {
  map.IceFlowTargets.fill(-1);
  refreshGrounding(map, c.Profile);
  const surface = workingValues(
    map,
    "float64",
    "ice:surface",
    (i) => supportElevation(map, i) + units(map.IceThickness[i])
  );
  for (let i = 0; i < map.mesh.count; i++)
    map.IceFlux[i] = (map.IceThickness[i] * map.mesh.areas[i]) / c.Profile.IceTransportYears;
  assignTargets(map, surface);
  const order = radixOrder(surface, true);
  for (const i of order) {
    const target = map.IceFlowTargets[i];
    if (target >= 0) map.IceFlux[target] += map.IceFlux[i];
  }
  for (let i = 0; i < map.mesh.count; i++) {
    map.MaximumIceFlux[i] = Math.max(map.MaximumIceFlux[i], map.IceFlux[i]);
    if (map.GroundedIce[i] !== 0)
      map.MaximumGroundedIceFlux[i] = Math.max(map.MaximumGroundedIceFlux[i], map.IceFlux[i]);
  }
  releaseWorking(map, surface, order);
}
