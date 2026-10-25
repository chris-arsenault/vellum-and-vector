// PlateAdvectionLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, maximumCrustThickness, minimumCrustThickness, units } from "./math";
import { buildTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";
import { rebuild } from "./surface";
import { physicalSampler } from "./physicalMetric";
import { meshDeltaX, meshPoint } from "./mesh";

function advectGeometry(map: PhysicalField, distance: number) {
  const vx = physicalSampler(map.mesh, map.CrustMotionX),
    vy = physicalSampler(map.mesh, map.CrustMotionY);
  const move = (x: number, y: number): [number, number] =>
    meshPoint(map.mesh, x + (vx(x, y) / 1000) * distance, y + (vy(x, y) / 1000) * distance);
  for (const event of map.events)
    if (event.kind !== "plume") [event.x, event.y] = move(event.x, event.y);
  for (const fault of map.faults) {
    const result: [number, number][] = [];
    fault.coordinates.forEach((b, index) => {
      if (index === 0) return;
      const a = fault.coordinates[index - 1],
        dx = meshDeltaX(map.mesh, b[0] - a[0]),
        count = Math.ceil(Math.hypot(dx, b[1] - a[1]) / (map.mesh.spacing / 4));
      for (let station = 0; station < count; station++) {
        const fraction = station / count;
        result.push(move(a[0] + dx * fraction, a[1] + (b[1] - a[1]) * fraction));
      }
    });
    if (fault.coordinates.length) result.push(move(...fault.coordinates.at(-1)!));
    fault.coordinates = result;
  }
}

export function plateAdvection(map: PhysicalField, context: PhysicalContext) {
  const p = context.Profile;
  const decay = (p.PlateDriftDecay / 1000) ** Math.max(0, context.EpochIndex);
  const step = p.PlateDriftPerEpoch * decay;
  map.AdvectionSourceIndex.fill(-1);
  map.ConvergentCrustSurplus.fill(0);
  map.LastPlateDriftStep = step;
  if (step <= 0) return;
  advectGeometry(map, step);
  const plan = buildTransportPlan(map, step);
  map.transportPlan = plan;
  transportHistory(map, plan);
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustThickness[i] = clamp(
      map.CrustThickness[i],
      units(minimumCrustThickness),
      units(maximumCrustThickness)
    );
    map.AdvectionSourceIndex[i] = plan.dominant[i];
    rebuild(map, i);
  }
  map.AccumulatedPlateDrift += step;
}
