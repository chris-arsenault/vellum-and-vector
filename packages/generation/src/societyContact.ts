import type { SocietyRegion, SocietyConnection } from "@atlas/domain";
import { RouteHeap } from "./mapRouting";

export function effectiveContactCost(region: SocietyRegion, link: SocietyConnection) {
  const a = region.magic.find((p) => p.communityId === link.from)?.memoryAccess ?? 0;
  const b = region.magic.find((p) => p.communityId === link.to)?.memoryAccess ?? 0;
  return link.travelCost / (1 + 0.3 * Math.max(a, b));
}

/** Terrain/network distance, shared by transmission and political reach. */
export function communityReach(region: SocietyRegion, start: number) {
  return communityDistances(region)(start);
}
/** Reuse one current travel graph when evaluating several centers in the same cycle. */
export function communityDistances(region: SocietyRegion) {
  const index = new Map(region.communities.map((c, i) => [c.id, i]));
  const memory = new Map(region.magic.map((p) => [p.communityId, p.memoryAccess]));
  const edges: { to: number; cost: number }[][] = region.communities.map(() => []);
  for (const link of region.connections) {
    const a = index.get(link.from),
      b = index.get(link.to);
    if (a === undefined || b === undefined) continue;
    const cost =
      link.travelCost / (1 + 0.3 * Math.max(memory.get(link.from) ?? 0, memory.get(link.to) ?? 0));
    edges[a].push({ to: b, cost });
    edges[b].push({ to: a, cost });
  }
  return (start: number) => distancesFrom(edges, start);
}
function distancesFrom(edges: { to: number; cost: number }[][], start: number) {
  const distance = new Float64Array(edges.length).fill(Infinity),
    queue = new RouteHeap();
  if (start < 0) return distance;
  distance[start] = 0;
  queue.push({ cell: start, cost: 0 });
  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    if (entry.cost !== distance[entry.cell]) continue;
    for (const edge of edges[entry.cell]) {
      const cost = entry.cost + edge.cost;
      if (cost >= distance[edge.to]) continue;
      distance[edge.to] = cost;
      queue.push({ cell: edge.to, cost });
    }
  }
  return distance;
}
