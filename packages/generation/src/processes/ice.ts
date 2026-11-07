// GlacialErosionLayer, Canonry 0f62584c.
import type { WearCause } from "../coupling/wearStage";
import { compileMix } from "../rock/modes";
import { defineProcess } from "./groundProcess";
import { iceSettings } from "./iceSettings";

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
  asks: ["iceBite"],
  moves: [
    ["rock", "load"],
    ["loose", "load"],
  ],
  settings: iceSettings,
  run({ field, context: c, settings: p, ground, span, ask, wear, tools }) {
    const bite = ask("iceBite");
    for (let i = 0; i < field.mesh.count; i++) {
      if (c.GlaciationStrength === 0 || field.GroundedIce.get(i) === 0) continue;
      const speed = tools.iceSpeed(i);
      // Ice frozen to its bed never reaches here.
      if (speed <= p.GlacierFrozenSpeed) continue;
      const moved =
        ((speed * p.GlacialCutPerSpeed * span * c.GlaciationStrength) / 1000) * bite.get(i);
      wear.demand(scouring, i, ground.actOn(i, glacial, moved, tools.iceCanCut(i, p)));
    }
    wear.settle();
    tools.refreshGrounding(p);
  },
});
