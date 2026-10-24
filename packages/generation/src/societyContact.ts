import { languageKnowledge, type SocietyRegion, type SocietyConnection } from "@atlas/domain";
import { RouteHeap } from "./mapRouting";

/**
 * The share of language the two ends have in common: for each language, the lesser of the
 * two populations' knowledge of it. Diversity extends reach through this: a seat whose
 * people know many languages is understood along more of its connections.
 */
export function languageOverlap(a: Record<string, number>, b: Record<string, number>) {
  let overlap = 0;
  for (const [id, knowledge] of Object.entries(a)) overlap += Math.min(knowledge, b[id] ?? 0);
  return Math.min(1, overlap);
}
/**
 * What a connection costs to use for contact and reach, read once for a region's current
 * state: memory access from an Aurora archive at either end shortens it, as does language
 * the two ends share.
 */
export function contactCosts(region: SocietyRegion) {
  const memory = new Map(region.magic.map((p) => [p.communityId, p.memoryAccess]));
  const knowledge = new Map(region.communities.map((c) => [c.id, languageKnowledge(c.groups)]));
  return (link: SocietyConnection) =>
    link.travelCost /
    (1 + 0.3 * Math.max(memory.get(link.from) ?? 0, memory.get(link.to) ?? 0)) /
    (1 + 0.5 * languageOverlap(knowledge.get(link.from) ?? {}, knowledge.get(link.to) ?? {}));
}
export function effectiveContactCost(region: SocietyRegion, link: SocietyConnection) {
  return contactCosts(region)(link);
}

/** Terrain/network distance, shared by transmission and political reach. */
export function communityReach(region: SocietyRegion, start: number) {
  return communityDistances(region)(start);
}
/** Reuse one current travel graph when evaluating several centers in the same cycle. */
export function communityDistances(region: SocietyRegion) {
  const index = new Map(region.communities.map((c, i) => [c.id, i]));
  const cost = contactCosts(region);
  const edges: { to: number; cost: number }[][] = region.communities.map(() => []);
  for (const link of region.connections) {
    const a = index.get(link.from),
      b = index.get(link.to);
    if (a === undefined || b === undefined) continue;
    const c = cost(link);
    edges[a].push({ to: b, cost: c });
    edges[b].push({ to: a, cost: c });
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
