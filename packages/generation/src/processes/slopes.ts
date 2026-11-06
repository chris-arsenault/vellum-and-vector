// MassWastingLayer.cs, Canonry 0f62584c: conservative rock-dependent hillslope transport.
import type { PhysicalProfile } from "../canonry/profile";
import { releaseWorking } from "../canonry/physicalNumerics";
import { settle, shed } from "../rock/groundLedger";
import type { GroundProcess, ProcessWork } from "./groundProcess";
import { hillslopeFlux } from "./slopeFlux";
import { slopeSettings } from "./slopeSettings";

/** Ground too steep to hold fails and comes to rest on its neighbours, so nothing leaves the slope. */
function failSlopes({ map, settings }: ProcessWork, iterations: number) {
  for (let iteration = 0; iteration < iterations; iteration++) {
    const { cuts, fills } = hillslopeFlux(map, settings);
    for (let i = 0; i < map.mesh.count; i++) {
      if (cuts.get(i) > 0) shed(map, i, cuts.get(i));
      if (fills.get(i) > 0) settle(map, i, fills.get(i));
    }
    releaseWorking(map, cuts, fills);
  }
}
const slopeProcess = (
  id: string,
  iterations: (settings: PhysicalProfile) => number
): GroundProcess => ({
  id,
  statement:
    "Where the step between cells is steeper than the ground can hold over one hillslope, it fails and sheds what the ground lets go.",
  settings: slopeSettings,
  run: (work) => failSlopes(work, iterations(work.settings)),
});
export const slopes = slopeProcess("slopes", (settings) => settings.MassWastingIterations);
export const slopesAfterStreams = slopeProcess(
  "slopes-after-streams",
  (settings) => settings.PostFluvialMassWastingIterations
);
