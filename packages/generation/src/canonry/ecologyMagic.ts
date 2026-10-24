import type { PhysicalField } from "./field";
import { unit, type EcologyForcing } from "./ecologyEnvironment";

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
    map.EcologicalToxicity[i] = unit(
      Math.max(f.toxicity, map.EcologicalToxicity[i] * Math.exp((-years * f.recovery) / 600))
    );
  }
}
