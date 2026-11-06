// GlacialErosionLayer, Canonry 0f62584c.
import { refreshGrounding } from "../canonry/glacierSurface";
import { wearAway } from "../rock/groundLedger";
import { compileMix } from "../rock/modes";
import type { GroundProcess } from "./groundProcess";
import { iceSettings } from "./iceSettings";

/** Ice pulls blocks out along joints, and grinds with what it carries. */
const glacial = compileMix({ plucking: 0.7, abrasion: 0.3 });
export const ice: GroundProcess = {
  id: "ice",
  statement:
    "Grounded ice that flows hard enough plucks and grinds its bed by its flux and thickness, up to what it can move, through loose cover and into the rock.",
  settings: iceSettings,
  run({ map, context: c, settings: p, ground }) {
    for (let i = 0; i < map.mesh.count; i++) {
      const flux = map.IceFlux.get(i),
        thickness = map.IceThickness.get(i);
      if (
        c.GlaciationStrength === 0 ||
        flux < p.GlacierFluxThreshold ||
        thickness <= 0 ||
        map.GroundedIce.get(i) === 0
      )
        continue;
      // Charge in sliding ice weakens the bed it touches; cold-based ice never reaches here.
      const power =
          (1 +
            (flux - p.GlacierFluxThreshold) / Math.max(1, p.GlacierFluxThreshold) +
            thickness / Math.max(1, p.GlacierThicknessThreshold)) *
          (1 + (p.ChargedIceErosion / 1000) * map.IceCharge.get(i)),
        moved = Math.min(
          (power * p.GlacialCutPerPower * c.GlaciationStrength) / (p.GlacialYield * 1000),
          p.MaximumGlacialErosionPerPass
        ),
        cut = Math.max(1, ground.actOn(i, glacial, moved, Infinity));
      wearAway(map, i, cut);
      map.CumulativeGlacialErosion.add(i, cut);
    }
    refreshGrounding(map, p);
  },
};
