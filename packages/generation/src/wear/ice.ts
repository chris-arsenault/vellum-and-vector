// GlacialErosionLayer, Canonry 0f62584c.
import { refreshGrounding } from "../canonry/glacierSurface";
import { units } from "../canonry/math";
import type { WearProcess } from "./wearContract";
import { wearAway } from "./wearLedger";

export const ice: WearProcess = {
  id: "ice",
  statement:
    "Grounded ice that flows hard enough cuts its bed by its flux and thickness, up to what it can move, and the ground decides how much of that it gives up.",
  wear({ map, context: c, settings: p, ground }) {
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
        (1 + (p.ChargedIceErosion / 1000) * map.IceCharge.get(i));
      const moved = Math.min(
          (power * p.GlacialCutPerPower * c.GlaciationStrength) / (p.GlacialYield * 1000),
          p.MaximumGlacialErosionPerPass
        ),
        cut = units(Math.max(1 / 1024, ground.iceTakes(i, moved)));
      wearAway(map, i, cut);
      map.CumulativeGlacialErosion.add(i, cut);
    }
    refreshGrounding(map, p);
  },
};
