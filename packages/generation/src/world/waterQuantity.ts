import { ask, respond } from "../coupling/answers";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { depthRateToDischarge } from "./dimensions";

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

/** Resolve maintained influences once for a routing loop; all fluxes are cubic metres/second. */
export function waterPassage(map: PhysicalField, context: PhysicalContext) {
  const withdrawal = ask(map, "waterWithdrawal", context),
    transmission = ask(map, "waterTransmission", context);
  return (cell: number, received: number) =>
    passingWater(received, withdrawal.get(cell), transmission.get(cell));
}

/** Erosion uses reference-runoff area; its routing still passes the same actual water quantity. */
export function referenceWaterPassage(map: PhysicalField, context: PhysicalContext) {
  const pass = waterPassage(map, context),
    unit = depthRateToDischarge(context.Profile.FluvialReferenceRunoff, 1);
  return (cell: number, received: number) => (unit > 0 ? pass(cell, received * unit) / unit : 0);
}
