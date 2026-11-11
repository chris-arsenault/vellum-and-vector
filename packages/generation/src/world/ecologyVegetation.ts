import type { PhysicalField } from "./field";
import { classifyBiome, neutralEcology, type EcologyForcing } from "./ecologyEnvironment";
import { initializeEcology, dispersePlants } from "./ecologyEstablishment";
import { evolveSoils } from "./ecologySoils";
import { applyToxicity } from "./ecologyMagic";
import { disturbEcology, floodEcology } from "./ecologyDisturbance";
import { growCommunities, updateTreeCover, normalizeCommunities } from "./ecologyGrowth";
import { evolveAnimals } from "./ecologyAnimals";

/** Coupled ecological response on the physical graph, without annual geological-time iteration. */
export function evolveVegetation(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing = () => neutralEcology,
  restore: (i: number) => void = () => {},
  seed = 42
) {
  vegetationResponse(map, years, forcing, restore, seed, true);
}

/** Local ecological relaxation resolves inherited communities without advancing their age. */
export function developVegetation(
  map: PhysicalField,
  exposure: number,
  forcing: (i: number) => EcologyForcing,
  restore: (i: number) => void,
  seed: number
) {
  vegetationResponse(map, exposure, forcing, restore, seed, false);
}

function vegetationResponse(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing,
  restore: (i: number) => void,
  seed: number,
  advanceAge: boolean
) {
  initializeEcology(map, seed);
  if (years > 0) {
    evolveSoils(map, years, forcing);
    applyToxicity(map, years, forcing);
    disturbEcology(map, years, forcing, seed);
    floodEcology(map, years);
    const arrivals = dispersePlants(map, years, forcing);
    growCommunities(map, years, arrivals, forcing, restore, advanceAge);
    evolveAnimals(map, years, forcing);
  }
  for (let i = 0; i < map.mesh.count; i++) {
    normalizeCommunities(map, i);
    updateTreeCover(map, i);
    restore(i);
    map.BiomeCodes.set(i, classifyBiome(map, i));
  }
}
