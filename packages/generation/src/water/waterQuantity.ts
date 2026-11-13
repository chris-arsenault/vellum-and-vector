import { ask, respond } from "../coupling/answers";
import type { PhysicalField } from "../world/field";
import type { PhysicalContext } from "../world/context";
import { depthRateToDischarge } from "../world/dimensions";
import { bedLeak, bedLoss } from "./channelLoss";
import { groundPermeability, groundwaterFilled } from "./groundwater";
import { reachesOf, reachAt } from "./riverKeeping";

respond({ key: "waterWithdrawal", by: "surface water", reads: [], base: () => 0 });
respond({ key: "waterTransmission", by: "surface water", reads: [], base: () => 1 });
respond({
  key: "discharge",
  by: "surface water",
  reads: [],
  answers: ["surfaceWater"],
  base: (_map, _cell, context, answer) =>
    answer("surfaceWater") / context.Profile.FluvialReferenceRunoff,
});

/** Intake losses act once on available incoming and local flow, before it travels downstream. */
export function passingWater(received: number, withdrawal: number, transmission: number) {
  return Math.max(0, received - Math.max(0, withdrawal)) * Math.max(0, Math.min(1, transmission));
}

/**
 * What a river loses through its bed crossing each cell, in cubic metres a second, for the
 * flow that reaches the cell: nothing over sea, lake, tight rock or ground already full.
 */
export function channelLosses(map: PhysicalField, context: PhysicalContext) {
  const leak = new Float64Array(map.mesh.count),
    length = new Float64Array(map.mesh.count);
  const permeability = (i: number) =>
    bedLeak(context.Profile.OpenBedSeepage, groundPermeability(map, i), groundwaterFilled(map, i));
  // Unresolved channels retain their aggregate passage loss as a cell quantity.
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0) continue;
    leak[i] = permeability(i);
    length[i] = Math.sqrt(map.mesh.area(i));
  }
  // A resolved river owns its bed response. Routing delivers water through those responses.
  for (const reach of reachesOf(map)) {
    reach.leakage = Float64Array.from(reach.cells, permeability);
  }
  return (cell: number, received: number) => {
    const reach = reachAt(map, cell),
      at = map.rivers.at?.position(cell) ?? 0,
      response = reach ? reach.leakage[at] : leak[cell];
    return bedLoss(received, response, length[cell]);
  };
}
/**
 * Resolve what acts on passing water once for a routing loop; all fluxes are cubic
 * metres/second. The bed takes its share first, then what people draw and hold.
 */
export function waterPassage(map: PhysicalField, context: PhysicalContext) {
  const parts = waterPassageParts(map, context);
  return (cell: number, received: number) => parts(cell, received).passed;
}
/** The same passage, stating what the bed took and what people took of what was received. */
export function waterPassageParts(map: PhysicalField, context: PhysicalContext) {
  const withdrawal = ask(map, "waterWithdrawal", context),
    transmission = ask(map, "waterTransmission", context),
    lost = channelLosses(map, context),
    parts = { passed: 0, bed: 0, drawn: 0 };
  return (cell: number, received: number) => {
    parts.bed = lost(cell, received);
    parts.passed = passingWater(received - parts.bed, withdrawal.get(cell), transmission.get(cell));
    parts.drawn = received - parts.bed - parts.passed;
    return parts;
  };
}

/** Erosion uses reference-runoff area; its routing still passes the same actual water quantity. */
export function referenceWaterPassage(map: PhysicalField, context: PhysicalContext) {
  const pass = waterPassage(map, context),
    unit = depthRateToDischarge(context.Profile.FluvialReferenceRunoff, 1);
  return (cell: number, received: number) => (unit > 0 ? pass(cell, received * unit) / unit : 0);
}
