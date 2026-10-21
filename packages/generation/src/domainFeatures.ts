import { atlasParameterDefinitions } from "./atlasParameters";
import type { GenerationFeature } from "./features";
import type { MapProcess, ProcessSequence } from "./process";
import { culturalProcess, politicalProcess } from "./mapPeople";
import { builtProcess } from "./mapBuilt";
import {
  ecologyConfiguration,
  magicConfiguration,
  culturalConfiguration,
} from "./featureConfiguration";
import {
  ecologyOperations,
  configuredMagicOperations,
  localMagicSlots,
  localMagicProcesses,
  localMagicContribution,
  operation,
} from "./domainContributions";
import type { GenerationSlot } from "./generationSlots";
import {
  configuredMagicRequirements,
  locatedMagicRequirements,
  locatedMagicWarnings,
} from "./featureDependencies";

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
    ...ecologyConfiguration,
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
    legacyParameters: ["vegetation", "grazing"],
    processes: ["initialize", "evolve", "respond", "burial", "present"].map(
      (name) => `atlas.ecology-${name}`
    ),
    requires: ["physical.climate"],
    slots: Object.keys(ecologyOperations) as GenerationSlot[],
    contribute: (slot) =>
      ecologyOperations[slot as GenerationSlot]
        ? [operation(`atlas.ecology-${ecologyOperations[slot as GenerationSlot]}`, "1")]
        : [],
  },
  {
    id: "magic.configured",
    ...magicConfiguration,
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
    slots: Object.keys(configuredMagicOperations) as GenerationSlot[],
    contribute: (slot) =>
      configuredMagicOperations[slot as GenerationSlot]
        ? [operation(`canonry.magic-${configuredMagicOperations[slot as GenerationSlot]}`)]
        : [],
    conditionalRequires: (_configuration, context) =>
      configuredMagicRequirements(
        context.input.settings?.magicSystems ?? [],
        context.input.domains.includes("physical")
      ),
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
    processes: localMagicProcesses,
    slots: localMagicSlots,
    contribute: (slot, _configuration, context) => localMagicContribution(slot, context),
    conditionalRequires: (_configuration, context) =>
      locatedMagicRequirements(context.source, context.input),
    diagnostics: (_configuration, context) => locatedMagicWarnings(context.source, context.input),
  },
  {
    id: "human.cultures",
    ...culturalConfiguration,
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
    legacyParameters: ["cultureCount"],
    processes: [culturalProcess.contract.id],
    slots: ["present.people"],
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
    legacyParameters: ["polityCount"],
    processes: [politicalProcess.contract.id],
    slots: ["present.people"],
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
    slots: ["present.people"],
    contribute: (slot) => present(builtProcess, slot),
  },
];
