import type { PhysicalField } from "./field";
import { unitNoise } from "./noise";
import { plantGroups, groupSuitability, type PlantGroup } from "./ecologyGroups";
import { ecologicalFront, type EcologicalFront } from "./ecologyMovement";
import { windStrength, type EcologyForcing } from "./ecologyEnvironment";
import { crossingTime, waterDistance, type Crossing } from "./ecologyCrossing";

export function initializeEcology(map: PhysicalField, seed = 42, inherited = false) {
  if (map.EcologyInitialized) return;
  for (let i = 0; i < map.mesh.count; i++) {
    inheritFunctionalGroups(map, i);
    if (!inherited && map.WaterKindCodes[i] !== 1) founders(map, i, seed);
    if (!inherited && map.WaterKindCodes[i] > 0 && map.WaterDepths[i] < 200 * 1024)
      map.AquaticFauna[i] = Math.max(map.AquaticFauna[i], 0.0001);
  }
  map.EcologyInitialized = true;
}
function inheritFunctionalGroups(map: PhysicalField, i: number) {
  const represented = map.BroadleafCover[i] + map.ConiferCover[i] + map.AlteredCover[i];
  if (represented === 0 && map.TreeCover[i] > 0) map.BroadleafCover[i] = map.TreeCover[i];
  if (map.Grazers[i] + map.Browsers[i] === 0) {
    map.Grazers[i] = map.Herbivores[i] * 0.6;
    map.Browsers[i] = map.Herbivores[i] * 0.4;
  }
}
function founders(map: PhysicalField, i: number, seed: number) {
  const diversity = unitNoise(
    map.mesh.x[i] + map.mesh.origin[0],
    map.mesh.y[i] + map.mesh.origin[1],
    seed,
    70_000,
    2
  );
  map.SoilDepth[i] = Math.max(
    map.SoilDepth[i],
    Math.min(0.5, map.SedimentThickness[i] / 1024 + 0.12)
  );
  map.MineralNutrients[i] = Math.max(map.MineralNutrients[i], 0.08);
  map.GrassSeed[i] = Math.max(map.GrassSeed[i], 0.15);
  map.BroadleafSeed[i] = Math.max(map.BroadleafSeed[i], diversity > 0.45 ? 0.08 : 0);
  map.ConiferSeed[i] = Math.max(map.ConiferSeed[i], diversity < 0.55 ? 0.08 : 0);
  map.WetlandSeed[i] = Math.max(map.WetlandSeed[i], 0.02);
  map.Grazers[i] = Math.max(map.Grazers[i], diversity * 0.0002);
  map.Browsers[i] = Math.max(map.Browsers[i], (1 - diversity) * 0.0002);
  map.Predators[i] = Math.max(map.Predators[i], 0.000001);
}
export interface PlantArrival {
  group: PlantGroup;
  front: EcologicalFront;
  suitability: Float64Array;
}
export function dispersePlants(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing
): PlantArrival[] {
  return plantGroups.map((group) => {
    const suitability = Float64Array.from(map.TreeCover, (_, i) =>
      groupSuitability(map, group, i, forcing(i))
    );
    const starts = Float64Array.from(map[group.seed], (bank, i) =>
      bank + map[group.cover][i] > 0.00001 ? 0 : Infinity
    );
    // Propagules also cross the sea, arriving later the farther they must travel.
    const crossing = group.crossing as Crossing;
    const landed = waterDistance(map, (i) => starts[i] === 0, crossing.carrier, crossing.reach * 6);
    for (let i = 0; i < starts.length; i++)
      if (Number.isFinite(landed[i]))
        starts[i] = Math.min(starts[i], crossingTime(crossing, landed[i]));
    const admits = (i: number) =>
      group.id === "altered"
        ? map.WaterKindCodes[i] !== 1 && map.WaterDepths[i] < 1.5 * 1024 && map.IceThickness[i] < 1
        : suitability[i] > 0.001;
    const front = ecologicalFront(map, starts, admits, (i, edge, j) =>
      seedTravel(map, group, forcing(i), i, edge, j)
    );
    if (group.id === "altered") inheritAlteration(map, front, years);
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
  const at = i * map.mesh.stride + edge,
    distance = map.mesh.edgeLength[at];
  const along =
    (((map.mesh.x[j] - map.mesh.x[i]) * map.WindX[i] +
      (map.mesh.y[j] - map.mesh.y[i]) * map.WindY[i]) /
      Math.max(1, distance * 1000)) *
    windStrength(map, i);
  const waterborne = group.id === "wetland" && map.FlowTargets[i] === j ? 3 : 1;
  const speed =
    group.spread *
    f.migration *
    Math.max(0, 1 + f.dispersal) *
    Math.max(0.2, 1 + along * 0.6) *
    waterborne;
  // Spread is already a front speed in metres/year; a delay per mesh edge would
  // make migration slower whenever the same geography is refined.
  return speed > 0 ? (distance * (1 + map.Slope[j] * 10)) / speed : Infinity;
}
function inheritAlteration(map: PhysicalField, front: EcologicalFront, years: number) {
  const cold = map.ColdAdaptation.slice(),
    drought = map.DroughtAdaptation.slice(),
    toxicity = map.EcologicalToxicity.slice();
  for (let i = 0; i < map.mesh.count; i++) {
    const source = front.source[i];
    if (source < 0 || front.time[i] > years) continue;
    map.ColdAdaptation[i] = Math.max(map.ColdAdaptation[i], cold[source]);
    map.DroughtAdaptation[i] = Math.max(map.DroughtAdaptation[i], drought[source]);
    map.EcologicalToxicity[i] = Math.max(map.EcologicalToxicity[i], toxicity[source] * 0.6);
  }
}
