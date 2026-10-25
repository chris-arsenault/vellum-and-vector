import type { PhysicalField } from "./field";
import { environment, approach, unit, type EcologyForcing } from "./ecologyEnvironment";
import { livingPlantCarbon, plantGroups } from "./ecologyGroups";

export const erosionHistory = (map: PhysicalField, i: number) =>
  (map.CumulativeFluvialErosion[i] +
    map.CumulativeGlacialErosion[i] +
    map.CumulativeCoastalErosion[i]) /
  1024;

/** Soil is a carried substrate; erosion and ice can remove centuries of ecological development. */
export function evolveSoils(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing
) {
  for (let i = 0; i < map.mesh.count; i++) {
    const f = forcing(i),
      env = environment(map, i, f);
    const erosion = Math.max(0, erosionHistory(map, i) - map.EcologyErosion[i]);
    const iceAdvance = Math.max(0, map.IceThickness[i] - map.EcologyIce[i]);
    const damage = 1 - Math.exp(-erosion / 0.2 - iceAdvance / 5);
    const before = livingPlantCarbon(map, i);
    for (const group of plantGroups) {
      map[group.cover][i] *= 1 - damage;
      if (group.juvenile) map[group.juvenile][i] *= 1 - damage;
      map[group.seed][i] *= 1 - damage * 0.9;
    }
    map.SoilCarbon[i] =
      map.SoilCarbon[i] * (1 - damage) + Math.max(0, before - livingPlantCarbon(map, i));
    const oldDepth = map.SoilDepth[i];
    map.SoilDepth[i] = Math.max(0, oldDepth - erosion) * (1 - damage * 0.8);
    map.MineralNutrients[i] *= 1 - damage;
    map.EcologicalDamage[i] = Math.max(
      damage,
      map.EcologicalDamage[i] * Math.exp((-years * f.recovery) / 300)
    );
    const weathering = (0.00015 + map.SoilCarbon[i] * 0.000005) * env.warmth * f.recovery;
    // Greenwood deepens the soil it grows in.
    map.SoilDepth[i] = approach(
      map.SoilDepth[i],
      Math.min(1.5, map.SedimentThickness[i] / 1024 + 0.3) + f.verdure,
      years,
      1 / Math.max(1e-8, weathering)
    );
    // Weathering and organic recycling restore available nutrients toward the
    // founders' level over centuries, so scoured or burned ground re-fertilises
    // in proportion to elapsed time; cold slows it.
    const fertility = 0.08 + map.SoilCarbon[i] / 80,
      replenishment = env.warmth * f.recovery;
    if (replenishment > 0 && map.MineralNutrients[i] < fertility)
      map.MineralNutrients[i] = approach(
        map.MineralNutrients[i],
        fertility,
        years,
        300 / replenishment
      );
    soilWater(map, i, years, f);
    meltRelease(map, i);
    map.EcologyErosion[i] = erosionHistory(map, i);
    map.EcologyIce[i] = map.IceThickness[i];
  }
}
/**
 * The melt-line fen: where stillness has fallen since the ground was last seen, the matter
 * it preserved comes out in one pulse, as nutrients and soil carbon returned to use.
 */
function meltRelease(map: PhysicalField, i: number) {
  const release = Math.max(0, map.EcologyStillness[i] - map.Stillness[i]);
  if (release > 0) {
    map.MineralNutrients[i] += release * (0.05 + map.SoilCarbon[i] * 0.004);
    map.SoilCarbon[i] *= 1 - 0.3 * release;
  }
  map.EcologyStillness[i] = map.Stillness[i];
}
function soilWater(map: PhysicalField, i: number, years: number, f: EcologyForcing) {
  const e = environment(map, i, f);
  const roots = unit(map.TreeCover[i] + map.GrassCover[i] * 0.3 + map.WetlandCover[i] * 0.4);
  const capacity = map.SoilDepth[i] * (0.12 + unit(map.SoilCarbon[i] / 30) * 0.15);
  const rain = map.Rainfall[i] / 1000;
  const supply =
    rain * (1 - f.seasonality * 0.6) + e.wetness * 0.3 + map.GlacialMeltwater[i] / 3000;
  // A salt crust sheds the rain it would have taken in.
  map.Infiltration[i] = unit(
    (0.2 + roots * 0.45 + map.SoilDepth[i] * 0.15) * (1 - 0.6 * f.salting)
  );
  const demand = Math.max(0, e.summer + 5) * 0.012 * (0.2 + roots);
  map.SoilWater[i] = approach(
    map.SoilWater[i],
    Math.min(capacity, Math.max(0, supply * map.Infiltration[i] - demand * 0.3)),
    years,
    1
  );
  map.Evapotranspiration[i] = Math.min(
    rain,
    demand * unit(map.SoilWater[i] / Math.max(0.01, capacity))
  );
}
