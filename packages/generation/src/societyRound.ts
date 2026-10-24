import { boundEpoch, population, semanticId, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext, HumanRound } from "./process";
import type { GenerationSettings } from "./generationSettings";
import { generationBindings } from "./generationBindings";
import { projectNative } from "./canonry/atlasProjection";
import { classifyMagicFeatures, projectMagic } from "./canonry/magicFeatures";
import { createSocietyGeography } from "./societyGeography";
import { startingPopulations } from "./societySettlements";
import { societyCycle } from "./societyEvolution";
import { generatedFeature, putGenerated } from "./mapFeatures";

type Era = GenerationSettings["humanEras"][number];
/**
 * A human era bound to an earlier physical epoch runs inside that epoch as a round: a
 * mobile, low-capacity society that camps where food and warmth are, does the cold-age
 * works, and ends when the epoch moves on. Its works stop being maintained; their physical
 * consequences stay in the shared fields and travel with the crust, and its camps are left
 * as ruins for the present to find. An era bound to the final epoch, or to no epoch, runs
 * with the present society instead.
 */
export function roundEras(settings: GenerationSettings, epochId: string, epochIndex: number) {
  if (epochIndex >= settings.epochs.length - 1) return [];
  return settings.humanEras.filter(
    (era) => boundEpoch(era.physicalEpoch, settings.epochs) === epochId
  );
}
/** The eras the present society runs: everything not bound to an earlier epoch. */
export function presentHumanEras(settings: GenerationSettings) {
  const earlier = new Set(settings.epochs.slice(0, -1).map((epoch) => epoch.id));
  return settings.humanEras.filter((era) => {
    const bound = boundEpoch(era.physicalEpoch, settings.epochs);
    return !bound || !earlier.has(bound);
  });
}
/** Eras with their binding resolved to an existing epoch id, or null for the present. */
export function resolvedHumanEras(settings: GenerationSettings) {
  return settings.humanEras.map((era) => ({
    ...era,
    physicalEpoch: boundEpoch(era.physicalEpoch, settings.epochs),
  }));
}
export function hasHumanRound(settings: GenerationSettings) {
  return presentHumanEras(settings).length < settings.humanEras.length;
}

/** The society reads the surface; project the epoch's geography and its magic onto it first. */
function projectEpoch(state: GenerationState, seed: number) {
  projectNative(state);
  if (state.physical!.magic) {
    classifyMagicFeatures(state, seed);
    projectMagic(state);
  }
}
/** Mobile bands drawn as units, camped on food and warmth, with their founding people. */
function foundRound(state: GenerationState, context: MapProcessContext, era: Era) {
  const people = semanticId(state.domain.world.id, "people", "residents");
  state.domain.world.entities[people] ??= {
    id: people,
    kind: "people",
    name: "Residents",
    state: "generated",
    relations: [],
    attributes: { foodDemand: 1, growth: 1, mobility: 1, divingDepth: 200 },
  };
  const work = createSocietyGeography(state, context, { mobile: true, round: era.id });
  const starts = startingPopulations(state, context);
  for (const [i, c] of work.region.communities.entries())
    c.groups = [
      { people, culture: null, languages: [], religions: [], practices: [], count: starts[i] },
    ];
  return work;
}
function roundContext(context: MapProcessContext, era: Era, epoch: string): MapProcessContext {
  return {
    ...context,
    parameters: { cultural: false, political: false },
    epochs: [
      ...context.epochs,
      {
        id: era.id,
        duration: era.years,
        parentEpoch: epoch,
        variables: { mobility: era.mobility, politicalCapacity: era.politicalCapacity },
      },
    ],
    epochIndices: [...context.epochIndices, 0],
  };
}
/** Every era bound to this epoch runs in turn; a later one finds the earlier one's camps. */
async function runHumanRound(state: GenerationState, context: MapProcessContext) {
  const bound = generationBindings(context),
    epoch = context.epochs[0],
    index = context.epochIndices[0] ?? -1;
  if (!epoch || index < 0 || !state.physical) return;
  for (const era of roundEras(bound.settings, epoch.id, index))
    await runEra(state, context, era, epoch.id, bound.seed);
}
async function runEra(
  state: GenerationState,
  context: MapProcessContext,
  era: Era,
  epoch: string,
  seed: number
) {
  context.progress(0, `${era.id}: people enter the ${epoch}`);
  projectEpoch(state, seed);
  const work = foundRound(state, context, era),
    inEra = roundContext(context, era, epoch);
  // A band's generation is the cycle: coarser than the settled decade, and a round
  // costs a fraction of a physical epoch instead of doubling it.
  const steps = Math.ceil(era.years / 25),
    dt = era.years / steps;
  for (let i = 0; i < steps; i++) {
    societyCycle(state, inEra, dt, { index: i, elapsed: (i + 1) * dt, final: i === steps - 1 });
    context.progress(
      (i + 1) / steps,
      `${era.id}: year ${Math.round((i + 1) * dt)} of ${era.years}`
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  delete work.cycle;
  const round = endRound(state, era.id, epoch);
  (state.rounds ??= []).push(round);
  delete state.society;
  context.recordCause({
    kind: "domain",
    process: "human.round",
    subjects: round.ruins.map((ruin) => ruin.name),
    description: `${era.id} (${era.years} years inside the ${epoch}): ${round.ruins.length} camps left as ruins; ${work.region.works.length} works stop being maintained and their consequences in conductance, cover, herds, charge and seabed travel on with the crust.`,
  });
}
const lasting = (c: SocietyCommunity) => Boolean(c.founded) && (c.settlement?.peak ?? 0) >= 20;
/** The era ends inside the epoch: camps that lasted are published as ruins and remembered. */
function endRound(state: GenerationState, era: string, epoch: string): HumanRound {
  const region = state.society!.region,
    camps = region.communities.filter(lasting);
  for (const c of camps) {
    c.status = "ruined";
    putGenerated(state, ruinFeature(state, c, era, epoch));
  }
  return {
    era,
    epoch,
    history: structuredClone(region.history),
    ruins: camps.map((c) => ({
      x: c.position.x,
      y: c.position.y,
      name: c.name,
      siteKind: c.site?.kind ?? "plain",
    })),
  };
}
function ruinFeature(state: GenerationState, c: SocietyCommunity, era: string, epoch: string) {
  const feature = generatedFeature(
    state,
    `round:${era}:${c.id}`,
    c.name,
    "settlement",
    "ruins",
    { type: "Point", coordinates: [c.position.x, c.position.y] },
    {
      communityId: c.id,
      era,
      epoch,
      round: true,
      status: "ruined",
      population: 0,
      peakPopulation: c.settlement?.peak ?? 0,
      communityPopulation: population(c),
      siteKind: c.site?.kind ?? "plain",
      siteReason: c.site?.reason ?? "open country",
      founded: c.founded,
    }
  );
  feature.causes = [...c.causes, `${era} ended with the ${epoch}; the camp was not kept.`];
  return feature;
}

export const humanRoundProcess: MapProcess = {
  contract: {
    id: "human.round",
    version: "1",
    parameters: {},
    requires: ["canonry:workspace"],
    produces: ["atlas:human-round"],
    invalidates: [],
    // The round publishes ruins and a people, so its results are validated like any pass.
    workspaceOnly: false,
  },
  behavior: { kind: "model-pass", applyPass: runHumanRound },
  validate: () => [],
};
