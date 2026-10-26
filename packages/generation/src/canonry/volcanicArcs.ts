import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { nearestTriangle, meshDeltaX, meshPoint } from "./mesh";
import { clamp, elevationLimit, units } from "./math";
import { rebuild } from "./surface";
import { Feature } from "./codes";
import { tectonicArcMeltShare, tectonicArcOffset, tectonicArcRadius } from "./tectonicControls";

function overridingSide(map: PhysicalField, cell: number) {
  const state = map.tectonics;
  if (!state) return null;
  const pair = map.TectonicBoundaryPairIds[cell],
    a = state.sites[(pair >>> 16) - 1],
    b = state.sites[(pair & 0xffff) - 1];
  if (!a || !b || a.plate === b.plate) return null;
  const ai = nearestTriangle(map.mesh, a.x, a.y),
    bi = nearestTriangle(map.mesh, b.x, b.y);
  if (ai < 0 || bi < 0) return null;
  // Continental buoyancy takes priority; at ocean/ocean contacts the younger side overrides.
  const score = (i: number) => map.CrustContinentalFraction[i] * 2 - map.CrustAge[i];
  const sign = score(ai) >= score(bi) ? -1 : 1,
    dx = meshDeltaX(map.mesh, b.x - a.x),
    dy = b.y - a.y,
    length = Math.max(1, Math.hypot(dx, dy));
  return [(sign * dx) / length, (sign * dy) / length];
}
function footprint(map: PhysicalField, x: number, y: number) {
  const root = nearestTriangle(map.mesh, x, y);
  if (root < 0) return [];
  const queue = [root],
    seen = new Set(queue),
    targets: { cell: number; weight: number }[] = [];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head],
      distance = Math.hypot(meshDeltaX(map.mesh, map.mesh.x[i] - x), map.mesh.y[i] - y);
    const weight = Math.max(0, 1 - distance / tectonicArcRadius) ** 2;
    if (weight > 0) targets.push({ cell: i, weight: weight * map.mesh.areas[i] });
    if (distance > tectonicArcRadius + map.mesh.spacing) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j >= 0 && !seen.has(j)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  // An unresolved front contributes its area-averaged volume, never an invented island polygon.
  return targets.length ? targets : [{ cell: root, weight: map.mesh.areas[root] }];
}
function erupt(map: PhysicalField, context: PhysicalContext, i: number, height: number) {
  const uplift = Math.max(
    0,
    Math.min(height, units(elevationLimit) - map.SedimentThickness[i] - map.BedrockElevation[i])
  );
  map.BedrockElevation[i] += uplift;
  map.SurfaceRockLoad[i] += uplift;
  map.VolcanicConstructionHistory[i] += uplift;
  map.VolcanicActivity[i] = Math.max(map.VolcanicActivity[i], clamp(uplift / 1024, 0, 1000));
  map.VolcanicLastActiveEpoch[i] = Math.max(0, context.EpochIndex);
  map.FractureConductance[i] = Math.max(map.FractureConductance[i], map.VolcanicActivity[i]);
  map.FeatureFlags[i] |= Feature.VolcanicCone;
  rebuild(map, i);
}
/** Melt follows actual oceanic consumption, on the overriding side, independently of plumes. */
export function subductionArcs(map: PhysicalField, context: PhysicalContext) {
  const added = new Float64Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.OceanicSubduction[i] <= 0) continue;
    const normal = overridingSide(map, i);
    if (!normal) continue;
    const [x, y] = meshPoint(
      map.mesh,
      map.mesh.x[i] + normal[0] * tectonicArcOffset,
      map.mesh.y[i] + normal[1] * tectonicArcOffset
    );
    const targets = footprint(map, x, y),
      total = targets.reduce((sum, target) => sum + target.weight, 0);
    const volume = map.OceanicSubduction[i] * map.mesh.areas[i] * tectonicArcMeltShare;
    for (const target of targets)
      added[target.cell] += (volume * target.weight) / (total * map.mesh.areas[target.cell]);
  }
  for (let i = 0; i < map.mesh.count; i++) if (added[i] > 0) erupt(map, context, i, added[i]);
  map.OceanicSubduction.fill(0);
}
