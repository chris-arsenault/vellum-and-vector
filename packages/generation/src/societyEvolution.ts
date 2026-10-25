import { requireThat } from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";
import { evolvePopulation } from "./societyPopulation";
import { diffuseCultures } from "./societyCulture";
import { evolvePolitics } from "./societyPolitics";
import { applySocietyWorks } from "./societyWorks";
import { useSocietyMagic } from "./societyMagic";
import { fishWaters, learnPractices } from "./societyPractices";
import { refreshSocietyEnvironment } from "./societyEnvironment";
import { resolveSocietyHazards } from "./societyHazards";
import { evolveSettlements } from "./societySettlements";
import { settledCycle, societyStep } from "./societyTempo";
import { wearWays } from "./societyWays";
import { raiseHighways } from "./societyHighways";

/** One decadal cycle of feedback: people, works, magic use, learned practices, environment, hazards, settlements. */
export function societyCycle(
  state: GenerationState,
  context: MapProcessContext,
  dt: number,
  cycle: { index: number; elapsed: number; final: boolean }
) {
  const work = state.society!;
  work.cycle = cycle;
  evolvePopulation(state, context, dt);
  if (context.parameters.cultural) diffuseCultures(state, context, dt);
  applySocietyWorks(state, context, dt);
  useSocietyMagic(state, context, dt);
  learnPractices(state, context, dt);
  fishWaters(state, dt);
  // Water, dams and the GIS extraction of changed geography resolve when the settled history
  // ends, not at every era's end: eras in between read the surface, not the features.
  const lastEra = Number(context.epochs.at(-1)?.variables.lastEra ?? 1) > 0;
  refreshSocietyEnvironment(state, context, dt, cycle.final && lastEra);
  resolveSocietyHazards(state, context, dt);
  evolveSettlements(state, context, dt);
  // The cycle's travel wears the ways; worn ways are cheaper for every process next cycle.
  wearWays(state, dt);
  if (context.parameters.political) {
    evolvePolitics(state, context, dt);
    raiseHighways(state, context);
  }
}
/**
 * Cycles resolve feedback, not annual actors or a cap on elapsed history. Each cycle's
 * length follows how fast the people are changing (`societyStep`), so a long settled
 * history costs few cycles while founding years still resolve by the decade.
 */
export async function evolveSociety(
  state: GenerationState,
  context: MapProcessContext,
  years: number
) {
  const work = state.society!;
  if (work.inherited || years <= 0) return;
  let elapsed = 0;
  for (let index = 0; elapsed < years - 1e-9; index++) {
    requireThat(!context.cancelled(), "generation_cancelled", "Generation was cancelled.");
    const dt = societyStep(state, years - elapsed, settledCycle);
    elapsed += dt;
    const final = elapsed >= years - 1e-9;
    societyCycle(state, context, dt, { index, elapsed, final });
    context.progress(elapsed / years, `Societies: year ${Math.round(elapsed)} of ${years}`);
    // Yield to worker cancellation messages between complete, unpublished steps.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  delete work.cycle;
}

export const societyEvolution: MapProcess = {
  contract: {
    id: "human.evolve",
    version: "1",
    parameters: {
      cultural: { type: "boolean", unit: null, required: false, default: false },
      political: { type: "boolean", unit: null, required: false, default: false },
    },
    requires: ["population"],
    produces: ["population"],
    invalidates: [],
  },
  behavior: { kind: "elapsed", duration: { kind: "epoch", fraction: 1 }, advance: evolveSociety },
  validate: (state) =>
    state.society!.region.communities.flatMap((c) =>
      c.groups.some((g) => !Number.isFinite(g.count) || g.count < 0)
        ? [
            {
              severity: "error" as const,
              code: "population",
              invocation: "human.evolve",
              resource: c.id,
              message: "Population must be finite and nonnegative.",
            },
          ]
        : []
    ),
};
