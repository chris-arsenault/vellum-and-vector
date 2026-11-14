import { atlasParameterDefinitions } from "./atlasParameters";
import { domainCartography } from "./domainCartography";
import { magicCartography } from "./magicCartography";
import type { GenerationFeature } from "./features";
import type { MapProcess, ProcessSequence } from "./process";
import { culturalProcess, politicalProcess } from "./peopleProcesses";
import { builtProcess } from "./mapBuilt";
import {
  ecologyConfiguration,
  magicConfiguration,
  culturalConfiguration,
} from "./featureConfiguration";
import {
  ecologyOperations,
  regionalEcologyOperations,
  regionalMagicOperations,
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
    cartography: [domainCartography["ecology.living"]],
    ...ecologyConfiguration,
    label: "Living ecology",
    applicability: {
      settingConsumers: {
        vegetation: ["atlas.ecology-evolve", "atlas.ecology-respond"],
        grazing: ["atlas.ecology-evolve", "atlas.ecology-respond"],
      },
      initialOnlySettings: ["vegetation", "grazing"],
    },
    domains: ["physical"],
    defaultEnabled: true,
    settings: {
      vegetation: atlasParameterDefinitions.vegetation,
      grazing: atlasParameterDefinitions.grazing,
    },
    parameterKeys: ["vegetation", "grazing"],
    processes: [
      ...Object.values(regionalEcologyOperations),
      ...["initialize", "evolve", "respond", "burial", "settle", "present"].map(
        (name) => `atlas.ecology-${name}`
      ),
    ],
    requires: ["physical.climate", "water.routing"],
    slots: Object.keys(ecologyOperations) as GenerationSlot[],
    contribute: (slot, _configuration, context) =>
      context?.execution === "regional"
        ? regionalEcologyOperations[slot as GenerationSlot]
          ? [operation(regionalEcologyOperations[slot as GenerationSlot]!)]
          : []
        : ecologyOperations[slot as GenerationSlot]
          ? [
              ...(slot === "present.ecology" ? [operation("atlas.ecology-settle")] : []),
              operation(`atlas.ecology-${ecologyOperations[slot as GenerationSlot]}`, "1"),
            ]
          : [],
  },
  {
    id: "magic.configured",
    cartography: magicCartography,
    ...magicConfiguration,
    label: "Configured magical systems",
    domains: ["magic"],
    defaultEnabled: true,
    settings: {},
    processes: [
      "refinement.magic-water",
      ...Object.values(regionalMagicOperations),
      ...[
        "initialize",
        "climate",
        "rocks",
        "post-glacial",
        "coast",
        "history",
        "classify",
        "project",
      ].map((name) => `atlas.magic-${name}`),
    ],
    slots: [
      ...new Set([
        ...Object.keys(configuredMagicOperations),
        ...Object.keys(regionalMagicOperations),
        "after.model-pass",
      ]),
    ] as GenerationSlot[],
    contribute: (slot, _configuration, context) =>
      context?.execution === "regional"
        ? slot === "after.model-pass" && context.process === "atlas.groundwater"
          ? [operation("refinement.magic-water")]
          : regionalMagicOperations[slot as GenerationSlot]
            ? [operation(regionalMagicOperations[slot as GenerationSlot]!)]
            : []
        : configuredMagicOperations[slot as GenerationSlot]
          ? [operation(`atlas.magic-${configuredMagicOperations[slot as GenerationSlot]}`)]
          : [],
    conditionalRequires: (_configuration, context) =>
      configuredMagicRequirements(context.input.settings?.magicSystems ?? []),
  },
  {
    id: "magic.local",
    label: "Located magical sources",
    applicability: {
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
    cartography: domainCartography["human.cultures"],
    ...culturalConfiguration,
    label: "Cultural distributions",
    // People's identities are lived in each human era, which reads these.
    applicability: {
      settingConsumers: {
        cultureCount: ["human.identity-era"],
        culturalMobility: ["human.identity-era"],
      },
    },
    domains: ["cultural"],
    defaultEnabled: true,
    settings: {
      cultureCount: atlasParameterDefinitions.cultureCount,
      culturalMobility: atlasParameterDefinitions.culturalMobility,
    },
    // Shared parameters: the population processes read these through the bound atlas parameters.
    parameterKeys: ["cultureCount", "culturalMobility"],
    processes: [culturalProcess.contract.id],
    slots: ["present.people"],
    contribute: (slot) => present(culturalProcess, slot),
  },
  {
    id: "human.politics",
    cartography: domainCartography["human.politics"],
    label: "Political territories",
    // Realms are founded and spread in each human era, which reads these.
    applicability: {
      settingConsumers: {
        polityCount: ["human.realm-era"],
        politicalReach: ["human.realm-era"],
      },
    },
    domains: ["political"],
    defaultEnabled: true,
    settings: {
      polityCount: atlasParameterDefinitions.polityCount,
      politicalReach: atlasParameterDefinitions.politicalReach,
    },
    parameterKeys: ["polityCount", "politicalReach"],
    processes: [politicalProcess.contract.id],
    slots: ["present.people"],
    contribute: (slot) => present(politicalProcess, slot),
  },
  {
    id: "built.layout",
    cartography: domainCartography["built.layout"],
    label: "Built geography",
    applicability: {
      publicationProfiles: {
        settlements: ["world", "region", "local"],
        roads: ["world", "region", "local"],
        structures: ["site", "interior"],
      },
      // Places are read at the end of each human era; highways when the ways are published.
      settingConsumers: {
        townThreshold: ["human.places"],
        cityReach: ["human.places"],
        roadTraffic: ["human.places"],
        highways: [builtProcess.contract.id],
      },
    },
    domains: ["built"],
    defaultEnabled: true,
    settings: {
      townThreshold: atlasParameterDefinitions.townThreshold,
      cityReach: atlasParameterDefinitions.cityReach,
      roadTraffic: atlasParameterDefinitions.roadTraffic,
      marketTravel: atlasParameterDefinitions.marketTravel,
      highways: atlasParameterDefinitions.highways,
    },
    parameterKeys: ["townThreshold", "cityReach", "roadTraffic", "marketTravel", "highways"],
    processes: [builtProcess.contract.id],
    slots: ["present.people"],
    contribute: (slot) => present(builtProcess, slot),
  },
];
