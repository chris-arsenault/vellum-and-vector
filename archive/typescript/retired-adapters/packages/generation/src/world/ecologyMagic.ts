import type { PhysicalField } from "./field";
import { unit, type EcologyForcing } from "./ecologyEnvironment";
import type { EcologyEpoch, MagicSystem } from "@atlas/domain";
import type { AtlasParameters } from "../atlasParameters";
import type { GenerationState } from "../process";
import { heldCharge } from "./magicFeedback";

export const ecologicalMagicEffectBindings = {
  vegetationGrowth: "growth",
  fire: "fire",
  organicPreservation: "preservation",
  animalToxicity: "toxicity",
  seedDispersal: "dispersal",
} as const satisfies Partial<Record<keyof MagicSystem["effects"], keyof EcologyForcing>>;
export const ecologicalMagicEffects = Object.keys(
  ecologicalMagicEffectBindings
) as (keyof typeof ecologicalMagicEffectBindings)[];

function magicalEcologyForcing(state: GenerationState, i: number) {
  const result = { growth: 0, fire: 0, preservation: 0, toxicity: 0, dispersal: 0 },
    map = state.physical!.map;
  for (const field of state.physical!.magic?.fields ?? []) {
    if (!field.definition.enabled) continue;
    const intensity = (field.intensity.get(i) / 1000) * heldCharge(map, field, i);
    for (const effect of ecologicalMagicEffects)
      result[ecologicalMagicEffectBindings[effect]] += intensity * field.definition.effects[effect];
  }
  return result;
}

/** Configured ecological responses are shared by elapsed histories and local development. */
export function ecologicalForcing(
  state: GenerationState,
  parameters: AtlasParameters,
  ecology: EcologyEpoch
) {
  const map = state.physical!.map;
  return (i: number): EcologyForcing => ({
    ...magicalEcologyForcing(state, i),
    quickening: map.Quickening.get(i),
    stillness: map.Stillness.get(i),
    verdure: map.Verdure.get(i),
    salting: map.Salting.get(i),
    productivity: (parameters.vegetation ?? 1) * ecology.productivity,
    grazing: parameters.grazing ?? 1,
    seasonality: ecology.seasonality,
    migration: ecology.migration,
    recovery: ecology.recovery,
    fireRegime: ecology.fire,
  });
}

/**
 * Habitat toxicity is the one living forcing a system writes as a condition rather than a
 * landscape: it rises at once where a system applies it and decays with the epoch's recovery.
 */
export function applyToxicity(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing
) {
  for (let i = 0; i < map.mesh.count; i++) {
    const f = forcing(i);
    map.EcologicalToxicity.set(
      i,
      unit(
        Math.max(f.toxicity, map.EcologicalToxicity.get(i) * Math.exp((-years * f.recovery) / 600))
      )
    );
  }
}
