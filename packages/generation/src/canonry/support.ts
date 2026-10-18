// CrustalSupportLayer.cs and LithosphericFlexureLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, crustHeight, ratio, toUnits, units } from "./math";
import { rebuild } from "./surface";

export function crustalSupport(map: PhysicalField, context: PhysicalContext, includeIce: boolean) {
  const p = context.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const fraction = map.CrustContinentalFraction[i] / 1000;
    const airy = units(crustHeight(toUnits(map.CrustThickness[i]), fraction));
    const subsidence = units(
      (((1 - fraction) * map.CrustAge[i]) / 1000) * p.OceanicSubsidenceDepth
    );
    let load =
      ratio(map.SurfaceRockLoad[i], p.BedrockLoadResponsePerMille, 1000) +
      ratio(map.SedimentThickness[i], p.SedimentLoadResponsePerMille, 1000);
    if (includeIce && map.GroundedIce[i] !== 0)
      load += ratio(units(map.IceThickness[i]), p.IceLoadResponsePerMille, 1000);
    map.CrustSupportTarget[i] = clamp(airy - subsidence - load, units(-4000), units(4000));
  }
}
function relaxed(map: PhysicalField, current: Float64Array, i: number, relaxation: number): number {
  let total = 0,
    count = 0;
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[i * 3 + edge];
    if (j >= 0) {
      total += current[j];
      count++;
    }
  }
  if (count === 0) return current[i];
  return current[i] + Math.trunc(((Math.trunc(total / count) - current[i]) * relaxation) / 1000);
}
export function lithosphericFlexure(map: PhysicalField, context: PhysicalContext) {
  const p = context.Profile;
  let current = map.CrustSupportTarget.slice(),
    next = new Float64Array(current.length);
  for (let iteration = 0; iteration < p.LithosphericFlexureIterations; iteration++) {
    for (let i = 0; i < current.length; i++)
      next[i] = relaxed(map, current, i, p.LithosphericFlexureRelaxationPerMille);
    [current, next] = [next, current];
  }
  for (let i = 0; i < current.length; i++) {
    if (!map.CrustSupportInitialized) {
      map.CrustSupportElevation[i] = current[i];
      continue;
    }
    const old = map.CrustSupportElevation[i],
      shift = current[i] - old;
    const bedrock = clamp(
      map.BedrockElevation[i] + shift,
      units(-4000),
      units(4000) - map.SedimentThickness[i]
    );
    map.CrustSupportElevation[i] = old + bedrock - map.BedrockElevation[i];
    map.BedrockElevation[i] = bedrock;
    rebuild(map, i);
  }
  map.CrustSupportInitialized = true;
}
