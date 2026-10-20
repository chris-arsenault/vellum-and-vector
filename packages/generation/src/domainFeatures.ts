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
    domains: ["magic"],
    defaultEnabled: true,
    settings: {},
    processes: ["magic.thermal", "magic.material", "magic.advanceStorage", "magic.advection"],
    contribute: () => [],
  },
  {
    id: "human.cultures",
    label: "Cultural distributions",
    domains: ["cultural"],
    defaultEnabled: true,
    settings: { cultureCount: atlasParameterDefinitions.cultureCount },
    processes: [culturalProcess.contract.id],
    contribute: (slot) => present(culturalProcess, slot),
  },
  {
    id: "human.politics",
    label: "Political territories",
    domains: ["political"],
    defaultEnabled: true,
    settings: { polityCount: atlasParameterDefinitions.polityCount },
    processes: [politicalProcess.contract.id],
    contribute: (slot) => present(politicalProcess, slot),
  },
  {
    id: "built.layout",
    label: "Located buildings and interiors",
    domains: ["built"],
    defaultEnabled: true,
    settings: {},
    processes: [builtProcess.contract.id],
    contribute: (slot) => present(builtProcess, slot),
  },
];
