import { clamp, units } from "../canonry/math";
import type { WearProcess } from "./wearContract";
import { recordCut } from "./wearLedger";

export const solution: WearProcess = {
  id: "solution",
  statement:
    "Water takes soluble rock wherever it runs, valley or not: limestone, salt and tufa all go this way.",
  // A region's passes refine one stretch of the world's history; they do not add more of it.
  atScale: (settings, { passes }) => ({ DissolvedPerPass: settings.DissolvedPerPass / passes }),
  wear({ map, context: c, settings: p, ground }) {
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.WaterKindCodes.get(i) === 1) continue;
      const soluble = ground.kind(i).solubility,
        wet = clamp(map.Runoff.get(i) / p.DissolvedFullRunoff, 0, 1),
        cut = units((p.DissolvedPerPass * soluble * wet * c.HydrologyStrength) / 1000),
        above = map.Elevation.get(i) - (map.EffectiveSeaLevel + units(1));
      if (cut > 0 && above > 0) recordCut(map, i, Math.min(cut, above));
    }
  },
};
