import type { SocietyRegion } from "@atlas/domain";
import { RouteHeap } from "./mapRouting";

/** Terrain/network distance, shared by transmission and political reach. */
export function communityReach(region: SocietyRegion, start: number) {
  const index = new Map(region.communities.map((c, i) => [c.id, i]));
  const knowledge = new Map(region.magic.map((p) => [p.communityId, p.memoryAccess]));
  const known = (id: string) => knowledge.get(id) ?? 0;
  const edges: { to: number; cost: number }[][] = region.communities.map(() => []);
  for (const link of region.connections) {
    const a = index.get(link.from),
      b = index.get(link.to);
    if (a === undefined || b === undefined) continue;
    const cost = link.travelCost / (1 + 0.3 * Math.max(known(link.from), known(link.to)));
    edges[a].push({ to: b, cost });
    edges[b].push({ to: a, cost });
  }
  const distance = new Float64Array(region.communities.length).fill(Infinity),
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
