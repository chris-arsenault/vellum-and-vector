import { ask, respond } from "../coupling/answers";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { depthRateToDischarge } from "./dimensions";
import { bedLeak, bedLoss } from "./channelLoss";
import { groundPermeability, groundwaterFilled } from "./groundwater";

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
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0) continue;
    leak[i] = bedLeak(
      context.Profile.OpenBedSeepage,
      groundPermeability(map, i),
      groundwaterFilled(map, i)
    );
    length[i] = Math.sqrt(map.mesh.area(i));
  }
  return (cell: number, received: number) => bedLoss(received, leak[cell], length[cell]);
}
/**
 * Resolve what acts on passing water once for a routing loop; all fluxes are cubic
 * metres/second. The bed takes its share first, then what people draw and hold.
 */
export function waterPassage(map: PhysicalField, context: PhysicalContext) {
  const withdrawal = ask(map, "waterWithdrawal", context),
    transmission = ask(map, "waterTransmission", context),
    lost = channelLosses(map, context);
  return (cell: number, received: number) =>
    passingWater(received - lost(cell, received), withdrawal.get(cell), transmission.get(cell));
}

/** Erosion uses reference-runoff area; its routing still passes the same actual water quantity. */
export function referenceWaterPassage(map: PhysicalField, context: PhysicalContext) {
  const pass = waterPassage(map, context),
    unit = depthRateToDischarge(context.Profile.FluvialReferenceRunoff, 1);
  return (cell: number, received: number) => (unit > 0 ? pass(cell, received * unit) / unit : 0);
}
