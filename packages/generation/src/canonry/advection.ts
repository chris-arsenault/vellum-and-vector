// PlateAdvectionLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, units } from "./math";
import { buildTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";
import { rebuild } from "./surface";
import { nearestTriangle } from "./mesh";

function movePoint(map: PhysicalField, x: number, y: number, distance: number): [number, number] {
  const i = nearestTriangle(map.mesh, x, y);
  return i < 0
    ? [x, y]
    : [x + (map.CrustMotionX[i] / 1000) * distance, y + (map.CrustMotionY[i] / 1000) * distance];
}

export function plateAdvection(map: PhysicalField, context: PhysicalContext) {
  const p = context.Profile;
  const decay = (p.PlateDriftDecay / 1000) ** Math.max(0, context.EpochIndex);
  const step = p.PlateDriftPerEpoch * decay;
  map.AdvectionSourceIndex.fill(-1);
  map.ConvergentCrustSurplus.fill(0);
  map.LastPlateDriftStep = step;
  if (step <= 0) return;
  for (const event of map.events)
    if (event.kind !== "plume") [event.x, event.y] = movePoint(map, event.x, event.y, step);
  for (const fault of map.faults)
    fault.coordinates = fault.coordinates.map(([x, y]) => movePoint(map, x, y, step));
  const plan = buildTransportPlan(map, step);
  transportHistory(map, plan);
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustThickness[i] = clamp(map.CrustThickness[i], units(800), units(8000));
    map.AdvectionSourceIndex[i] = plan.dominant[i];
    rebuild(map, i);
  }
  map.AccumulatedPlateDrift += step;
}
