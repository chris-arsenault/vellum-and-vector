import type { PhysicalField } from "../../../packages/generation/src/canonry/field";

/**
 * What a pass of mountain building had to build with and what it did with it, across the cells of
 * its belts: the crust that arrived, what the roots took, what stayed unused, and how the ground
 * stands. Observes only.
 */
const metres = 1024;
const round = (value: number) => Math.round(value * 10) / 10;

/** Means over a belt's continental cells and its oceanic ones, by what each cell can take. */
export function beltSupply(map: PhysicalField) {
  const kept = { cells: 0, oceanic: 0, strain: 0, boundary: 0 },
    sum = { arrived: 0, subducted: 0, built: 0, unused: 0, thickness: 0 };
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1 || map.OrogenicComponentIds.get(i) < 0) continue;
    kept.cells++;
    if (map.CrustContinentalFraction.get(i) < 350) kept.oceanic++;
    if (map.TectonicBoundaryCodes.get(i) === 1) {
      kept.boundary++;
      kept.strain += map.TectonicStrain.get(i);
    }
    sum.arrived += map.ConvergentCrustSurplus.get(i) / metres;
    sum.subducted += map.OceanicSubduction.get(i) / metres;
    sum.built += Math.max(0, map.OrogenicConstruction.get(i)) / metres;
    sum.unused += map.CrustRootReserve.get(i) / metres;
    sum.thickness += map.CrustThickness.get(i) / metres;
  }
  const mean = (value: number) => round(value / Math.max(1, kept.cells));
  return {
    beltCells: kept.cells,
    oceanicCells: kept.oceanic,
    boundaryCells: kept.boundary,
    meanStrain: round(kept.strain / Math.max(1, kept.boundary)),
    arrived: mean(sum.arrived),
    subducted: mean(sum.subducted),
    builtByRootsAndRock: mean(sum.built),
    unusedRootCrust: mean(sum.unused),
    crustThickness: mean(sum.thickness),
  };
}
const volume = (map: PhysicalField, value: (i: number) => number) => {
  let total = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) === 1) total += (value(i) * map.mesh.area(i)) / metres / 1e9;
  return Math.round(total);
};
/**
 * What a plate move did to the crust, in cubic kilometres, beside what its strain says it should
 * have shortened: boundary length times distance times the crust's thickness there.
 */
export function moveBudget(map: PhysicalField) {
  let expected = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) === 1 && map.TectonicBoundaryCodes.get(i) === 1)
      expected +=
        ((map.mesh.spacing * map.LastPlateDriftStep * map.TectonicStrain.get(i)) / 1000) *
        (map.CrustThickness.get(i) / metres) *
        1e-9;
  return {
    expectedFromStrain: Math.round(expected),
    arrivedInRoots: volume(map, (i) => map.ConvergentCrustSurplus.get(i)),
    subducted: volume(map, (i) => map.OceanicSubduction.get(i)),
    rootsHeld: volume(map, (i) => map.CrustRootReserve.get(i)),
    continentalCrust: volume(map, (i) => map.CrustContinentalColumn.get(i)),
    allCrust: volume(map, (i) => map.CrustThickness.get(i)),
    budget: map.crustBudget,
  };
}
/** Where unused root crust is stuck: which belts hold it, and whether they can take any more. */
export function stuckRootCrust(map: PhysicalField) {
  const belts = new Map<number, { reserve: number; continental: number; room: number }>();
  let outside = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const amount = (map.CrustRootReserve.get(i) * map.mesh.area(i)) / metres / 1e9,
      id = map.OrogenicComponentIds.get(i);
    if (id < 0) {
      outside += amount;
      continue;
    }
    const belt = belts.get(id) ?? { reserve: 0, continental: 0, room: 0 },
      fraction = map.CrustContinentalFraction.get(i);
    belt.reserve += amount;
    if (fraction >= 350) {
      belt.continental++;
      if (map.CrustThickness.get(i) / metres < 1000 + 3 * fraction) belt.room++;
    }
    belts.set(id, belt);
  }
  const all = [...belts.values()],
    held = (keep: (belt: (typeof all)[number]) => boolean) =>
      Math.round(all.filter(keep).reduce((sum, belt) => sum + belt.reserve, 0));
  return {
    outsideAnyBelt: Math.round(outside),
    inBeltsWithNoContinent: held((belt) => belt.continental === 0),
    inBeltsWithContinent: held((belt) => belt.continental > 0),
    continentalCells: all.reduce((sum, belt) => sum + belt.continental, 0),
    continentalCellsBelowFoundation: all.reduce((sum, belt) => sum + belt.room, 0),
  };
}
/** How broken the coast is: land cells with no land beside them, and sea cells with no sea. */
function coastConfetti(map: PhysicalField) {
  let loneLand = 0,
    loneSea = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    const land = map.Elevation.get(i) > map.EffectiveSeaLevel;
    let same = false;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0 && map.Elevation.get(j) > map.EffectiveSeaLevel === land) same = true;
    }
    if (!same && land) loneLand++;
    if (!same && !land) loneSea++;
  }
  return { loneLand, loneSea };
}
/** How land stands: shares of it above each height, and the highest it reaches. */
export function landHeights(map: PhysicalField) {
  const heights: number[] = [];
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) === 1 && map.Elevation.get(i) > map.EffectiveSeaLevel)
      heights.push((map.Elevation.get(i) - map.EffectiveSeaLevel) / metres);
  heights.sort((a, b) => a - b);
  const share = (from: number) =>
    round((100 * heights.filter((height) => height >= from).length) / Math.max(1, heights.length));
  return {
    land: heights.length,
    ...coastConfetti(map),
    median: Math.round(heights[Math.floor(heights.length / 2)] ?? 0),
    highest: Math.round(heights.at(-1) ?? 0),
    over1000: share(1000),
    over2000: share(2000),
    over3000: share(3000),
  };
}
