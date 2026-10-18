// PlateAdvectionLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, units } from "./math";
import { buildTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";
import { rebuild } from "./surface";

export function plateAdvection(map: PhysicalField, context: PhysicalContext) {
  const p = context.Profile;
  const decay = (p.PlateDriftDecay / 1000) ** Math.max(0, context.EpochIndex);
  const step = map.mesh.contentRadius * (p.PlateDriftPerEpoch / 1000) * decay;
  map.AdvectionSourceIndex.fill(-1);
  map.ConvergentCrustSurplus.fill(0);
  map.LastPlateDriftStep = step;
  if (step <= 0) return;
  const plan = buildTransportPlan(map, step);
  transportHistory(map, plan);
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustThickness[i] = clamp(map.CrustThickness[i], units(800), units(8000));
    map.AdvectionSourceIndex[i] = plan.dominant[i];
    rebuild(map, i);
  }
  map.AccumulatedPlateDrift += step;
}
