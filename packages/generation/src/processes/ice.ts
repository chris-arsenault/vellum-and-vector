// GlacialErosionLayer, Canonry 0f62584c.
import { refreshGrounding } from "../canonry/glacierSurface";
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
    "Grounded ice that flows hard enough plucks and grinds its bed by its flux and thickness, more where charge weakens the bed.",
  reads: ["IceFlux", "IceThickness", "GroundedIce", "IceCharge"],
  asks: [],
  moves: [
    ["rock", "load"],
    ["loose", "load"],
  ],
  settings: iceSettings,
  run({ field, context: c, settings: p, ground, span, wear, world }) {
    for (let i = 0; i < field.mesh.count; i++) {
      const flux = field.IceFlux.get(i),
        thickness = field.IceThickness.get(i);
      if (
        c.GlaciationStrength === 0 ||
        flux < p.GlacierFluxThreshold ||
        thickness <= 0 ||
        field.GroundedIce.get(i) === 0
      )
        continue;
      // Charge in sliding ice weakens the bed it touches; cold-based ice never reaches here.
      const power =
          (1 +
            (flux - p.GlacierFluxThreshold) / Math.max(1, p.GlacierFluxThreshold) +
            thickness / Math.max(1, p.GlacierThicknessThreshold)) *
          (1 + (p.ChargedIceErosion / 1000) * field.IceCharge.get(i)),
        moved =
          (power * p.GlacialCutPerPower * span * c.GlaciationStrength) / (p.GlacialYield * 1000);
      wear.demand(scouring, i, ground.actOn(i, glacial, moved, Infinity));
    }
    wear.settle();
    refreshGrounding(world, p);
  },
});
