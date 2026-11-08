import type { WearCause } from "../coupling/stage";
import { compileMix } from "../rock/modes";
import { defineProcess } from "./groundProcess";
import { iceSettings } from "./iceSettings";
import { iceCanCut, refreshGrounding, slidingSpeed } from "../world/glacierSurface";
import type { PhysicalProfile } from "../world/profile";

/** Ice pulls blocks out along joints, and grinds with what it carries. */
const glacial = compileMix({ plucking: 0.7, abrasion: 0.3 });
/** Ice can carve below the sea: that is what a fjord is. */
const scouring: WearCause = {
  id: "ice",
  remembers: "CumulativeGlacialErosion",
  pastBaseLevel: true,
};
export const ice = defineProcess({
  id: "ice",
  statement:
    "Grounded ice plucks and grinds its bed by how fast it slides and how hard it bites, until it floats or its surface has no fall left to drive it.",
  reads: ["GroundedIce"],
  needs: ["Elevation", "RockKindCodes", "IceFlux", "IceFlowTargets", "IceThickness"],
  provides: ["Elevation", "BedrockElevation", "SedimentSupply"],
  asks: ["iceBite"],
  moves: [
    ["rock", "load"],
    ["loose", "load"],
  ],
  settings: iceSettings,
  prepare: (map) => ({
    iceSpeed: (i: number) => slidingSpeed(map, i),
    iceCanCut: (i: number, settings: PhysicalProfile) => iceCanCut(map, i, settings),
    refreshGrounding: (settings: PhysicalProfile) => refreshGrounding(map, settings),
  }),
  settlesItself: true,
  run({ field, context: c, settings: p, span, ask, stage, tools }) {
    const bite = ask("iceBite");
    for (let i = 0; i < field.mesh.count; i++) {
      if (c.GlaciationStrength === 0 || field.GroundedIce.get(i) === 0) continue;
      const speed = tools.iceSpeed(i);
      // Ice frozen to its bed never reaches here.
      if (speed <= p.GlacierFrozenSpeed) continue;
      const moved =
        ((speed * p.GlacialCutPerSpeed * span * c.GlaciationStrength) / 1000) * bite.get(i);
      stage.attack(scouring, i, glacial, moved, tools.iceCanCut(i, p));
    }
    stage.settle();
    tools.refreshGrounding(p);
  },
});
