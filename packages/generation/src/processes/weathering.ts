import { compileMix } from "../rock/modes";
import { weatherRock } from "../rock/groundLedger";
import { defineProcess } from "./groundProcess";
import { slopeSettings } from "./slopeSettings";

/** Water and frost open rock along its joints and take what dissolves. */
const breakingDown = compileMix({ plucking: 0.5, solution: 0.5 });
export const weathering = defineProcess({
  id: "weathering",
  statement:
    "Water, warmth and frost turn rock into loose cover, fastest on wet ground and slower under a deep mantle, which shields what is beneath it.",
  reads: ["WaterKindCodes", "SedimentThickness"],
  asks: ["wetness", "warmth", "frost"],
  moves: [["rock", "loose"]],
  settings: slopeSettings,
  run({ field, context: c, settings: p, ground, span, ask, world }) {
    const wetness = ask("wetness"),
      warmth = ask("warmth"),
      frost = ask("frost");
    for (let i = 0; i < field.mesh.count; i++) {
      if (field.WaterKindCodes.get(i) !== 0) continue;
      const mantle = field.SedimentThickness.get(i) / 1024,
        shield = Math.exp(-mantle / p.WeatheringShieldDepth),
        driven = wetness.get(i) * warmth.get(i) + frost.get(i);
      const made = ground.gives(i, breakingDown) * driven * shield * p.WeatheringPerSpan * span;
      if (made > 0) weatherRock(world, i, (made * 1024 * c.HydrologyStrength) / 1000, "weathering");
    }
  },
});
