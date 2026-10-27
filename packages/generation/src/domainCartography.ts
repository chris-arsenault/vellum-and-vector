import { ecologyEpochSchema } from "@atlas/domain";
import { choice, type CartographicControl } from "./cartographicControls";
import type { FeatureSelection } from "./features";
import { defaultHumanEras } from "./generationSettings";

/**
 * The human era schedule an age ends in: the bound rounds, then the first `settled` present
 * eras of the default history, the last of them stretched by `stretch`. Each alternative is
 * the complete schedule, so an edited era shows the control as Custom. Political capacity
 * stays with the imported setting so an authored value is operative.
 */
function age(settled: number, stretch = 1): FeatureSelection {
  const eras = defaultHumanEras(),
    present = eras.filter((era) => !era.physicalEpoch).slice(0, settled);
  const last = present.at(-1);
  if (last) last.years = Math.round(last.years * stretch);
  return {
    "human.cultures": {
      configuration: {
        eras: [...eras.filter((era) => era.physicalEpoch), ...present].map(
          ({ id, years, mobility, physicalEpoch }) => ({ id, years, mobility, physicalEpoch })
        ),
      },
    },
  };
}
const cultures = (cultureCount: number, culturalMobility: number): FeatureSelection => ({
  "human.cultures": { settings: { cultureCount, culturalMobility } },
});
const polities = (polityCount: number, politicalReach: number): FeatureSelection => ({
  "human.politics": { settings: { polityCount, politicalReach } },
});
const towns = (townThreshold: number, cityReach: number): FeatureSelection => ({
  "built.layout": { settings: { townThreshold, cityReach } },
});
const roads = (roadTraffic: number, marketTravel: number, highways: number): FeatureSelection => ({
  "built.layout": { settings: { roadTraffic, marketTravel, highways } },
});

export const domainCartography = {
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
  "human.cultures": [
    {
      id: "age",
      label: "Age of the world",
      section: "people",
      initialOnly: true,
      defaultChoice: "lantern",
      explanation:
        "How far the settled history runs before the present: hearths and chiefdoms, crowned realms, or lantern-lit cities. A longer age fills the land, gathers cities from their hinterlands and wears the ways into roads; the ice-age round before it stays.",
      choices: [
        choice("hearth", "Hearth age", age(1)),
        choice("crowns", "Age of crowns", age(2)),
        choice("lantern", "Lantern age", age(3)),
        choice("long", "Long lantern age", age(3, 2)),
      ],
    },
    {
      id: "cultural-pattern",
      label: "Cultural pattern",
      section: "people",
      initialOnly: true,
      defaultChoice: "overlapping",
      explanation:
        "Distinct concentrations or broader overlapping prevalence: how many identities begin and how far contact carries them. These fields do not prescribe political borders or simulate migration routes.",
      choices: [
        choice("distinct", "Distinct centers", cultures(3, 0.5)),
        choice("overlapping", "Overlapping regions", cultures(6, 1)),
        choice("mixed", "Broad mixture", cultures(9, 1.5)),
      ],
    },
  ],
  "human.politics": [
    {
      id: "political-pattern",
      label: "Political pattern",
      section: "people",
      defaultChoice: "regional",
      explanation:
        "The scale and density of territorial partitions, independently of cultural prevalence: how many seats begin and how far each can hold.",
      choices: [
        choice("broad", "Broad territories", polities(3, 1.3)),
        choice("regional", "Regional states", polities(7, 1)),
        choice("small", "Many small territories", polities(14, 0.8)),
      ],
    },
  ],
  "built.layout": [
    {
      id: "towns",
      label: "Towns and cities",
      section: "people",
      defaultChoice: "cities",
      explanation:
        "What settlement the map shows: many market towns, towns with a few cities drawing their hinterlands, or great cities gathering whole regions. Places below the World town size stay latent for finer maps.",
      choices: [
        choice("markets", "Market towns", towns(2500, 120)),
        choice("cities", "Towns and cities", towns(5000, 200)),
        choice("great", "Great cities", towns(10000, 300)),
      ],
    },
    {
      id: "roads",
      label: "Roads and travel",
      section: "people",
      defaultChoice: "markets",
      explanation:
        "How readily use makes ways: tracks and fords between neighbours, roads worn between markets, or a realm's highways raised where its busiest roads cross open country.",
      choices: [
        choice("tracks", "Tracks and fords", roads(2000, 0.5, 0)),
        choice("markets", "Roads between markets", roads(1000, 1, 2)),
        choice("highways", "Highways of the realm", roads(500, 2, 4)),
      ],
    },
  ],
} satisfies Record<string, CartographicControl | CartographicControl[]>;
