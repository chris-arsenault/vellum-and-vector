import type { Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { gatherDown } from "../world/flowGraph";
import { physicalDistance } from "../world/physicalMetric";
import { releaseWorking, workingValues } from "../world/physicalNumerics";

/**
 * ADR 0005: latent quantities force finer realization. Gather the captured channel length
 * before choosing heads; an amount smaller than one actual route edge remains unresolved.
 * Water and catchment significance still decide whether the resulting course is a river.
 */
export function channelOrigins(map: PhysicalField, order: Band, captured: Pick<Band, "get">) {
  const length = workingValues(map, "float64", "river:latent-length", (cell) => captured.get(cell)),
    heads = new Uint8Array(map.mesh.count);
  gatherDown(order, map.FlowTargets, length);
  for (let cell = 0; cell < heads.length; cell++) {
    const next = map.FlowTargets.get(cell);
    heads[cell] = Number(next >= 0 && length.get(cell) >= physicalDistance(map.mesh, cell, next));
  }
  releaseWorking(map, length);
  return heads;
}
