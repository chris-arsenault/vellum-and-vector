import { meshDeltaX } from "./mesh";
import type { PhysicalField } from "./field";
import { meshWorldUnitNoise as unitNoise } from "./noise";
import { plantGroups, groupSuitability, type PlantGroup } from "./ecologyGroups";
import { ecologicalFront, type EcologicalFront } from "./ecologyMovement";
import { windStrength, type EcologyForcing } from "./ecologyEnvironment";
import { crossingTime, waterDistance, type Crossing } from "./ecologyCrossing";
import type { Band } from "@atlas/domain";
import { workingValues, releaseWorking } from "./physicalNumerics";

export function initializeEcology(map: PhysicalField, seed = 42, inherited = false) {
  if (map.EcologyInitialized) return;
  for (let i = 0; i < map.mesh.count; i++) {
    inheritFunctionalGroups(map, i);
    const water = map.WaterKindCodes.get(i);
    if (!inherited && water !== 1) founders(map, i, seed);
    if (!inherited && water > 0 && map.WaterDepths.get(i) < 200 * 1024)
      map.AquaticFauna.set(i, Math.max(map.AquaticFauna.get(i), 0.0001));
  }
  map.EcologyInitialized = true;
}
function inheritFunctionalGroups(map: PhysicalField, i: number) {
  const represented = map.BroadleafCover.get(i) + map.ConiferCover.get(i);
  if (represented === 0 && map.TreeCover.get(i) > 0)
    map.BroadleafCover.set(i, map.TreeCover.get(i));
  if (map.Grazers.get(i) + map.Browsers.get(i) === 0) {
    map.Grazers.set(i, map.Herbivores.get(i) * 0.6);
    map.Browsers.set(i, map.Herbivores.get(i) * 0.4);
  }
}
function founders(map: PhysicalField, i: number, seed: number) {
  const diversity = unitNoise(
    map.mesh,
    map.mesh.x(i) + map.mesh.origin[0],
    map.mesh.y(i) + map.mesh.origin[1],
    seed,
    70_000,
    2
  );
  const lift = (band: Band, floor: number) => band.set(i, Math.max(band.get(i), floor));
  lift(map.SoilDepth, Math.min(0.5, map.SedimentThickness.get(i) / 1024 + 0.12));
  lift(map.MineralNutrients, 0.08);
  lift(map.GrassSeed, 0.15);
  lift(map.BroadleafSeed, diversity > 0.45 ? 0.08 : 0);
  lift(map.ConiferSeed, diversity < 0.55 ? 0.08 : 0);
  lift(map.WetlandSeed, 0.02);
  lift(map.Grazers, diversity * 0.0002);
  lift(map.Browsers, (1 - diversity) * 0.0002);
  lift(map.Predators, 0.000001);
}
export interface PlantArrival {
  group: PlantGroup;
  front: EcologicalFront;
  suitability: Band;
}
export function dispersePlants(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing
): PlantArrival[] {
  return plantGroups.map((group) => {
    const suitability = workingValues(map, "float64", `ecology:${group.id}:suitability`, (i) =>
      groupSuitability(map, group, i, forcing(i))
    );
    const starts = workingValues(map, "float64", `ecology:${group.id}:starts`, (i) =>
      map[group.seed].get(i) + map[group.cover].get(i) > 0.00001 ? 0 : Infinity
    );
    // Propagules also cross the sea, arriving later the farther they must travel.
    const crossing = group.crossing as Crossing;
    const landed = waterDistance(
      map,
      (i) => starts.get(i) === 0,
      crossing.carrier,
      crossing.reach * 6
    );
    for (let i = 0; i < starts.length; i++) {
      const distance = landed.get(i);
      if (Number.isFinite(distance))
        starts.set(i, Math.min(starts.get(i), crossingTime(crossing, distance)));
    }
    const admits = (i: number) => suitability.get(i) > 0.001;
    const front = ecologicalFront(map, starts, admits, (i, edge, j) =>
      seedTravel(map, group, forcing(i), i, edge, j)
    );
    releaseWorking(map, starts, landed);
    return { group, front, suitability };
  });
}
function seedTravel(
  map: PhysicalField,
  group: PlantGroup,
  f: EcologyForcing,
  i: number,
  edge: number,
  j: number
) {
  const distance = map.mesh.edgeLength(i, edge);
  const along =
    ((meshDeltaX(map.mesh, map.mesh.x(j) - map.mesh.x(i)) * map.WindX.get(i) +
      (map.mesh.y(j) - map.mesh.y(i)) * map.WindY.get(i)) /
      Math.max(1, distance * 1000)) *
    windStrength(map, i);
  const waterborne = group.id === "wetland" && map.FlowTargets.get(i) === j ? 3 : 1;
  const speed =
    group.spread *
    f.migration *
    Math.max(0, 1 + f.dispersal) *
    Math.max(0.2, 1 + along * 0.6) *
    waterborne;
  // Spread is already a front speed in metres/year; a delay per mesh edge would
  // make migration slower whenever the same geography is refined.
  return speed > 0 ? (distance * (1 + map.Slope.get(j) * 10)) / speed : Infinity;
}
