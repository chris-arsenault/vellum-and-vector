import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { macroComponents, macroDistances } from "./macroRegions";
import { environment, unit } from "./ecologyEnvironment";
import { plantGroups, livingPlantCarbon } from "./ecologyGroups";
import { updateTreeCover } from "./ecologyGrowth";
import { connectHabitatCores } from "./macroCorridors";

/** Redistribute represented density within occupied, reachable habitat cores. */
function distribute(
  work: AtlasPhysicalWorkspace,
  values: Float64Array,
  support: Float64Array,
  aquatic: boolean
) {
  const map = work.map,
    mesh = map.mesh,
    admits = (i: number) =>
      !work.finishing?.protectedCells?.[i] &&
      (aquatic
        ? (map.WaterKindCodes[i] > 0 || map.RiverOrders[i] > 0) && map.IceThickness[i] < 2
        : !map.WaterKindCodes[i] && map.IceThickness[i] < 300 && map.EcologicalToxicity[i] < 0.95),
    front = macroDistances(mesh, (i) => values[i] > 0 && admits(i), admits, 80_000);
  for (const cells of macroComponents(mesh, (i) => admits(i) && front.distance[i] <= 80_000)) {
    const biomass = cells.reduce((sum, i) => sum + values[i] * mesh.areas[i], 0),
      capacity = cells.reduce((sum, i) => sum + support[i] * mesh.areas[i], 0);
    if (!biomass || !capacity) continue;
    const weights = habitatWeights(work, cells, support, values),
      total = cells.reduce((sum, i) => sum + weights[i] * mesh.areas[i], 0);
    for (const i of cells) values[i] = (weights[i] * biomass) / total;
  }
}
function habitatWeights(
  work: AtlasPhysicalWorkspace,
  cells: number[],
  support: Float64Array,
  values: Float64Array
) {
  const mesh = work.map.mesh,
    members = new Set(cells),
    maximum = cells.reduce((value, i) => Math.max(value, support[i]), 0),
    strong = new Set(cells.filter((i) => support[i] >= maximum * 0.65 && values[i] > 0)),
    cores = macroComponents(mesh, (i) => strong.has(i)).map((group) =>
      group.reduce((a, b) => (support[a] * values[a] >= support[b] * values[b] ? a : b))
    );
  if (!cores.length) cores.push(cells.reduce((a, b) => (support[a] >= support[b] ? a : b)));
  const paths = connectHabitatCores(mesh, cells, cores, support),
    corridor = macroDistances(
      mesh,
      (i) => Boolean(paths[i]),
      (i) => members.has(i),
      12_000
    );
  return Float64Array.from(
    support,
    (v, i) => v * (strong.has(i) ? 1.5 : corridor.distance[i] <= 12_000 ? 1 : 0.2)
  );
}
export function composeHabitats(work: AtlasPhysicalWorkspace) {
  const map = work.map,
    mesh = map.mesh;
  const forage = (i: number, food: number) =>
    (food * map.Productivity[i] * (1 - map.EcologicalToxicity[i])) / (1 + map.Slope[i] * 8);
  distribute(
    work,
    map.Grazers,
    Float64Array.from(map.GrassCover, (v, i) => forage(i, v + map.WetlandCover[i] * 0.3)),
    false
  );
  distribute(
    work,
    map.Browsers,
    Float64Array.from(map.TreeCover, (v, i) => forage(i, v)),
    false
  );
  for (let i = 0; i < mesh.count; i++) map.Herbivores[i] = map.Grazers[i] + map.Browsers[i];
  distribute(work, map.Predators, map.Herbivores, false);
  distribute(
    work,
    map.AquaticProductivity,
    Float64Array.from(map.AquaticProductivity, (_, i) => {
      const env = environment(map, i);
      return env.warmth * Math.exp(-env.depth / 100) * (1 - map.EcologicalToxicity[i]);
    }),
    true
  );
  distribute(
    work,
    map.AquaticFauna,
    Float64Array.from(map.AquaticProductivity, (v, i) => v * (1 - map.EcologicalToxicity[i])),
    true
  );
  // MigrationFlux remains the inherited aggregate history, not a fictional track.
}

/** Present-state support and resource interfaces, with no growth, burial or elapsed time. */
export function reconcileEcologicalSupport(work: AtlasPhysicalWorkspace) {
  const map = work.map;
  for (let i = 0; i < map.mesh.count; i++) {
    if (work.finishing?.protectedCells?.[i]) continue;
    const env = environment(map, i);
    if (env.submerged || env.frozen) removeUnsupportedCommunity(work, i);
    const roots = unit(map.TreeCover[i] + map.GrassCover[i] * 0.3 + map.WetlandCover[i] * 0.4),
      capacity = map.SoilDepth[i] * (0.12 + unit(map.SoilCarbon[i] / 30) * 0.15),
      demand = Math.max(0, env.summer + 5) * 0.012 * (0.2 + roots);
    map.Infiltration[i] = unit(0.2 + roots * 0.45 + map.SoilDepth[i] * 0.15);
    map.SoilWater[i] = Math.min(capacity, map.SoilWater[i]);
    map.Evapotranspiration[i] = Math.min(
      map.Rainfall[i] / 1000,
      demand * unit(map.SoilWater[i] / Math.max(0.01, capacity))
    );
    if (!env.water && map.RiverOrders[i] <= 0 && map.WetlandCover[i] < 0.1) {
      map.SoilCarbon[i] += map.AquaticFauna[i] + map.AquaticCarbon[i];
      map.AquaticFauna[i] = map.AquaticProductivity[i] = map.AquaticCarbon[i] = 0;
    }
  }
}
function removeUnsupportedCommunity(work: AtlasPhysicalWorkspace, i: number) {
  const map = work.map,
    carbon = livingPlantCarbon(map, i);
  for (const group of plantGroups) {
    map[group.cover][i] = 0;
    if (group.juvenile) map[group.juvenile][i] = 0;
  }
  map.SoilCarbon[i] += carbon + map.Grazers[i] + map.Browsers[i] + map.Predators[i];
  map.Grazers[i] =
    map.Browsers[i] =
    map.Herbivores[i] =
    map.Predators[i] =
    map.Productivity[i] =
    map.CanopyAge[i] =
      0;
  updateTreeCover(map, i);
}
