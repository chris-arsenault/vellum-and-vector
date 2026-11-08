import { flowRecord } from "../../../packages/generation/src/coupling/flows";
import type { PhysicalField } from "../../../packages/generation/src/world/field";

/** What the first epoch's ground has become by the end of a run, and who moved what to get there. */
const classes: readonly [string, (height: number) => boolean][] = [
  ["mountains", (height) => height >= 2000],
  ["uplands", (height) => height >= 500],
  ["lowland", (height) => height > 0],
  ["sea", () => true],
];
const classOf = (then: number) => classes.find(([, holds]) => holds(then))![0];
const percent = (part: number, whole: number) => Math.round((100 * part) / Math.max(1, whole));
function describe(heights: number[], total: number) {
  const sorted = [...heights].sort((a, b) => a - b),
    at = (share: number) => Math.round(sorted[Math.floor((sorted.length - 1) * share)] ?? 0);
  return {
    shareOfMap: percent(sorted.length, total),
    medianNow: at(0.5),
    lowestTenth: at(0.1),
    highestTenth: at(0.9),
    dryShare: percent(sorted.filter((height) => height > 0).length, sorted.length),
    over2000: percent(sorted.filter((height) => height >= 2000).length, sorted.length),
  };
}
export function epochStory(map: PhysicalField) {
  const held = new Map(classes.map(([name]) => [name, [] as number[]]));
  let total = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    total++;
    held
      .get(classOf(map.FirstEpochHeight.get(i)))!
      .push((map.Elevation.get(i) - map.EffectiveSeaLevel) / 1024);
  }
  return {
    firstEpochGround: Object.fromEntries(
      [...held].map(([name, heights]) => [name, describe(heights, total)])
    ),
    moved: flowRecord(map),
  };
}
/** The parts of a cell's column that a step can move, as means over a class, in metres. */
const parts = {
  height: "Elevation",
  pile: "SurfaceRockLoad",
  support: "CrustSupportElevation",
  crust: "CrustThickness",
  loose: "SedimentThickness",
  cut: "CumulativeFluvialErosion",
} as const;
export type FirstEpochGround = Record<keyof typeof parts | "cells", number>;
/**
 * The first epoch's ground as it stands at this moment, by what it was then: the mean of each part of
 * the column over each class, with height above the sea. Read it fresh at every step, since the record
 * of what ground was travels with the crust.
 */
export function firstEpochGroundNow(map: PhysicalField): Record<string, FirstEpochGround> {
  const sums = new Map(
    classes.map(([name]) => [name, Object.fromEntries(Object.keys(parts).map((k) => [k, 0]))])
  );
  const counts = new Map(classes.map(([name]) => [name, 0]));
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    const name = classOf(map.FirstEpochHeight.get(i)),
      sum = sums.get(name)!;
    counts.set(name, counts.get(name)! + 1);
    for (const [part, band] of Object.entries(parts)) sum[part] += map[band].get(i);
    sum.height -= map.EffectiveSeaLevel;
  }
  return Object.fromEntries(
    [...sums].map(([name, sum]) => {
      const cells = counts.get(name)!,
        means = Object.fromEntries(
          Object.keys(parts).map((part) => [
            part,
            Math.round(sum[part] / Math.max(1, cells) / 1024),
          ])
        );
      return [name, { ...means, cells } as FirstEpochGround];
    })
  );
}
/** What a class of first-epoch ground now sits on: shares of its cells, and the mean strain there. */
const settings = {
  inBelt: (map: PhysicalField, i: number) => map.OrogenicComponentIds.get(i) >= 0,
  converging: (map: PhysicalField, i: number) => map.TectonicBoundaryCodes.get(i) === 1,
  rifting: (map: PhysicalField, i: number) => map.TectonicBoundaryCodes.get(i) === 2,
  onSeam: (map: PhysicalField, i: number) =>
    map.CrustSutureStrength.get(i) > 0 || map.CrustProvinceSeam.get(i) > 0,
  continental: (map: PhysicalField, i: number) => map.CrustContinentalFraction.get(i) >= 500,
} as const;
export type FirstEpochSetting = Record<keyof typeof settings | "cells" | "strain", number>;
/**
 * Where the first epoch's ground lies now in the plates' work: how much of each class is within a
 * belt's reach, on a converging or rifting boundary, on an old seam, and how hard its ground is
 * strained. Says whether old ground is still being built on, or has been left for wear.
 */
export function firstEpochGroundSetting(map: PhysicalField): Record<string, FirstEpochSetting> {
  const counts = new Map<string, Record<string, number>>(
    classes.map(([name]) => [
      name,
      { cells: 0, strain: 0, ...Object.fromEntries(Object.keys(settings).map((k) => [k, 0])) },
    ])
  );
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    const count = counts.get(classOf(map.FirstEpochHeight.get(i)))!;
    count.cells++;
    count.strain += map.TectonicStrain.get(i);
    for (const [name, holds] of Object.entries(settings)) if (holds(map, i)) count[name]++;
  }
  return Object.fromEntries(
    [...counts].map(([name, count]) => [
      name,
      {
        ...Object.fromEntries(
          Object.keys(settings).map((k) => [k, percent(count[k], count.cells)])
        ),
        strain: Math.round(count.strain / Math.max(1, count.cells)),
        cells: count.cells,
      } as FirstEpochSetting,
    ])
  );
}
/** What a step did to each class: the change in every mean, in metres, where any part moved a metre. */
export function firstEpochGroundChange(
  before: Record<string, FirstEpochGround>,
  after: Record<string, FirstEpochGround>
): Record<string, FirstEpochGround> | null {
  const changed: Record<string, FirstEpochGround> = {};
  for (const [name, now] of Object.entries(after)) {
    const was = before[name],
      change = Object.fromEntries(
        Object.keys(now).map((part) => [
          part,
          now[part as keyof FirstEpochGround] - was[part as keyof FirstEpochGround],
        ])
      ) as FirstEpochGround;
    if (Object.entries(change).some(([part, value]) => part !== "cells" && Math.abs(value) >= 1))
      changed[name] = change;
  }
  return Object.keys(changed).length ? changed : null;
}
