import { atlasParameterDefinitions } from "./atlasParameters";
import type { GenerationFeature } from "./features";
import type { MapProcess, ProcessSequence } from "./process";
import { culturalProcess, politicalProcess } from "./mapPeople";
import { builtProcess } from "./mapBuilt";

function present(process: MapProcess, slot: string): ProcessSequence {
  return slot === "present.people"
    ? [
        {
          kind: "process",
          id: process.contract.id,
          process: process.contract.id,
          version: process.contract.version,
        },
      ]
    : [];
}
export const domainFeatureDefinitions: GenerationFeature[] = [
  {
    id: "ecology.living",
    label: "Living ecology",
    presentation: {
      stage: "environment",
      family: "Living ecology",
      order: 150,
      summary:
        "Establish living communities, advance ecological responses through the shared epochs and classify the present without adding age.",
      settingConsumers: {
        vegetation: ["atlas.ecology-evolve", "atlas.ecology-respond"],
        grazing: ["atlas.ecology-evolve", "atlas.ecology-respond"],
      },
      inheritedElapsed: "preserve-age",
      initialOnlySettings: ["vegetation", "grazing"],
    },
    domains: ["physical", "magic"],
    defaultEnabled: true,
    settings: {
      vegetation: atlasParameterDefinitions.vegetation,
      grazing: atlasParameterDefinitions.grazing,
    },
    processes: ["initialize", "evolve", "respond", "burial", "present"].map(
      (name) => `atlas.ecology-${name}`
    ),
    requires: ["physical.climate"],
    contribute: () => [],
  },
  {
    id: "magic.configured",
    label: "Configured magical systems",
    presentation: {
      stage: "magic",
      family: "Causal influences",
      order: 10,
      summary:
        "Configure sources, propagation, physical and ecological effects, classification rules and activity on the shared epochs.",
    },
    domains: ["magic"],
    defaultEnabled: true,
    settings: {},
    processes: [
      "initialize",
      "climate",
      "rocks",
      "post-glacial",
      "coast",
      "history",
      "classify",
      "project",
    ].map((name) => `canonry.magic-${name}`),
    contribute: () => [],
  },
  {
    id: "magic.local",
    label: "Located magical sources",
    presentation: {
      stage: "magic",
      family: "Causal influences",
      order: 20,
      summary:
        "Apply existing located sources to climate and material; this choice does not create new sources.",
      requiresLocatedSources: true,
    },
    domains: ["magic"],
    defaultEnabled: true,
    settings: {},
    processes: ["magic.thermal", "magic.material", "magic.advanceStorage", "magic.advection"],
    contribute: () => [],
  },
  {
    id: "human.cultures",
    label: "Cultural distributions",
    presentation: {
      stage: "people",
      family: "Distributions and places",
      order: 10,
      summary:
        "Seed cultures and evolve their distributions using cultural duration, mobility and the physical setting.",
    },
    domains: ["cultural"],
    defaultEnabled: true,
    settings: { cultureCount: atlasParameterDefinitions.cultureCount },
    processes: [culturalProcess.contract.id],
    contribute: (slot) => present(culturalProcess, slot),
  },
  {
    id: "human.politics",
    label: "Political territories",
    presentation: {
      stage: "people",
      family: "Distributions and places",
      order: 20,
      summary: "Generate political territories independently of the cultural distribution choice.",
    },
    domains: ["political"],
    defaultEnabled: true,
    settings: { polityCount: atlasParameterDefinitions.polityCount },
    processes: [politicalProcess.contract.id],
    contribute: (slot) => present(politicalProcess, slot),
  },
  {
    id: "built.layout",
    label: "Built geography",
    presentation: {
      stage: "people",
      family: "Distributions and places",
      order: 30,
      summary:
        "Produce settlements and roads at broad scales, buildings at sites, and rooms and connections within interiors.",
      publicationProfiles: {
        settlements: ["world", "region", "local"],
        roads: ["world", "region", "local"],
        structures: ["site", "interior"],
      },
    },
    domains: ["built"],
    defaultEnabled: true,
    settings: {},
    processes: [builtProcess.contract.id],
    contribute: (slot) => present(builtProcess, slot),
  },
];
