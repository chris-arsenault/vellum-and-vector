import { compileMix } from "../rock/modes";
import { defineProcess } from "./groundProcess";
import { weatheringSettings } from "./weatheringSettings";

/** Water and frost open rock along its joints and take what dissolves. */
const breakingDown = compileMix({ plucking: 0.5, solution: 0.5 });
export const weathering = defineProcess({
  id: "weathering",
  statement:
    "Water, warmth and frost turn rock into loose cover, fastest on wet ground and slower under a deep mantle, which shields what is beneath it.",
  reads: ["WaterKindCodes"],
  asks: ["wetness", "warmth", "frost"],
  moves: [["rock", "loose"]],
  settings: weatheringSettings,
  // A region's passes refine one stretch of the world's history; they do not add more of it.
  atScale: (settings, { passes }) => ({ WeatheringPerSpan: settings.WeatheringPerSpan / passes }),
  run({ field, context: c, settings: p, span, ask, stage }) {
    const wetness = ask("wetness"),
      warmth = ask("warmth"),
      frost = ask("frost");
    for (let i = 0; i < field.mesh.count; i++) {
      if (field.WaterKindCodes.get(i) !== 0) continue;
      const driven = wetness.get(i) * warmth.get(i) + frost.get(i),
        power = (driven * p.WeatheringPerSpan * span * c.HydrologyStrength) / 1000;
      stage.weatherAction(i, breakingDown, power, p.WeatheringShieldDepth, "weathering");
    }
  },
});
