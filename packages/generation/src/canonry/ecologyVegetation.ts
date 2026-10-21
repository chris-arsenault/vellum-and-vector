import type { PhysicalField } from "./field";
import { classifyBiome, neutralEcology, type EcologyForcing } from "./ecologyEnvironment";
import { initializeEcology, dispersePlants } from "./ecologyEstablishment";
import { evolveSoils } from "./ecologySoils";
import { alterEcology } from "./ecologyMagic";
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
  initializeEcology(map, seed);
  if (years > 0) {
    evolveSoils(map, years, forcing);
    alterEcology(map, years, forcing);
    disturbEcology(map, years, forcing, seed);
    floodEcology(map, years);
    const arrivals = dispersePlants(map, years, forcing);
    growCommunities(map, years, arrivals, forcing, restore);
    evolveAnimals(map, years, forcing);
  }
  for (let i = 0; i < map.mesh.count; i++) {
    normalizeCommunities(map, i);
    updateTreeCover(map, i);
    restore(i);
    map.BiomeCodes[i] = classifyBiome(map, i);
  }
}
