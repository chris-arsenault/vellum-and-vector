// PriorityFlood.cs, Canonry 0f62584c: depression filling and preferred cheap flat corridors.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { meshWorldUnitNoise as unitNoise, hashUnit } from "./noise";
import { MultiKeyHeap, type Band } from "@atlas/domain";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";

type Front = { i: number; priority: number; cost: number; tie: number };
function seedOutlets(map: PhysicalField, add: (i: number) => void) {
  let count = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1 && !(map.OpenBoundary && map.mesh.boundary(i))) continue;
    add(i);
    count++;
  }
  if (count || !map.mesh.openBoundary) return;
  for (let i = 0; i < map.mesh.count; i++) if (map.mesh.boundary(i)) add(i);
}
function corridorResistance(map: PhysicalField, c: PhysicalContext) {
  return workingValues(map, "float64", "drainage:resistance", (i) => {
    const value = unitNoise(
      map.mesh,
      map.mesh.x(i) + map.mesh.origin[0],
      map.mesh.y(i) + map.mesh.origin[1],
      c.Seed ^ 0x1f7d,
      c.Profile.LandformNeighborhoodRadius,
      2
    );
    return value < 0.37 ? 1 : 12 + 7 * value;
  });
}
function enqueueNeighbor(
  map: PhysicalField,
  front: Front,
  edge: number,
  resistance: Band,
  priorities: Band,
  costs: Band,
  add: (entry: Front) => void,
  seed: number
) {
  const j = map.mesh.neighbor(front.i, edge);
  if (j < 0) return;
  const rank = map.DrainageRanks.get(j);
  if (rank >= 0 && rank < map.mesh.count) return;
  const priority = Math.max(map.Elevation.get(j), front.priority);
  const cost =
    priority > front.priority
      ? 0
      : front.cost + map.mesh.edgeLength(front.i, edge) * resistance.get(j);
  const held = priorities.get(j);
  if (priority > held || (priority === held && cost >= costs.get(j))) return;
  if (held === Infinity) {
    map.FloodFillTotal++;
    if (map.Elevation.get(j) <= front.priority) map.FloodFlatFillTotal++;
  }
  priorities.set(j, priority);
  costs.set(j, cost);
  map.DrainageParents.set(j, front.i);
  map.DrainageRanks.set(j, 2147483647);
  const tie = hashUnit(
    seed,
    Math.round(map.mesh.x(j) + map.mesh.origin[0]),
    Math.round(map.mesh.y(j) + map.mesh.origin[1])
  );
  add({ i: j, priority, cost, tie });
}
export function drainageConditioning(map: PhysicalField, c: PhysicalContext) {
  map.DrainageParents.fill(-1);
  map.DrainageRanks.fill(-1);
  const priorities = workingArray(map, "float64", "drainage:priorities").fill(Infinity),
    costs = map.coverage.copyBand(priorities);
  const resistance = corridorResistance(map, c);
  // Lowest fill height, then cheapest corridor, then the seeded tie, then the lower cell.
  const queue = new MultiKeyHeap(["asc", "asc", "asc"]);
  seedOutlets(map, (i) => {
    map.DrainageRanks.set(i, 2147483647);
    priorities.set(i, map.Elevation.get(i));
    costs.set(i, 0);
    queue.push(i, priorities.get(i), 0, 0);
  });
  if (!queue.size) throw new Error("Priority flood requires a connected ocean outlet.");
  let rank = 0;
  for (let i = queue.pop(); i >= 0; i = queue.pop()) {
    const front: Front = { i, priority: queue.key(0), cost: queue.key(1), tie: queue.key(2) };
    if (
      front.priority !== priorities.get(i) ||
      front.cost !== costs.get(i) ||
      map.DrainageRanks.get(i) < map.mesh.count
    )
      continue;
    map.DrainageRanks.set(i, rank++);
    // The reference's heavy-tailed epsilon prefers branching corridors. Keep that
    // travel cost separate from physical fill height so refinement cannot deepen lakes.
    map.DrainageElevations.set(i, front.priority);
    for (let edge = 0; edge < map.mesh.degree(i); edge++)
      enqueueNeighbor(
        map,
        front,
        edge,
        resistance,
        priorities,
        costs,
        (entry) => queue.push(entry.i, entry.priority, entry.cost, entry.tie),
        c.Seed
      );
  }
  if (rank !== map.mesh.count)
    throw new Error("Priority flood did not visit the complete physical graph.");
  releaseWorking(map, priorities, costs, resistance);
}
