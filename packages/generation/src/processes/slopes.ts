// MassWastingLayer.cs, Canonry 0f62584c: conservative rock-dependent hillslope transport.
import { defineProcess, type GroundProcess, type ProcessWork } from "./groundProcess";
import { slopeSettings } from "./slopeSettings";

/**
 * Ground too steep to hold fails and comes to rest on its neighbours, so nothing leaves the slope. It
 * goes on until the ground stands, which takes a moment against any span here, so how much fails comes
 * from how steep things are and not from a count of rounds. The rounds stop once a round moves little
 * next to the first, or at a numerical bound.
 */
function failSlopes({ field, settings, tools }: Pick<ProcessWork, "field" | "settings" | "tools">) {
  let first = 0;
  for (let round = 0; round < settings.SlopeRoundsAtMost; round++) {
    const { cuts, fills } = tools.slopeFailure(settings);
    let moved = 0;
    for (let i = 0; i < field.mesh.count; i++) {
      if (cuts.get(i) > 0) {
        tools.shed(i, cuts.get(i), "slopes");
        moved += cuts.get(i);
      }
      if (fills.get(i) > 0) tools.settle(i, fills.get(i));
    }
    tools.release(cuts, fills);
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
    asks: [],
    moves: [
      ["rock", "loose"],
      ["loose", "loose"],
    ],
    settings: slopeSettings,
    run: (work) => failSlopes(work),
  });
export const slopes = slopeProcess("slopes");
export const slopesAfterStreams = slopeProcess("slopes-after-streams");
