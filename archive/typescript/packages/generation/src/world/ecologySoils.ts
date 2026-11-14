import type { PhysicalField } from "./field";
import { MapScale } from "@atlas/domain";
import { environment, approach, unit, type EcologyForcing } from "./ecologyEnvironment";
import { livingPlantCarbon, plantGroups } from "./ecologyGroups";
import { soilWaterCapacity } from "../water/soilWater";
import { recycleOrganicMaterial } from "../rock/organicMaterial";

export const erosionHistory = (map: PhysicalField, i: number) =>
  MapScale.metres(
    map.CumulativeFluvialErosion.get(i) +
      map.CumulativeGlacialErosion.get(i) +
      map.CumulativeCoastalErosion.get(i),
    "native"
  );

/** The years a span of the land's shaping stands for, given in millions of years. */
export const geologicalYears = (millionYears: number) => Math.max(0, millionYears) * 1e6;
/**
 * Soil forms from the rock under it, fastest where it is thin, and erosion takes it from the
 * top. Where ground wears slowly the two balance at a depth that is deeper the slower the
 * wear; where ground wears faster than bare rock can make soil, there is none.
 */
export function soilBalanceDepth(
  erosionRate: number,
  production: number,
  depthScale: number,
  deepest: number
) {
  if (!(production > 0)) return 0;
  if (!(erosionRate > 0)) return deepest;
  return Math.max(0, Math.min(deepest, depthScale * Math.log(production / erosionRate)));
}
/**
 * What erosion takes that soil cannot replace in the time the erosion took. Metres a river
 * carves over a geological age are no loss to the soil riding the surface down; the same
 * metres in a season strip it.
 */
export const strippedSoil = (erosion: number, production: number, landYears: number) =>
  Math.max(0, erosion - Math.max(0, production) * Math.max(0, landYears));

/**
 * Soil is a carried substrate; fast erosion and ice can remove centuries of ecological
 * development. `landYears` is how long the land's shaping since soil was last looked at
 * stands for: erosion is judged by its rate over that time, never by the metres alone.
 */
export function evolveSoils(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing,
  landYears = years
) {
  // Bare rock makes soil at this rate where it is warm, wet and nothing holds growth back, and the
  // rate falls by e with each of this depth of soil over the rock.
  const bareProduction = map.scale.length(2.5e-11),
    productionDepth = map.scale.length(1.25e-7);
  for (let i = 0; i < map.mesh.count; i++) {
    const f = forcing(i),
      env = environment(map, i, f);
    recycleOrganicMaterial(map, i, years, f.stillness);
    // Rock breaks down to soil with warmth and with water: slowly in the cold and in the dry.
    const production = bareProduction * env.warmth * env.moisture * f.recovery,
      worn = Math.max(0, erosionHistory(map, i) - map.EcologyErosion.get(i)),
      erosion = strippedSoil(worn, production, landYears);
    const iceAdvance = Math.max(0, map.IceThickness.get(i) - map.EcologyIce.get(i));
    const damage =
      1 - Math.exp(-erosion / map.scale.length(5e-8) - iceAdvance / map.scale.length(1.25e-6));
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
    // The depth soil settles at on this ground: what its wear leaves room for, on what there
    // is to make it from. Soil has had the land's own time to reach it, not only the years
    // plants are followed for. Greenwood deepens the soil it grows in.
    const room = Math.min(
        map.scale.length(3.75e-7),
        MapScale.metres(map.SedimentThickness.get(i), "native") + map.scale.length(7.5e-8)
      ),
      settled = soilBalanceDepth(
        landYears > 0 ? worn / landYears : 0,
        production,
        productionDepth,
        room
      );
    map.SoilDepth.set(
      i,
      approach(
        map.SoilDepth.get(i),
        settled + map.scale.length(2.5e-7) * f.verdure,
        Math.max(years, landYears),
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
    soilTaking(map, i, f);
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
/** How readily the ground takes water in, and what its plants draw from the soil's water. */
function soilTaking(map: PhysicalField, i: number, f: EcologyForcing) {
  const e = environment(map, i, f);
  const roots = unit(
    map.TreeCover.get(i) + map.GrassCover.get(i) * 0.3 + map.WetlandCover.get(i) * 0.4
  );
  const capacity = soilWaterCapacity(map, i);
  const rain = MapScale.metres(map.Rainfall.get(i), "mm");
  // A salt crust sheds the rain it would have taken in.
  map.Infiltration.set(
    i,
    unit(
      (0.2 + roots * 0.45 + map.SoilDepth.get(i) * map.scale.inverseLength(600_000)) *
        (1 - 0.6 * f.salting)
    )
  );
  // What the soil holds is the water budget's to say; what grows here draws on it.
  const demand = Math.max(0, e.summer + 5) * map.scale.length(3e-9) * (0.2 + roots);
  map.Evapotranspiration.set(
    i,
    Math.min(
      rain,
      demand * unit(map.SoilWater.get(i) / Math.max(map.scale.length(2.5e-9), capacity))
    )
  );
}
