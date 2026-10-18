// IceFlowLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { units } from "./math";
import { canCarryIce, refreshGrounding, supportElevation } from "./glacierSurface";
import { saturatingAdd } from "./flowGraph";

function assignTargets(map: PhysicalField, surface: Float64Array) {
  for (let i = 0; i < surface.length; i++) {
    if (!canCarryIce(map, i)) continue;
    let best = -1,
      slope = 0;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j < 0 || surface[j] >= surface[i]) continue;
      const drop = surface[i] - surface[j];
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
  const surface = Float64Array.from(
    { length: map.mesh.count },
    (_, i) => supportElevation(map, i) + units(map.IceThickness[i] / 3)
  );
  map.IceFlux.set(map.IceThickness);
  assignTargets(map, surface);
  const order = Array.from({ length: map.mesh.count }, (_, i) => i).sort(
    (a, b) => surface[b] - surface[a] || a - b
  );
  for (const i of order) {
    const target = map.IceFlowTargets[i];
    if (target >= 0) map.IceFlux[target] = saturatingAdd(map.IceFlux[target], map.IceFlux[i]);
  }
  for (let i = 0; i < map.mesh.count; i++) {
    map.MaximumIceFlux[i] = Math.max(map.MaximumIceFlux[i], map.IceFlux[i]);
    if (map.GroundedIce[i] !== 0)
      map.MaximumGroundedIceFlux[i] = Math.max(map.MaximumGroundedIceFlux[i], map.IceFlux[i]);
  }
}
