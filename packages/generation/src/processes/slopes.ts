import { defineProcess, type GroundProcess, type ProcessWork } from "./groundProcess";
import { slopeSettings } from "./slopeSettings";

/**
 * Ground too steep to hold fails and comes to rest on its neighbours, so nothing leaves the slope. It
 * goes on until the ground stands, which takes a moment against any span here, so how much fails comes
 * from how steep things are and not from a count of rounds. The rounds stop once a round moves little
 * next to the first, or at a numerical bound. Each round lands before the next looks at the slopes.
 */
function failSlopes(
  { field, settings, tools, stage }: Pick<ProcessWork, "field" | "settings" | "tools" | "stage">,
  id: string
) {
  const mesh = field.mesh;
  let first = 0;
  for (let round = 0; round < settings.SlopeRoundsAtMost; round++) {
    const { cuts, fills } = tools.slopeFailure(settings);
    let moved = 0;
    for (let i = 0; i < mesh.count; i++) {
      if (cuts.get(i) > 0) {
        stage.demand("rock", "load", i, (cuts.get(i) * 1024) / mesh.area(i), id);
        moved += cuts.get(i);
      }
      if (fills.get(i) > 0)
        stage.demand("load", "loose", i, (fills.get(i) * 1024) / mesh.area(i), id);
    }
    tools.release(cuts, fills);
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
    settlesItself: true,
    run: (work) => failSlopes(work, id),
  });
export const slopes = slopeProcess("slopes");
export const slopesAfterStreams = slopeProcess("slopes-after-streams");
