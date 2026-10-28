// PlateAdvectionLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, maximumCrustThickness, minimumCrustThickness, units } from "./math";
import { buildTransportPlan, releaseTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";
import { rebuild } from "./surface";
import { physicalSampler } from "./physicalMetric";
import { meshLineDelta, meshPoint } from "./mesh";
import {
  completeTectonicMotion,
  prepareTectonicMotion,
  tectonicInterval,
} from "./tectonicIntegration";
import { tectonicProvinces } from "./provinces";
import { tectonicReferenceMyr } from "./tectonicControls";
import { advectLandmarkDrainage } from "./landmarkTransport";
import { geologicalPointMotion } from "./geologicalPointMotion";
import { workingArray, releaseWorking } from "./physicalNumerics";

function advectGeometry(map: PhysicalField, distance: number) {
  const vx = physicalSampler(map.mesh, map.CrustMotionX),
    vy = physicalSampler(map.mesh, map.CrustMotionY);
  let maximumSpeed = 0;
  for (let i = 0; i < map.mesh.count; i++)
    maximumSpeed = Math.max(
      maximumSpeed,
      Math.hypot(map.CrustMotionX.get(i), map.CrustMotionY.get(i))
    );
  const move = geologicalPointMotion(map.mesh, vx, vy, distance, maximumSpeed);
  for (const event of map.events)
    if (event.kind !== "plume") [event.x, event.y] = move(event.x, event.y);
  for (const fault of map.faults) {
    const result: [number, number][] = [];
    fault.coordinates.forEach((b, index) => {
      if (index === 0) return;
      const a = fault.coordinates[index - 1],
        [dx, dy] = meshLineDelta(map.mesh, a, b),
        count = Math.ceil(Math.hypot(dx, dy) / (map.mesh.spacing / 4));
      for (let station = 0; station < count; station++) {
        const fraction = station / count;
        result.push(move(...meshPoint(map.mesh, a[0] + dx * fraction, a[1] + dy * fraction)));
      }
    });
    if (fault.coordinates.length) result.push(move(...fault.coordinates.at(-1)!));
    fault.coordinates = result;
  }
}

function transportStep(map: PhysicalField, step: number) {
  map.ConvergentCrustSurplus.fill(0);
  advectGeometry(map, step);
  const plan = buildTransportPlan(map, step);
  if (map.transportPlan) releaseTransportPlan(map, map.transportPlan);
  map.transportPlan = plan;
  advectLandmarkDrainage(map, plan, step);
  transportHistory(map, plan);
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustThickness.set(
      i,
      clamp(map.CrustThickness.get(i), units(minimumCrustThickness), units(maximumCrustThickness))
    );
    map.AdvectionSourceIndex.set(i, plan.dominant.get(i));
    rebuild(map, i);
  }
}
export function plateAdvection(
  map: PhysicalField,
  context: PhysicalContext,
  afterStep: () => void = () => {}
) {
  const rate = context.Profile.PlateDriftPerEpoch / tectonicReferenceMyr,
    total = rate * context.TectonicDurationMyr;
  map.AdvectionSourceIndex.fill(-1);
  map.ConvergentCrustSurplus.fill(0);
  map.LastPlateDriftStep = total;
  map.OceanicSubduction.fill(0);
  if (total <= 0) return;
  if (!map.tectonics) {
    transportStep(map, total);
    afterStep();
    map.AccumulatedPlateDrift += total;
    return;
  }
  const surplus = workingArray(map, "float64", "advection:surplus"),
    evolved = { ...context, IsEvolutionEpoch: true };
  let remaining = context.TectonicDurationMyr;
  while (remaining > 1e-9) {
    const myr = tectonicInterval(map, remaining, rate),
      step = rate * myr;
    prepareTectonicMotion(map, myr);
    tectonicProvinces(map, evolved);
    transportStep(map, step);
    afterStep();
    for (let i = 0; i < surplus.length; i++) surplus.add(i, map.ConvergentCrustSurplus.get(i));
    completeTectonicMotion(map, myr, step);
    for (let i = 0; i < map.mesh.count; i++)
      if (map.CrustRiftStrain.get(i) > 0) map.CrustRiftAgeMyr.add(i, myr);
    remaining -= myr;
  }
  map.ConvergentCrustSurplus.copyFrom(surplus);
  releaseWorking(map, surplus);
  tectonicProvinces(map, evolved);
  map.AccumulatedPlateDrift += total;
}
