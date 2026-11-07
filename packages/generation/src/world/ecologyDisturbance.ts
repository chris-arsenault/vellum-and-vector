import { meshDeltaX } from "./mesh";
import type { PhysicalField } from "./field";
import { ecologicalFront } from "./ecologyMovement";
import { plantGroups, livingPlantCarbon } from "./ecologyGroups";
import { environment, unit, windStrength, type EcologyForcing } from "./ecologyEnvironment";
import { meshWorldUnitNoise as unitNoise } from "./noise";
import type { Band } from "@atlas/domain";
import { workingValues, releaseWorking } from "./physicalNumerics";

/**
 * Floods along floodplains and deltas, more often where the seasons and runoff
 * are strong. The epoch's floods kill young plants and part of the mature
 * cover by each group's sensitivity, scour seed and leave nutrients behind;
 * growth then carries the per-year flood mortality.
 */
export function floodEcology(map: PhysicalField, years: number) {
  for (let i = 0; i < map.mesh.count; i++) {
    const plain = Math.max(map.FloodplainIntensity.get(i), map.DeltaIntensity.get(i)) / 1000;
    const seasons = 0.3 + 0.7 * unit(map.Seasonality.get(i) / 15);
    const severity =
      map.WaterKindCodes.get(i) === 0 ? plain * seasons * unit(map.Runoff.get(i) / 400) : 0;
    map.FloodFrequency.set(i, 0.5 * severity);
    if (severity === 0 || years <= 0) continue;
    const flooded = severity * -Math.expm1(-years * map.FloodFrequency.get(i));
    for (const group of plantGroups) {
      map[group.cover].set(
        i,
        map[group.cover].get(i) * (1 - flooded * Math.min(1, group.floodSensitivity * 2))
      );
      if (group.juvenile) map[group.juvenile].set(i, map[group.juvenile].get(i) * (1 - flooded));
      map[group.seed].set(i, map[group.seed].get(i) * (1 - flooded * 0.5));
    }
    map.MineralNutrients.add(i, flooded * 0.02);
  }
}
/** Connected fuel and prevailing wind carry fire; inundated and ice-covered ground interrupt it. */
export function disturbEcology(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing,
  seed: number
) {
  const fuel = workingValues(map, "float64", "ecology:fire-fuel", (i) =>
    unit(livingPlantCarbon(map, i) / 5)
  );
  const starts = workingValues(map, "float64", "ecology:fire-starts", (i) =>
    ignition(map, i, fuel.get(i), years, forcing(i), seed)
  );
  const front = ecologicalFront(
    map,
    starts,
    (i) => fuel.get(i) > 0.015 && map.WaterKindCodes.get(i) === 0 && map.IceThickness.get(i) < 1,
    (i, edge, j) => fireTravel(map, fuel, i, edge, j)
  );
  for (let i = 0; i < map.mesh.count; i++) burnCell(map, i, front.time.get(i), years, forcing(i));
  releaseWorking(map, fuel, starts, front.time, front.source);
}
function ignition(
  map: PhysicalField,
  i: number,
  fuel: number,
  years: number,
  f: EcologyForcing,
  seed: number
) {
  const env = environment(map, i, f);
  const noise = unitNoise(
    map.mesh,
    map.mesh.x(i) + map.mesh.origin[0],
    map.mesh.y(i) + map.mesh.origin[1],
    seed,
    45_000,
    2
  );
  // Quickened groves build thick, fast fuel, so natural fire runs through them often.
  const risk = -Math.expm1(
    -years * 0.0008 * env.drought ** 2 * f.fireRegime * (1 + 3 * f.quickening) * fuel
  );
  return f.fire > 0 || noise < risk * 0.3 ? 0 : Infinity;
}
function fireTravel(map: PhysicalField, fuel: Band, i: number, edge: number, j: number) {
  const distance = map.mesh.edgeLength(i, edge);
  const wetness = environment(map, j).wetness;
  const wind =
    ((meshDeltaX(map.mesh, map.mesh.x(j) - map.mesh.x(i)) * map.WindX.get(i) +
      (map.mesh.y(j) - map.mesh.y(i)) * map.WindY.get(i)) /
      Math.max(1, distance * 1000)) *
    windStrength(map, i);
  return (
    (distance / (15_000 * Math.max(0.1, fuel.get(j)) * Math.max(0.1, 1 + wind))) *
    (1 + wetness * 20)
  );
}
function burnCell(
  map: PhysicalField,
  i: number,
  arrival: number,
  years: number,
  f: EcologyForcing
) {
  const e = environment(map, i, f),
    before = livingPlantCarbon(map, i);
  const spread = Number(arrival <= Math.min(years, 3)) * e.drought * 0.75;
  const construction = Math.max(
    0,
    (map.VolcanicConstructionHistory.get(i) + map.ImpactExcavation.get(i)) / 1024 -
      map.EcologyVolcanic.get(i) -
      map.EcologyImpact.get(i)
  );
  const loss = unit(1 - (1 - Math.max(f.fire, spread)) * Math.exp(-construction / 5));
  const fire = unit(Math.max(f.fire, spread));
  map.FireActivity.set(i, fire);
  for (const group of plantGroups) {
    const survival = group.id === "grass" ? 1 - loss * 0.3 : 1 - loss;
    map[group.cover].set(i, map[group.cover].get(i) * survival);
    if (group.juvenile) map[group.juvenile].set(i, map[group.juvenile].get(i) * (1 - loss));
    map[group.seed].set(i, map[group.seed].get(i) * (1 - loss * 0.4));
  }
  const lost = Math.max(0, before - livingPlantCarbon(map, i));
  map.SoilCarbon.add(i, lost * (1 - fire * 0.85));
  map.MineralNutrients.add(i, lost * fire * 0.01);
  map.CanopyAge.set(i, map.CanopyAge.get(i) * (1 - loss));
  map.EcologicalDamage.set(i, Math.max(map.EcologicalDamage.get(i), loss));
  map.EcologyVolcanic.set(i, map.VolcanicConstructionHistory.get(i) / 1024);
  map.EcologyImpact.set(i, map.ImpactExcavation.get(i) / 1024);
}
