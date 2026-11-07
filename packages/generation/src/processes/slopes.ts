import { defineProcess, type GroundProcess, type ProcessWork } from "./groundProcess";
import { slopeSettings } from "./slopeSettings";
import { hillslopeFlux } from "./slopeFlux";
import type { PhysicalField } from "../world/field";
import type { PhysicalProfile } from "../world/profile";

const prepare = (map: PhysicalField) => ({
  slopeFailure: (settings: PhysicalProfile) => hillslopeFlux(map, settings),
});

/**
 * Ground too steep to hold fails and comes to rest on its neighbours, so nothing leaves the slope. It
 * goes on until the ground stands, which takes a moment against any span here, so how much fails comes
 * from how steep things are and not from a count of rounds. The rounds stop once a round moves little
 * next to the first, or at a numerical bound. Each round lands before the next looks at the slopes.
 */
function failSlopes(
  { settings, tools, stage }: ProcessWork<"Elevation", never, ReturnType<typeof prepare>>,
  id: string
) {
  let first = 0;
  for (let round = 0; round < settings.SlopeRoundsAtMost; round++) {
    const routes = tools.slopeFailure(settings);
    let moved = 0;
    while (routes.size) {
      const source = routes.shift(),
        target = routes.field(0),
        volume = routes.field(1);
      stage.moveSurface(source, target, volume, id);
      moved += volume;
    }
    stage.settle();
    first ||= moved;
    if (moved <= first * settings.SlopeRoundsSettled) return;
  }
}
const slopeProcess = (id: string): GroundProcess =>
  defineProcess({
    id,
    statement:
      "Where the step between cells is steeper than the ground can hold over one hillslope, it fails until it stands, and what falls rests on its neighbours.",
    reads: ["Elevation"],
    needs: ["Elevation", "RockKindCodes"],
    provides: ["Elevation", "BedrockElevation", "SedimentThickness"],
    asks: ["rootHold"],
    moves: [
      ["rock", "load"],
      ["load", "loose"],
    ],
    settings: slopeSettings,
    prepare,
    settlesItself: true,
    run: (work) => failSlopes(work, id),
  });
export const slopes = slopeProcess("slopes");
export const slopesAfterStreams = slopeProcess("slopes-after-streams");
