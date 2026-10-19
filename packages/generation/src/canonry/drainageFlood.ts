// PriorityFlood.cs, Canonry 0f62584c. The heap retains the radix queue's FIFO equal-key order.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { hashUnit } from "./noise";
import { triangleIdentity } from "./mesh";
import { truncate } from "./math";
import { PriorityQueue } from "./priorityQueue";

function filledPriority(map: PhysicalField, key: number, priority: number): number {
  map.FloodFillTotal++;
  if (key <= priority) map.FloodFlatFillTotal++;
  const bits = key & 31,
    epsilon = (bits & 3) === 0 ? 1 : 12 + (bits >> 2);
  return Math.max(key, priority + epsilon * 256);
}
function seedOutlets(map: PhysicalField, add: (i: number) => void) {
  let count = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1 && !(map.OpenBoundary && map.mesh.boundary[i])) continue;
    add(i);
    count++;
  }
  if (count || !map.mesh.openBoundary) return;
  // A finite planar work area can become entirely inland after sea-level fall.
  // Keep the existing ocean drainage whenever present; otherwise let water leave the work area.
  for (let i = 0; i < map.mesh.count; i++) if (map.mesh.boundary[i]) add(i);
}
export function drainageConditioning(map: PhysicalField, c: PhysicalContext) {
  map.DrainageParents.fill(-1);
  map.DrainageRanks.fill(-1);
  let sequence = 0,
    rank = 0;
  const queue = new PriorityQueue<{ i: number; priority: number; sequence: number }>(
    (a, b) => a.priority - b.priority || a.sequence - b.sequence
  );
  const key = (i: number) =>
    map.Elevation[i] * 256 +
    (truncate(hashUnit(c.Seed ^ 0x1f7d, triangleIdentity(map.mesh, i), 0x2c11) * 255) & 255);
  seedOutlets(map, (i) => {
    map.DrainageRanks[i] = 2147483647;
    map.DrainageElevations[i] = map.Elevation[i];
    queue.push({ i, priority: key(i), sequence: sequence++ });
  });
  if (queue.count === 0) throw new Error("Priority flood requires a connected ocean outlet.");
  while (queue.count) {
    const { i, priority } = queue.pop();
    map.DrainageRanks[i] = rank++;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j < 0 || map.DrainageRanks[j] >= 0) continue;
      map.DrainageRanks[j] = 2147483647;
      const filled = filledPriority(map, key(j), priority);
      map.DrainageElevations[j] = Math.floor(filled / 256);
      map.DrainageParents[j] = i;
      queue.push({ i: j, priority: filled, sequence: sequence++ });
    }
  }
  if (rank !== map.mesh.count)
    throw new Error("Priority flood did not visit the complete triangle graph.");
}
