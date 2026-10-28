import type { PhysicalField } from "./field";
import { KeyedHeap, type NumericalVector } from "@atlas/domain";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";

export interface EcologicalFront {
  time: NumericalVector;
  source: NumericalVector;
}
/** Travel times in years on the physical adjacency graph; unreachable cells stay unreachable. */
export function ecologicalFront(
  map: PhysicalField,
  starts: NumericalVector,
  admits: (i: number) => boolean,
  travel: (from: number, edge: number, to: number) => number
): EcologicalFront {
  const time = workingValues(map, "float64", "ecology:front-time", (i) => starts[i]),
    source = workingArray(map, "int32", "ecology:front-source").fill(-1);
  const queue = new KeyedHeap("min");
  for (let i = 0; i < time.length; i++)
    if (Number.isFinite(time[i]) && admits(i)) {
      source[i] = i;
      queue.push(i, time[i]);
    } else time[i] = Infinity;
  for (let i = queue.pop(); i >= 0; i = queue.pop()) {
    if (queue.poppedKey() !== time[i]) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j < 0 || !admits(j)) continue;
      const next = time[i] + travel(i, edge, j);
      if (!(next < time[j])) continue;
      time[j] = next;
      source[j] = source[i];
      queue.push(j, next);
    }
  }
  return { time, source };
}

/** Relocate existing biomass toward reachable surplus habitat before birth/death changes it. */
export function migrateAnimals(
  map: PhysicalField,
  population: NumericalVector,
  capacity: NumericalVector,
  years: number,
  speed: number,
  aquatic = false
) {
  const admits = (i: number) =>
    aquatic
      ? (map.WaterKindCodes[i] > 0 || map.RiverOrders[i] > 0) && map.IceThickness[i] < 2
      : map.WaterKindCodes[i] !== 1 && map.WaterDepths[i] < 1.5 * 1024;
  const starts = workingValues(map, "float64", "ecology:migration-starts", (i) =>
    capacity[i] > population[i] * 1.1 + 1e-8 ? 0 : Infinity
  );
  const front = ecologicalFront(map, starts, admits, (i, edge, j) =>
    speed > 0
      ? (map.mesh.edgeLength[i * map.mesh.stride + edge] *
          (1 + map.Slope[j] * 8 + map.EcologicalToxicity[j] * 10 + map.IceThickness[j] / 100)) /
        speed
      : Infinity
  );
  const moving = workingArray(map, "float64", "ecology:migration-amounts");
  for (let i = 0; i < population.length; i++) {
    const target = front.source[i];
    if (target < 0 || target === i || front.time[i] > years) continue;
    const excess = Math.max(0, population[i] - capacity[i]);
    const amount = excess * -Math.expm1(-years / Math.max(0.01, front.time[i]));
    population[i] -= amount;
    moving[target] += (amount * map.mesh.areas[i]) / map.mesh.areas[target];
    map.MigrationFlux[i] += amount;
  }
  for (let i = 0; i < population.length; i++) population[i] += moving[i];
  releaseWorking(map, starts, moving, front.time, front.source);
}
