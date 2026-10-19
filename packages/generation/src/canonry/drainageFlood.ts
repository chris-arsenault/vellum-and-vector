// PriorityFlood.cs, Canonry 0f62584c: depression filling and preferred cheap flat corridors.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { unitNoise, hashUnit } from "./noise";
import { PriorityQueue } from "./priorityQueue";

type Front = { i: number; priority: number; cost: number; tie: number };
function seedOutlets(map: PhysicalField, add: (i: number) => void) {
  let count = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1 && !(map.OpenBoundary && map.mesh.boundary[i])) continue;
    add(i);
    count++;
  }
  if (count || !map.mesh.openBoundary) return;
  for (let i = 0; i < map.mesh.count; i++) if (map.mesh.boundary[i]) add(i);
}
function corridorResistance(map: PhysicalField, c: PhysicalContext) {
  return Float64Array.from(map.mesh.x, (x, i) => {
    const value = unitNoise(
      x + map.mesh.origin[0],
      map.mesh.y[i] + map.mesh.origin[1],
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
  at: number,
  resistance: Float64Array,
  priorities: Float64Array,
  costs: Float64Array,
  add: (entry: Front) => void,
  seed: number
) {
  const j = map.mesh.neighbors[at];
  if (j < 0 || (map.DrainageRanks[j] >= 0 && map.DrainageRanks[j] < map.mesh.count)) return;
  const priority = Math.max(map.Elevation[j], front.priority);
  const cost = priority > front.priority ? 0 : front.cost + map.mesh.edgeLength[at] * resistance[j];
  if (priority > priorities[j] || (priority === priorities[j] && cost >= costs[j])) return;
  if (priorities[j] === Infinity) {
    map.FloodFillTotal++;
    if (map.Elevation[j] <= front.priority) map.FloodFlatFillTotal++;
  }
  priorities[j] = priority;
  costs[j] = cost;
  map.DrainageParents[j] = front.i;
  map.DrainageRanks[j] = 2147483647;
  const tie = hashUnit(
    seed,
    Math.round(map.mesh.x[j] + map.mesh.origin[0]),
    Math.round(map.mesh.y[j] + map.mesh.origin[1])
  );
  add({ i: j, priority, cost, tie });
}
export function drainageConditioning(map: PhysicalField, c: PhysicalContext) {
  map.DrainageParents.fill(-1);
  map.DrainageRanks.fill(-1);
  const priorities = new Float64Array(map.mesh.count).fill(Infinity),
    costs = priorities.slice();
  const resistance = corridorResistance(map, c);
  const queue = new PriorityQueue<Front>(
    (a, b) => a.priority - b.priority || a.cost - b.cost || a.tie - b.tie || a.i - b.i
  );
  seedOutlets(map, (i) => {
    map.DrainageRanks[i] = 2147483647;
    priorities[i] = map.Elevation[i];
    costs[i] = 0;
    queue.push({ i, priority: priorities[i], cost: 0, tie: 0 });
  });
  if (!queue.count) throw new Error("Priority flood requires a connected ocean outlet.");
  let rank = 0;
  while (queue.count) {
    const front = queue.pop(),
      i = front.i;
    if (
      front.priority !== priorities[i] ||
      front.cost !== costs[i] ||
      map.DrainageRanks[i] < map.mesh.count
    )
      continue;
    map.DrainageRanks[i] = rank++;
    // The reference's heavy-tailed epsilon prefers branching corridors. Keep that
    // travel cost separate from physical fill height so refinement cannot deepen lakes.
    map.DrainageElevations[i] = front.priority;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++)
      enqueueNeighbor(
        map,
        front,
        i * map.mesh.stride + edge,
        resistance,
        priorities,
        costs,
        (entry) => queue.push(entry),
        c.Seed
      );
  }
  if (rank !== map.mesh.count)
    throw new Error("Priority flood did not visit the complete physical graph.");
}
