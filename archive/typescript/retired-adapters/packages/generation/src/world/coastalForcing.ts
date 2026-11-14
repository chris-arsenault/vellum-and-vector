import { respond } from "../coupling/answers";
import { bindOperation, defineQuery } from "../processOperation";
import { currents, oceanRead } from "../processes/climateProcesses";
import type { PhysicalInput } from "../processes/groundProcess";
import type { GenerationState } from "../process";
import { sampleCoastalPressure } from "./atlasForcing";
import { magicCoastalFeedback } from "./magicFeedback";
import { clamp, round } from "./math";

/** Offshore fields are retained inputs; receiving shores follow the current ocean geometry. */
export const coastalForcing = defineQuery<PhysicalInput>(
  "coastal-forcing",
  ({ map }) => map.ExternalCoastalForcing.fill(0),
  [oceanRead.operation, currents.operation]
);

export function bindCoastalForcing(state: GenerationState) {
  const map = state.physical!.map;
  bindOperation(map, coastalForcing, () => {
    for (let i = 0; i < map.mesh.count; i++)
      map.ExternalCoastalForcing.set(
        i,
        map.WaterKindCodes.get(i) === 0
          ? round(clamp(sampleCoastalPressure(state, i) * 1000, 0, 1000))
          : 0
      );
    if (state.physical!.magic) magicCoastalFeedback(state);
  });
}

respond({
  key: "coastalForcing",
  by: "external waves",
  reads: ["ExternalCoastalForcing"],
  queries: [coastalForcing],
  base: (map, cell) => map.ExternalCoastalForcing.get(cell),
});
