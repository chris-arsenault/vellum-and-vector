import { boundEpoch, builtinLayers } from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import type { GenerationSettings } from "./generationSettings";
import { humanIdentityEra, humanIdentityProcesses, humanRealmEra } from "./human/identityProcesses";
import { humanLandEra, humanLandProcesses, humanPlaces } from "./human/landProcesses";
import { humanEvents } from "./human/landEvents";
import { humanMagicEra, humanMagicPresent, peopleMagicProcesses } from "./peopleMagic";
import { publishIdentities, publishRealms } from "./identityRegions";
import { publishLandPopulation } from "./landPopulation";
import { humanWaterPresent, humanWaterworks, waterworksProcesses } from "./human/waterworks";
import type { GenerationState, MapProcess, ProcessSequence } from "./process";
import { mapCommand } from "./processTraits";
import type { PublicationDefinition } from "./publication";

/**
 * People in a map's sequence. After the land's epochs, each human era is lived on the land,
 * its identities are taken up, its places recorded and its realms spread; then how many live
 * where is published, and the features that put cultures, realms and built places on the map
 * publish what the layers say. Nothing here holds people: the land's layers do.
 */
/** A map that lived its own people on its land, whose regions are read from that land. */
export const livedOnLand = (state: GenerationState) =>
  Boolean(state.physical) && !("regional" in state);
const contract = (id: string, produces: string[] = []) => ({
  id,
  version: "1",
  parameters: {},
  requires: ["atlas:workspace"],
  produces,
  invalidates: [],
});
const invoke = (process: MapProcess) => ({
  kind: "process" as const,
  id: process.contract.id,
  process: process.contract.id,
  version: process.contract.version,
});

export const populationPublish: MapProcess = {
  contract: contract("human.population-present", ["population"]),
  operation: mapCommand(
    "human.population-present",
    "publish",
    (state, context) => publishLandPopulation(state, context),
    []
  ),
  validate: () => [],
};
export const culturalProcess: MapProcess = {
  contract: { ...contract("human.cultures", ["cultures"]), requires: [] },
  operation: mapCommand(
    "human.cultures",
    "publish",
    (state) => {
      if (livedOnLand(state)) publishIdentities(state);
    },
    []
  ),
  validate: () => [],
};
export const politicalProcess: MapProcess = {
  contract: { ...contract("human.politics", ["politics"]), requires: [] },
  operation: mapCommand(
    "human.politics",
    "publish",
    (state) => {
      if (livedOnLand(state)) publishRealms(state);
    },
    []
  ),
  validate: () => [],
};
/** The eras not bound to an earlier epoch: those are lived as loose passes inside it. */
export const presentHumanEras = (settings: GenerationSettings) => {
  const earlier = new Set(settings.epochs.slice(0, -1).map((epoch) => epoch.id));
  return settings.humanEras.filter((era) => {
    const bound = boundEpoch(era.physicalEpoch, settings.epochs);
    return !bound || !earlier.has(bound);
  });
};
export function peopleSequence(input: AtlasGenerationInput): ProcessSequence {
  const eras = presentHumanEras(input.settings!),
    cultural = input.resolvedFeatures!.selection["human.cultures"]?.enabled,
    political = input.resolvedFeatures!.selection["human.politics"]?.enabled;
  return [
    ...(eras.length
      ? [
          {
            kind: "epochs" as const,
            id: "human-eras",
            resetFacts: [],
            epochs: eras.map((era) => ({
              id: era.id,
              duration: era.years,
              parentEpoch: null,
              variables: { mobility: era.mobility, politicalCapacity: era.politicalCapacity },
            })),
            // People live the era on the land and take up one another's ways; the places the
            // era leaves are recorded by name and dam their rivers; realms are founded at them
            // and spread; and what befell each place is read.
            body: [
              invoke(humanLandEra),
              ...(cultural ? [invoke(humanIdentityEra)] : []),
              invoke(humanPlaces),
              invoke(humanWaterworks),
              ...(political ? [invoke(humanRealmEra)] : []),
              invoke(humanEvents),
              invoke(humanMagicEra),
            ],
          },
          invoke(humanWaterPresent),
          invoke(humanMagicPresent),
        ]
      : []),
    invoke(populationPublish),
  ];
}
export const peopleProcesses = [
  ...humanLandProcesses,
  ...humanIdentityProcesses,
  ...waterworksProcesses,
  ...peopleMagicProcesses,
  humanEvents,
  populationPublish,
];

export function peoplePublications(input: AtlasGenerationInput): PublicationDefinition[] {
  const enabled = ["human.cultures", "human.politics", "built.layout"].some(
    (id) => input.resolvedFeatures?.selection[id]?.enabled
  );
  const base = builtinLayers().find((l) => l.id === "cultures")!;
  const layer = {
    ...base,
    id: "population",
    name: "Population and livelihoods",
    facts: ["populationDensity", "populationCapacity"],
  };
  return (["populationDensity", "populationCapacity"] as const).map((channel) => ({
    kind: "field",
    channel,
    unit: "people/square-kilometre",
    quantity: "intensive",
    layer,
    publish: enabled,
  }));
}
