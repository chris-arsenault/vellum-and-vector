import { compileMix } from "../rock/modes";
import { defineProcess } from "./groundProcess";
import { solutionSettings } from "./solutionSettings";

const dissolving = compileMix({ solution: 1 });
export const solution = defineProcess({
  id: "solution",
  statement:
    "Water takes soluble rock wherever it runs, valley or not: limestone, salt and tufa all go this way, and granite does not.",
  reads: ["WaterKindCodes"],
  asks: ["wetness"],
  moves: [["rock", "load"]],
  settings: solutionSettings,
  // A region's passes refine one stretch of the world's history; they do not add more of it.
  forExecution: (settings, { passes }) => ({
    DissolvedPerSpan: settings.DissolvedPerSpan / passes,
  }),
  run({ field, context: c, settings: p, span, ask, stage }) {
    const wetness = ask("wetness");
    for (let i = 0; i < field.mesh.count; i++) {
      if (field.WaterKindCodes.get(i) === 1) continue;
      stage.attack(
        dissolved,
        i,
        dissolving,
        (p.DissolvedPerSpan * span * wetness.get(i) * c.HydrologyStrength) / 1000,
        Infinity
      );
    }
  },
});
const dissolved = { id: "solution", remembers: "CumulativeFluvialErosion" } as const;
