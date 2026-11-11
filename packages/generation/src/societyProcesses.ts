import { mapCommand, mapElapsed, executeMapOperation, processOwner } from "./processTraits";
import { runOperation } from "./processOperation";
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
import { humanRoundProcess, presentHumanEras, resolvedHumanEras } from "./societyRound";
import { humanLandEra, humanLandProcesses, humanPlaces } from "./human/landProcesses";

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
    requires: ["Elevation"],
    produces: ["population"],
    invalidates: [],
  },
  operation: initializePopulation,
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
  operation: mapElapsed(
    "human.population",
    { kind: "epoch", fraction: 1 },
    (state, context, years) =>
      runOperation(processOwner(state), evolvePopulation, { state, context, years }),
    []
  ),
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
  operation: mapCommand(
    "human.population-present",
    "publish",
    (state) => {
      const work = state.society!,
        n = state.surface.active.length;
      const allocate = (name: string) => {
        const band = state.surface.coverage.scratch("float64", name, n);
        band.retain();
        return band;
      };
      const density = allocate("population-density"),
        capacity = allocate("population-capacity");
      for (let i = 0; i < n; i++) {
        const c = work.region.communities[work.owner.get(i)];
        if (!c || c.areaKm2 <= 0) continue;
        density.set(i, population(c) / c.areaKm2);
        capacity.set(i, c.support.capacity / c.areaKm2);
      }
      putChannel(state.surface, "populationDensity", "people/square-kilometre", density);
      putChannel(state.surface, "populationCapacity", "people/square-kilometre", capacity);
      retainSocietyFootprints(state);
    },
    []
  ),
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
  humanRoundProcess,
  ...humanLandProcesses,
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
  operation: mapCommand(
    "human.present-works",
    "event",
    (state, context) => {
      if (!state.society!.inherited) return;
      executeMapOperation(applyPresentWorks, state, context);
      executeMapOperation(refreshSocietyEnvironment, state, context);
    },
    []
  ),
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
  // Eras bound to an earlier epoch ran as rounds inside it; the present runs the rest,
  // with their bindings resolved to the epochs that exist.
  const resolved = { ...input.settings!, humanEras: resolvedHumanEras(input.settings!) };
  const eras = presentHumanEras(resolved);
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
            epochs: eras.map((e, i) => ({
              id: e.id,
              duration: e.years,
              parentEpoch: e.physicalEpoch,
              variables: {
                mobility: e.mobility,
                politicalCapacity: e.politicalCapacity,
                // The settled history's geography is extracted once, when its last era ends.
                lastEra: i === eras.length - 1 ? 1 : 0,
              },
            })),
            // People live the era on the land, and the places it leaves are recorded by name.
            body: [invoke(humanLandEra), invoke(humanPlaces)],
          },
        ]
      : []),
    invoke(societyPresent),
    invoke(populationPublish),
  ];
}
