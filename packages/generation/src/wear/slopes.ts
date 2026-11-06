// MassWastingLayer.cs, Canonry 0f62584c: conservative rock-dependent hillslope transport.
import type { PhysicalProfile } from "../canonry/profile";
import { releaseWorking } from "../canonry/physicalNumerics";
import { deposit, erode } from "../canonry/surface";
import { hillslopeFlux } from "./slopeFlux";
import type { WearProcess, WearWork } from "./wearContract";

/** Ground too steep to hold fails and comes to rest on its neighbours, so nothing leaves the slope. */
function failSlopes({ map, settings }: WearWork, iterations: number) {
  for (let iteration = 0; iteration < iterations; iteration++) {
    const { cuts, fills } = hillslopeFlux(map, settings);
    for (let i = 0; i < map.mesh.count; i++) {
      const cut = cuts.get(i),
        fill = fills.get(i),
        area = map.mesh.area(i);
      if (cut > 0) {
        erode(map, i, (cut * 1024) / area);
        map.SedimentProducedTotal += cut;
      }
      if (fill > 0) deposit(map, i, (fill * 1024) / area);
    }
    releaseWorking(map, cuts, fills);
  }
}
const slopeProcess = (
  id: string,
  iterations: (settings: PhysicalProfile) => number
): WearProcess => ({
  id,
  statement:
    "Where the step between cells is steeper than the ground can hold over one hillslope, it fails and sheds what the rock and its cover let go.",
  wear: (work) => failSlopes(work, iterations(work.settings)),
});
export const slopes = slopeProcess("slopes", (settings) => settings.MassWastingIterations);
export const slopesAfterStreams = slopeProcess(
  "slopes-after-streams",
  (settings) => settings.PostFluvialMassWastingIterations
);
