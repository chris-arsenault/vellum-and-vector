// PlateAdvectionLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { buildTransportPlan, releaseTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";
import { triangleVectorSampler } from "./triangleSampling";
import {
  completeTectonicMotion,
  prepareTectonicMotion,
  tectonicInterval,
} from "./tectonicIntegration";
import { provinceLayout } from "../processes/crustProcesses";
import { runOperation } from "../processOperation";
import { plateTravel } from "./tectonicControls";
import { advectLandmarkDrainage } from "./landmarkTransport";
import { advectGeologicalTrace, geologicalPointMotion } from "./geologicalPointMotion";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { beginReliefCarry, finishReliefCarry } from "./reliefCarry";

function advectGeometry(map: PhysicalField, distance: number) {
  const velocity = triangleVectorSampler(
    map.mesh,
    (i) => map.CrustMotionX.get(i),
    (i) => map.CrustMotionY.get(i),
    { fixed: true }
  );
  const move = geologicalPointMotion(map.mesh, velocity, distance);
  for (const event of map.events)
    if (event.kind !== "plume") [event.x, event.y] = move(event.x, event.y);
  for (const fault of map.faults)
    fault.coordinates = advectGeologicalTrace(map.mesh, fault.coordinates, move);
}

function transportStep(map: PhysicalField, step: number) {
  map.ConvergentCrustSurplus.fill(0);
  advectGeometry(map, step);
  const plan = buildTransportPlan(map, step);
  if (map.transportPlan) releaseTransportPlan(map, map.transportPlan);
  map.transportPlan = plan;
  advectLandmarkDrainage(map, plan, step);
  transportHistory(map, plan);
  for (let i = 0; i < map.mesh.count; i++) map.AdvectionSourceIndex.set(i, plan.dominant.get(i));
}
/** Land this interval before building on it; the next move carries the newly made rock. */
function deformInterval(
  map: PhysicalField,
  context: PhysicalContext,
  myr: number,
  distance: number
) {
  const carry = beginReliefCarry(map);
  transportStep(map, distance);
  finishReliefCarry(map, carry, map.transportPlan!);
  context.AfterPlateStep?.();
  const interval = {
    ...context,
    TectonicDurationMyr: myr,
    Span: (context.Span * myr) / context.TectonicDurationMyr,
  };
  map.LastPlateDriftStep = distance;
  context.DuringPlateStep?.(interval);
}
export function plateAdvection(
  map: PhysicalField,
  context: PhysicalContext,
  afterStep: () => void = () => {}
) {
  const total = plateTravel(context.Profile, context.TectonicDurationMyr, context.PlateTravelShare),
    rate = total / Math.max(1e-9, context.TectonicDurationMyr);
  // From here on the plates carry the crust: what the world first laid out is formed.
  map.CrustFormed = true;
  map.AdvectionSourceIndex.fill(-1);
  map.ConvergentCrustSurplus.fill(0);
  map.OrogenicConstruction.fill(0);
  map.LastPlateDriftStep = total;
  map.OceanicSubduction.fill(0);
  if (total <= 0) return;
  if (!map.tectonics) {
    deformInterval(
      map,
      { ...context, AfterPlateStep: afterStep },
      context.TectonicDurationMyr,
      total
    );
    map.AccumulatedPlateDrift += total;
    return;
  }
  map.tectonics.rate = rate;
  const surplus = workingArray(map, "float64", "advection:surplus");
  let remaining = context.TectonicDurationMyr;
  while (remaining > 1e-9) {
    const myr = tectonicInterval(map, remaining, rate),
      step = rate * myr;
    prepareTectonicMotion(map, myr);
    runOperation(map, provinceLayout.operation, { map, context });
    deformInterval(map, { ...context, AfterPlateStep: afterStep }, myr, step);
    for (let i = 0; i < surplus.length; i++) surplus.add(i, map.ConvergentCrustSurplus.get(i));
    completeTectonicMotion(map, myr, step);
    for (let i = 0; i < map.mesh.count; i++)
      if (map.CrustRiftStrain.get(i) > 0) map.CrustRiftAgeMyr.add(i, myr);
    remaining -= myr;
  }
  map.LastPlateDriftStep = total;
  map.ConvergentCrustSurplus.copyFrom(surplus);
  releaseWorking(map, surplus);
  runOperation(map, provinceLayout.operation, { map, context });
  map.AccumulatedPlateDrift += total;
}
