import type { PhysicalField } from "./field";
import { KeyedHeap, type Band } from "@atlas/domain";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";

export interface EcologicalFront {
  time: Band;
  source: Band;
}
/** Travel times in years on the physical adjacency graph; unreachable cells stay unreachable. */
export function ecologicalFront(
  map: PhysicalField,
  starts: Band,
  admits: (i: number) => boolean,
  travel: (from: number, edge: number, to: number) => number
): EcologicalFront {
  const time = workingValues(map, "float64", "ecology:front-time", (i) => starts.get(i)),
    source = workingArray(map, "int32", "ecology:front-source").fill(-1);
  const queue = new KeyedHeap("min");
  for (let i = 0; i < time.length; i++)
    if (Number.isFinite(time.get(i)) && admits(i)) {
      source.set(i, i);
      queue.push(i, time.get(i));
    } else time.set(i, Infinity);
  for (let i = queue.pop(); i >= 0; i = queue.pop()) {
    const at = time.get(i);
    if (queue.poppedKey() !== at) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0 || !admits(j)) continue;
      const next = at + travel(i, edge, j);
      if (!(next < time.get(j))) continue;
      time.set(j, next);
      source.set(j, source.get(i));
      queue.push(j, next);
    }
  }
  return { time, source };
}

/** Relocate existing biomass toward reachable surplus habitat before birth/death changes it. */
export function migrateAnimals(
  map: PhysicalField,
  population: Band,
  capacity: Band,
  years: number,
  speed: number,
  aquatic = false
) {
  const admits = (i: number) =>
    aquatic
      ? (map.WaterKindCodes.get(i) > 0 || map.RiverOrders.get(i) > 0) && map.IceThickness.get(i) < 2
      : map.WaterKindCodes.get(i) !== 1 && map.WaterDepths.get(i) < 1.5 * 1024;
  const starts = workingValues(map, "float64", "ecology:migration-starts", (i) =>
    capacity.get(i) > population.get(i) * 1.1 + 1e-8 ? 0 : Infinity
  );
  const front = ecologicalFront(map, starts, admits, (i, edge, j) =>
    speed > 0
      ? (map.mesh.edgeLength(i, edge) *
          (1 +
            map.Slope.get(j) * 8 +
            map.EcologicalToxicity.get(j) * 10 +
            map.IceThickness.get(j) / 100)) /
        speed
      : Infinity
  );
  const moving = workingArray(map, "float64", "ecology:migration-amounts");
  for (let i = 0; i < population.length; i++) {
    const target = front.source.get(i),
      arrival = front.time.get(i);
    if (target < 0 || target === i || arrival > years) continue;
    const excess = Math.max(0, population.get(i) - capacity.get(i));
    const amount = excess * -Math.expm1(-years / Math.max(0.01, arrival));
    population.add(i, -amount);
    moving.add(target, (amount * map.mesh.area(i)) / map.mesh.area(target));
    map.MigrationFlux.add(i, amount);
  }
  for (let i = 0; i < population.length; i++) population.add(i, moving.get(i));
  releaseWorking(map, starts, moving, front.time, front.source);
}
