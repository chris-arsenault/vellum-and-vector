import { requireThat } from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";
import { evolvePopulation } from "./societyPopulation";
import { diffuseCultures } from "./societyCulture";
import { evolvePolitics } from "./societyPolitics";
import { applySocietyWorks } from "./societyWorks";
import { useSocietyMagic } from "./societyMagic";
import { refreshSocietyEnvironment } from "./societyEnvironment";
import { resolveSocietyHazards } from "./societyHazards";
import { evolveSettlements } from "./societySettlements";

/** Decadal steps resolve feedback, not annual actors or a cap on elapsed history. */
export async function evolveSociety(
  state: GenerationState,
  context: MapProcessContext,
  years: number
) {
  const work = state.society!;
  if (work.inherited || years <= 0) return;
  const steps = Math.ceil(years / 10),
    dt = years / steps;
  for (let i = 0; i < steps; i++) {
    requireThat(!context.cancelled(), "generation_cancelled", "Generation was cancelled.");
    work.cycle = { index: i, elapsed: (i + 1) * dt, final: i === steps - 1 };
    evolvePopulation(state, context, dt);
    if (context.parameters.cultural) diffuseCultures(state, context, dt);
    applySocietyWorks(state, context, dt);
    useSocietyMagic(state, context, dt);
    refreshSocietyEnvironment(state, context, dt, work.cycle.final);
    resolveSocietyHazards(state, context, dt);
    evolveSettlements(state, context, dt);
    if (context.parameters.political) evolvePolitics(state, context, dt);
    context.progress((i + 1) / steps, `Societies: year ${Math.round((i + 1) * dt)} of ${years}`);
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
