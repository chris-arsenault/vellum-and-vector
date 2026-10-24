import type { PhysicalField } from "./field";
import { ecologicalFront } from "./ecologyMovement";
import { plantGroups, livingPlantCarbon } from "./ecologyGroups";
import { environment, unit, windStrength, type EcologyForcing } from "./ecologyEnvironment";
import { unitNoise } from "./noise";

/**
 * Floods along floodplains and deltas, more often where the seasons and runoff
 * are strong. The epoch's floods kill young plants and part of the mature
 * cover by each group's sensitivity, scour seed and leave nutrients behind;
 * growth then carries the per-year flood mortality.
 */
export function floodEcology(map: PhysicalField, years: number) {
  for (let i = 0; i < map.mesh.count; i++) {
    const plain = Math.max(map.FloodplainIntensity[i], map.DeltaIntensity[i]) / 1000;
    const seasons = 0.3 + 0.7 * unit(map.Seasonality[i] / 15);
    const severity = map.WaterKindCodes[i] === 0 ? plain * seasons * unit(map.Runoff[i] / 400) : 0;
    map.FloodFrequency[i] = 0.5 * severity;
    if (severity === 0 || years <= 0) continue;
    const flooded = severity * -Math.expm1(-years * map.FloodFrequency[i]);
    for (const group of plantGroups) {
      map[group.cover][i] *= 1 - flooded * Math.min(1, group.floodSensitivity * 2);
      if (group.juvenile) map[group.juvenile][i] *= 1 - flooded;
      map[group.seed][i] *= 1 - flooded * 0.5;
    }
    map.MineralNutrients[i] += flooded * 0.02;
  }
}
/** Connected fuel and prevailing wind carry fire; inundated and ice-covered ground interrupt it. */
export function disturbEcology(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing,
  seed: number
) {
  const fuel = Float64Array.from(map.TreeCover, (_, i) => unit(livingPlantCarbon(map, i) / 5));
  const starts = Float64Array.from(fuel, (value, i) =>
    ignition(map, i, value, years, forcing(i), seed)
  );
  const front = ecologicalFront(
    map,
    starts,
    (i) => fuel[i] > 0.015 && map.WaterKindCodes[i] === 0 && map.IceThickness[i] < 1,
    (i, edge, j) => fireTravel(map, fuel, i, edge, j)
  );
  for (let i = 0; i < map.mesh.count; i++) burnCell(map, i, front.time[i], years, forcing(i));
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
    map.mesh.x[i] + map.mesh.origin[0],
    map.mesh.y[i] + map.mesh.origin[1],
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
function fireTravel(map: PhysicalField, fuel: Float64Array, i: number, edge: number, j: number) {
  const distance = map.mesh.edgeLength[i * map.mesh.stride + edge];
  const wetness = environment(map, j).wetness;
  const wind =
    (((map.mesh.x[j] - map.mesh.x[i]) * map.WindX[i] +
      (map.mesh.y[j] - map.mesh.y[i]) * map.WindY[i]) /
      Math.max(1, distance * 1000)) *
    windStrength(map, i);
  return (
    (distance / (15_000 * Math.max(0.1, fuel[j]) * Math.max(0.1, 1 + wind))) * (1 + wetness * 20)
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
    (map.VolcanicConstructionHistory[i] + map.ImpactExcavation[i]) / 1024 -
      map.EcologyVolcanic[i] -
      map.EcologyImpact[i]
  );
  const loss = unit(1 - (1 - Math.max(f.fire, spread)) * Math.exp(-construction / 5));
  map.FireActivity[i] = unit(Math.max(f.fire, spread));
  for (const group of plantGroups) {
    const survival = group.id === "grass" ? 1 - loss * 0.3 : 1 - loss;
    map[group.cover][i] *= survival;
    if (group.juvenile) map[group.juvenile][i] *= 1 - loss;
    map[group.seed][i] *= 1 - loss * 0.4;
  }
  const lost = Math.max(0, before - livingPlantCarbon(map, i));
  map.SoilCarbon[i] += lost * (1 - map.FireActivity[i] * 0.85);
  map.MineralNutrients[i] += lost * map.FireActivity[i] * 0.01;
  map.CanopyAge[i] *= 1 - loss;
  map.EcologicalDamage[i] = Math.max(map.EcologicalDamage[i], loss);
  map.EcologyVolcanic[i] = map.VolcanicConstructionHistory[i] / 1024;
  map.EcologyImpact[i] = map.ImpactExcavation[i] / 1024;
}
