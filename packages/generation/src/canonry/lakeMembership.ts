import type { PhysicalField } from "./field";
import { workingArray, releaseWorking } from "./physicalNumerics";

/** Water-body identities own linked numerical membership, including off-content support. */
export function lakeMembership(map: PhysicalField) {
  const bodies = new Map<number, { first: number; last: number; count: number }>(),
    next = workingArray(map, "int32", "lake:members").fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 2) continue;
    const body = map.WaterBodyIds[i],
      held = bodies.get(body);
    if (!held) bodies.set(body, { first: i, last: i, count: 1 });
    else {
      next[held.last] = i;
      held.last = i;
      held.count++;
    }
  }
  return {
    bodies,
    members(id: number) {
      return {
        *[Symbol.iterator]() {
          for (let i = bodies.get(id)!.first; i >= 0; i = next[i]) yield i;
        },
      };
    },
    close() {
      releaseWorking(map, next);
    },
  };
}
