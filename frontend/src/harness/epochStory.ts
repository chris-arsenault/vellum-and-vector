import { flowRecord } from "../../../packages/generation/src/coupling/flows";
import type { PhysicalField } from "../../../packages/generation/src/world/field";

/** What the first epoch's ground has become by the end of a run, and who moved what to get there. */
const classes: readonly [string, (height: number) => boolean][] = [
  ["mountains", (height) => height >= 2000],
  ["uplands", (height) => height >= 500],
  ["lowland", (height) => height > 0],
  ["sea", () => true],
];
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
    const then = map.FirstEpochHeight.get(i),
      name = classes.find(([, holds]) => holds(then))![0];
    held.get(name)!.push((map.Elevation.get(i) - map.EffectiveSeaLevel) / 1024);
  }
  return {
    firstEpochGround: Object.fromEntries(
      [...held].map(([name, heights]) => [name, describe(heights, total)])
    ),
    moved: flowRecord(map),
  };
}
