import type { PhysicalField } from "./field";
import { environment, approach, unit, type EcologyForcing } from "./ecologyEnvironment";
import { livingPlantCarbon, plantGroups } from "./ecologyGroups";

export const erosionHistory = (map: PhysicalField, i: number) =>
  (map.CumulativeFluvialErosion.get(i) +
    map.CumulativeGlacialErosion.get(i) +
    map.CumulativeCoastalErosion.get(i)) /
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
    const erosion = Math.max(0, erosionHistory(map, i) - map.EcologyErosion.get(i));
    const iceAdvance = Math.max(0, map.IceThickness.get(i) - map.EcologyIce.get(i));
    const damage = 1 - Math.exp(-erosion / 0.2 - iceAdvance / 5);
    const before = livingPlantCarbon(map, i);
    for (const group of plantGroups) {
      map[group.cover].set(i, map[group.cover].get(i) * (1 - damage));
      if (group.juvenile) map[group.juvenile].set(i, map[group.juvenile].get(i) * (1 - damage));
      map[group.seed].set(i, map[group.seed].get(i) * (1 - damage * 0.9));
    }
    map.SoilCarbon.set(
      i,
      map.SoilCarbon.get(i) * (1 - damage) + Math.max(0, before - livingPlantCarbon(map, i))
    );
    const oldDepth = map.SoilDepth.get(i);
    map.SoilDepth.set(i, Math.max(0, oldDepth - erosion) * (1 - damage * 0.8));
    map.MineralNutrients.set(i, map.MineralNutrients.get(i) * (1 - damage));
    map.EcologicalDamage.set(
      i,
      Math.max(damage, map.EcologicalDamage.get(i) * Math.exp((-years * f.recovery) / 300))
    );
    const weathering = (0.00015 + map.SoilCarbon.get(i) * 0.000005) * env.warmth * f.recovery;
    // Greenwood deepens the soil it grows in.
    map.SoilDepth.set(
      i,
      approach(
        map.SoilDepth.get(i),
        Math.min(1.5, map.SedimentThickness.get(i) / 1024 + 0.3) + f.verdure,
        years,
        1 / Math.max(1e-8, weathering)
      )
    );
    // Weathering and organic recycling restore available nutrients toward the
    // founders' level over centuries, so scoured or burned ground re-fertilises
    // in proportion to elapsed time; cold slows it.
    const fertility = 0.08 + map.SoilCarbon.get(i) / 80,
      replenishment = env.warmth * f.recovery;
    if (replenishment > 0 && map.MineralNutrients.get(i) < fertility)
      map.MineralNutrients.set(
        i,
        approach(map.MineralNutrients.get(i), fertility, years, 300 / replenishment)
      );
    soilWater(map, i, years, f);
    meltRelease(map, i);
    map.EcologyErosion.set(i, erosionHistory(map, i));
    map.EcologyIce.set(i, map.IceThickness.get(i));
  }
}
/**
 * The melt-line fen: where stillness has fallen since the ground was last seen, the matter
 * it preserved comes out in one pulse, as nutrients and soil carbon returned to use.
 */
function meltRelease(map: PhysicalField, i: number) {
  const release = Math.max(0, map.EcologyStillness.get(i) - map.Stillness.get(i));
  if (release > 0) {
    map.MineralNutrients.add(i, release * (0.05 + map.SoilCarbon.get(i) * 0.004));
    map.SoilCarbon.set(i, map.SoilCarbon.get(i) * (1 - 0.3 * release));
  }
  map.EcologyStillness.set(i, map.Stillness.get(i));
}
function soilWater(map: PhysicalField, i: number, years: number, f: EcologyForcing) {
  const e = environment(map, i, f);
  const roots = unit(
    map.TreeCover.get(i) + map.GrassCover.get(i) * 0.3 + map.WetlandCover.get(i) * 0.4
  );
  const capacity = map.SoilDepth.get(i) * (0.12 + unit(map.SoilCarbon.get(i) / 30) * 0.15);
  const rain = map.Rainfall.get(i) / 1000;
  const supply =
    rain * (1 - f.seasonality * 0.6) + e.wetness * 0.3 + map.GlacialMeltwater.get(i) / 3000;
  // A salt crust sheds the rain it would have taken in.
  map.Infiltration.set(
    i,
    unit((0.2 + roots * 0.45 + map.SoilDepth.get(i) * 0.15) * (1 - 0.6 * f.salting))
  );
  const demand = Math.max(0, e.summer + 5) * 0.012 * (0.2 + roots);
  map.SoilWater.set(
    i,
    approach(
      map.SoilWater.get(i),
      Math.min(capacity, Math.max(0, supply * map.Infiltration.get(i) - demand * 0.3)),
      years,
      1
    )
  );
  map.Evapotranspiration.set(
    i,
    Math.min(rain, demand * unit(map.SoilWater.get(i) / Math.max(0.01, capacity)))
  );
}
