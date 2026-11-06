import { clamp, units } from "../canonry/math";
import { recordCut } from "../rock/groundLedger";
import { compileMix } from "../rock/modes";
import type { GroundProcess } from "./groundProcess";
import { solutionSettings } from "./solutionSettings";

const dissolving = compileMix({ solution: 1 });
export const solution: GroundProcess = {
  id: "solution",
  statement:
    "Water takes soluble rock wherever it runs, valley or not: limestone, salt and tufa all go this way.",
  settings: solutionSettings,
  // A region's passes refine one stretch of the world's history; they do not add more of it.
  atScale: (settings, { passes }) => ({ DissolvedPerPass: settings.DissolvedPerPass / passes }),
  run({ map, context: c, settings: p, ground }) {
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.WaterKindCodes.get(i) === 1) continue;
      const wet = clamp(map.Runoff.get(i) / p.DissolvedFullRunoff, 0, 1),
        above = map.Elevation.get(i) - (map.EffectiveSeaLevel + units(1));
      if (above <= 0) continue;
      const cut = ground.actOn(
        i,
        dissolving,
        (p.DissolvedPerPass * wet * c.HydrologyStrength) / 1000,
        above
      );
      if (cut > 0) recordCut(map, i, cut);
    }
  },
};
