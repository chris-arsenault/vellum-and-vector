import type { PhysicalField } from "./field";
import { plantGroups, livingPlantCarbon } from "./ecologyGroups";
import { unit, type EcologyForcing } from "./ecologyEnvironment";
import { normalizeCommunities } from "./ecologyGrowth";

/** Alteration transforms existing living material; inherited traits can then travel in seeds. */
export function alterEcology(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing
) {
  for (let i = 0; i < map.mesh.count; i++) {
    const f = forcing(i),
      before = livingPlantCarbon(map, i);
    const pulse =
      years > 0
        ? -Math.expm1((-Math.abs(f.alteration) * years) / 30)
        : unit(Math.abs(f.alteration));
    if (f.alteration > 0) transform(map, i, pulse);
    if (f.alteration < 0) restore(map, i, pulse);
    normalizeCommunities(map, i);
    map.EcologicalAlteration[i] = unit(
      Math.max(
        map.AlteredCover[i],
        map.EcologicalAlteration[i] * Math.exp((-years * f.recovery) / 3000)
      )
    );
    map.ColdAdaptation[i] = Math.max(map.ColdAdaptation[i], f.coldTolerance * pulse);
    map.DroughtAdaptation[i] = unit(Math.max(map.DroughtAdaptation[i], f.droughtTolerance * pulse));
    map.EcologicalToxicity[i] = unit(
      Math.max(f.toxicity, map.EcologicalToxicity[i] * Math.exp((-years * f.recovery) / 600))
    );
    map.SoilCarbon[i] += Math.max(0, before - livingPlantCarbon(map, i));
  }
}
function transform(map: PhysicalField, i: number, fraction: number) {
  let mature = 0,
    young = 0;
  for (const group of plantGroups) {
    if (group.id === "altered") continue;
    const removed = map[group.cover][i] * fraction;
    map[group.cover][i] -= removed;
    if (group.juvenile) {
      mature += removed * group.mass;
      young += map[group.juvenile][i] * fraction * group.mass * 0.2;
      map[group.juvenile][i] *= 1 - fraction;
    } else young += removed * group.mass;
  }
  map.AlteredCover[i] += mature / 9;
  map.AlteredSaplings[i] += young / 1.8;
  map.AlteredSeed[i] = unit(
    map.AlteredSeed[i] + fraction * (map.AlteredCover[i] + map.AlteredSaplings[i])
  );
}
function restore(map: PhysicalField, i: number, fraction: number) {
  map.BroadleafCover[i] += map.AlteredCover[i] * fraction * 0.9;
  map.BroadleafSaplings[i] += map.AlteredSaplings[i] * fraction * 0.9;
  map.AlteredCover[i] *= 1 - fraction;
  map.AlteredSaplings[i] *= 1 - fraction;
  map.AlteredSeed[i] *= 1 - fraction;
  map.EcologicalAlteration[i] *= 1 - fraction;
  map.EcologicalToxicity[i] *= 1 - fraction;
}
