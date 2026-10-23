import { population, putChannel, type Diagnostic } from "@atlas/domain";
import type { GenerationState, MapProcess, ProcessSequence } from "./process";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import { initializePopulation, evolvePopulation } from "./societyPopulation";
import { cultureInitialize, cultureContact } from "./societyCulture";
import { societyFeedbackProcesses } from "./societyFeedbackProcesses";
import { politicsInitialize, politicsChange } from "./societyPolitics";
import { retainSocietyFootprints } from "./societyInheritance";
import { applyPresentWorks } from "./societyWorks";
import { refreshSocietyEnvironment } from "./societyEnvironment";
import { societyEvolution } from "./societyEvolution";

function validatePopulation(state: GenerationState): Diagnostic[] {
  const communities = state.society?.region.communities ?? [];
  return communities.flatMap((c) =>
    c.groups.some((g) => !Number.isFinite(g.count) || g.count < 0)
      ? [
          {
            severity: "error" as const,
            code: "population",
            invocation: "human.population",
            resource: c.id,
            message: `${c.name} has invalid population.`,
          },
        ]
      : []
  );
}
export const populationInitialize: MapProcess = {
  contract: {
    id: "human.initialize",
    version: "1",
    parameters: {},
    requires: ["elevation"],
    produces: ["population"],
    invalidates: [],
  },
  behavior: { kind: "initialize", initialize: initializePopulation },
  validate: validatePopulation,
};
export const populationProcess: MapProcess = {
  contract: {
    id: "human.population",
    version: "1",
    parameters: {},
    requires: ["population"],
    produces: ["population"],
    invalidates: [],
  },
  behavior: {
    kind: "elapsed",
    duration: { kind: "epoch", fraction: 1 },
    advance: evolvePopulation,
  },
  validate: validatePopulation,
};
export const populationPublish: MapProcess = {
  contract: {
    id: "human.population-present",
    version: "1",
    parameters: {},
    requires: ["population"],
    produces: ["population"],
    invalidates: [],
  },
  behavior: {
    kind: "extract",
    extract(state) {
      const work = state.society!,
        n = state.surface.active.length;
      const density = new Float64Array(n),
        capacity = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const c = work.region.communities[work.owner[i]];
        if (!c || c.areaKm2 <= 0) continue;
        density[i] = population(c) / c.areaKm2;
        capacity[i] = c.support.capacity / c.areaKm2;
      }
      putChannel(state.surface, "populationDensity", "people/square-kilometre", density);
      putChannel(state.surface, "populationCapacity", "people/square-kilometre", capacity);
      retainSocietyFootprints(state);
    },
  },
  validate: validatePopulation,
};
export const populationProcesses = [
  populationInitialize,
  populationProcess,
  populationPublish,
  cultureInitialize,
  cultureContact,
  politicsInitialize,
  politicsChange,
  ...societyFeedbackProcesses,
  societyEvolution,
];
export const societyPresent: MapProcess = {
  contract: {
    id: "human.present-works",
    version: "1",
    parameters: {},
    requires: ["population"],
    produces: ["society:environment"],
    invalidates: [],
  },
  behavior: {
    kind: "extract",
    extract(state, context) {
      if (!state.society!.inherited) return;
      applyPresentWorks(state);
      refreshSocietyEnvironment(state, context, 0);
    },
  },
  validate: () => [],
};
populationProcesses.push(societyPresent);
const invoke = (process: MapProcess) => ({
  kind: "process" as const,
  id: process.contract.id,
  process: process.contract.id,
  version: process.contract.version,
});
export function societySequence(input: AtlasGenerationInput): ProcessSequence {
  const eras = input.settings!.humanEras;
  const cultural = input.resolvedFeatures!.selection["human.cultures"]?.enabled;
  const political = input.resolvedFeatures!.selection["human.politics"]?.enabled;
  return [
    invoke(populationInitialize),
    ...(cultural ? [invoke(cultureInitialize)] : []),
    ...(political ? [invoke(politicsInitialize)] : []),
    ...(eras.length
      ? [
          {
            kind: "epochs" as const,
            id: "human-eras",
            resetFacts: [],
            epochs: eras.map((e) => ({
              id: e.id,
              duration: e.years,
              parentEpoch: e.physicalEpoch,
              variables: { mobility: e.mobility, politicalCapacity: e.politicalCapacity },
            })),
            body: [
              {
                ...invoke(societyEvolution),
                parameters: { cultural: !!cultural, political: !!political },
              },
            ],
          },
        ]
      : []),
    invoke(societyPresent),
    invoke(populationPublish),
  ];
}
