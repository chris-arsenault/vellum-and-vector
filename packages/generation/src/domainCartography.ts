import { ecologyEpochSchema } from "@atlas/domain";
import { choice, type CartographicControl } from "./cartographicControls";

export const domainCartography: Record<string, CartographicControl> = {
  "ecology.living": {
    id: "living-landscape",
    label: "Living landscape",
    section: "environment",
    initialOnly: true,
    defaultChoice: "mosaic",
    explanation:
      "Vegetation, seasonal stress, fire and browsing respond together to water and climate. Isolated or recently disturbed ground still needs time to recover.",
    choices: ["Dry and sparse", "Seasonally open country", "Wooded mosaic", "Humid woodland"].map(
      (label, index) =>
        choice(["dry", "open", "mosaic", "humid"][index], label, {
          "physical.climate": { settings: { rainfall: [0.07, 1, 1, 2][index] } },
          "ecology.living": {
            settings: {
              vegetation: [0.8, 0.9, 1.5, 2.5][index],
              grazing: [0.8, 1.4, 0.5, 0.1][index],
            },
            configuration: {
              landscape: ecologyEpochSchema.parse({
                seasonality: [0.3, 0.65, 0.3, 0.2][index],
                fire: [0.5, 2, 1, 0.35][index],
                recovery: [1, 1, 2, 3][index],
              }),
            },
          },
        })
    ),
  },
  "human.cultures": {
    id: "cultural-pattern",
    label: "Cultural pattern",
    section: "people",
    initialOnly: true,
    defaultChoice: "overlapping",
    explanation:
      "Distinct concentrations or broader overlapping prevalence. These fields do not prescribe political borders or simulate migration routes.",
    choices: ["Distinct centers", "Overlapping regions", "Broad mixture"].map((label, index) =>
      choice(["distinct", "overlapping", "mixed"][index], label, {
        "human.cultures": {
          settings: { cultureCount: [3, 6, 9][index] },
          configuration: {
            eras: [
              { id: "Settlement", years: [50, 200, 800][index], mobility: [0.25, 1, 1.5][index] },
            ],
          },
        },
      })
    ),
  },
  "human.politics": {
    id: "political-pattern",
    label: "Political pattern",
    section: "people",
    defaultChoice: "regional",
    explanation:
      "The scale and density of territorial partitions, independently of cultural prevalence.",
    choices: ["Broad territories", "Regional states", "Many small territories"].map(
      (label, index) =>
        choice(["broad", "regional", "small"][index], label, {
          "human.politics": { settings: { polityCount: [3, 7, 14][index] } },
        })
    ),
  },
};
