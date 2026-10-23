import {
  gridPosition,
  neighbors,
  semanticId,
  spatial,
  type SocietyRegion,
  type SocietyCommunity,
  type SocietySupport,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { RouteHeap } from "./mapRouting";
import { channelAccess, dryLand, emptySupport, supportAt } from "./societySupport";
import { generationBindings } from "./generationBindings";

export interface SocietyWorkspace {
  region: SocietyRegion;
  owner: Int32Array;
  edges: { a: number; b: number; cost: number; distance: number }[];
  river: Float64Array;
  inherited: boolean;
  changed: Set<string>;
}
function landEdges(state: GenerationState) {
  const grid = state.surface,
    covers = spatial.geometryCoverage(grid.scope.footprint);
  const edges: SocietyWorkspace["edges"] = [];
  for (let i = 0; i < grid.active.length; i++) {
    if (!dryLand(state, i)) continue;
    const a = gridPosition(grid, i);
    for (const j of neighbors(grid, i, false, covers)) {
      if (j <= i || !dryLand(state, j)) continue;
      const b = gridPosition(grid, j),
        distance = Math.hypot(a.x - b.x, a.y - b.y);
      const rise = Math.abs(grid.channels.elevation[j] - grid.channels.elevation[i]);
      if (rise / Math.max(1, distance) > 0.6) continue;
      edges.push({ a: i, b: j, distance, cost: distance + 30 * rise });
    }
  }
  return edges;
}
function seedCells(state: GenerationState, river: Float64Array, context: MapProcessContext) {
  const grid = state.surface;
  const ranked = Array.from(grid.active.keys())
    .filter((i) => dryLand(state, i))
    .map((i) => ({ i, score: supportAt(state, i, river[i]).capacity }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const spacing = communitySpacing(state, context);
  const buckets = new Map<string, number[]>(),
    selected: number[] = [];
  for (const { i } of ranked) {
    const p = gridPosition(grid, i),
      x = Math.floor(p.x / spacing),
      y = Math.floor(p.y / spacing);
    const near: number[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) near.push(...(buckets.get(`${x + dx}:${y + dy}`) ?? []));
    if (
      near.some((j) => {
        const q = gridPosition(grid, j);
        return Math.hypot(p.x - q.x, p.y - q.y) < spacing;
      })
    )
      continue;
    const key = `${x}:${y}`;
    buckets.set(key, [...(buckets.get(key) ?? []), i]);
    selected.push(i);
  }
  return selected;
}
function communitySpacing(state: GenerationState, context: MapProcessContext) {
  const grid = state.surface;
  const nominal = { world: 100000, region: 25000, local: 2500, site: 250, interior: 25 }[
    state.domain.world.areas[state.domain.scope.areaId].profile
  ];
  const parameters = context.inputs?.features
    ? generationBindings(context).parameters
    : context.parameters;
  const origins = Math.max(
    Number(parameters.cultureCount ?? 1),
    Number(parameters.polityCount ?? 1)
  );
  return Math.min(
    nominal,
    Math.max(grid.bounds[2] - grid.bounds[0], grid.bounds[3] - grid.bounds[1]) / (origins * 2)
  );
}
function assignCells(state: GenerationState, seeds: number[], edges: SocietyWorkspace["edges"]) {
  const n = state.surface.active.length,
    owner = new Int32Array(n).fill(-1);
  const distances = new Float64Array(n).fill(Infinity),
    queue = new RouteHeap();
  const adjacency: { next: number; cost: number }[][] = Array.from({ length: n }, () => []);
  for (const edge of edges) {
    adjacency[edge.a].push({ next: edge.b, cost: edge.cost });
    adjacency[edge.b].push({ next: edge.a, cost: edge.cost });
  }
  for (const [index, cell] of seeds.entries()) {
    owner[cell] = index;
    distances[cell] = 0;
    queue.push({ cell, cost: 0 });
  }
  const spread = () => {
    for (let entry = queue.pop(); entry; entry = queue.pop()) {
      if (entry.cost !== distances[entry.cell]) continue;
      for (const { next, cost } of adjacency[entry.cell]) {
        if (entry.cost + cost >= distances[next]) continue;
        owner[next] = owner[entry.cell];
        distances[next] = entry.cost + cost;
        queue.push({ cell: next, cost: distances[next] });
      }
    }
  };
  spread();
  // Disconnected islands and valleys retain their own communities.
  for (let i = 0; i < n; i++)
    if (dryLand(state, i) && owner[i] < 0) {
      owner[i] = seeds.length;
      seeds.push(i);
      distances[i] = 0;
      queue.push({ cell: i, cost: 0 });
      spread();
    }
  return { owner, distances };
}
function community(state: GenerationState, cell: number, index: number): SocietyCommunity {
  const p = gridPosition(state.surface, cell);
  return {
    id: semanticId(
      state.domain.world.id,
      "community",
      `${state.domain.scope.areaId}:${p.x}:${p.y}`
    ),
    name: `${["Alder", "Stone", "Willow", "High", "Grey", "West", "Green", "North"][index % 8]}${["haven", "ford", "mere", "watch"][Math.floor(index / 8) % 4]} ${Math.floor(index / 32) + 1}`,
    position: p,
    areaKm2: 0,
    groups: [],
    support: emptySupport(),
    founded: "Settlement",
    status: "inhabited",
    protected: false,
    causes: [],
  };
}
export function createSocietyGeography(state: GenerationState, context: MapProcessContext) {
  context.progress(0, "Locating communities and traversable connections");
  const river = channelAccess(state),
    edges = landEdges(state),
    seeds = seedCells(state, river, context);
  const { owner, distances } = assignCells(state, seeds, edges);
  const communities = seeds.map((cell, index) => community(state, cell, index));
  const region: SocietyRegion = {
    areaId: state.domain.scope.areaId,
    spaceId: state.domain.scope.spaceId,
    communities,
    connections: [],
    history: [],
    works: [],
    events: [],
    magic: [],
  };
  state.society = { region, owner, edges, river, inherited: false, changed: new Set() };
  refreshSocietySupport(state);
  region.connections = connectionsFor(communities, owner, distances, edges);
  return state.society;
}
function connectionsFor(
  communities: SocietyCommunity[],
  owner: Int32Array,
  distances: Float64Array,
  edges: SocietyWorkspace["edges"]
) {
  const connections = new Map<string, SocietyRegion["connections"][number]>();
  for (const edge of edges) {
    const a = owner[edge.a],
      b = owner[edge.b];
    if (a === b || a < 0 || b < 0) continue;
    const key = [a, b].sort((x, y) => x - y).join(":"),
      travelCost = distances[edge.a] + edge.cost + distances[edge.b];
    if ((connections.get(key)?.travelCost ?? Infinity) <= travelCost) continue;
    connections.set(key, {
      from: communities[a].id,
      to: communities[b].id,
      distance: travelCost,
      travelCost,
      kind: "land",
    });
  }
  return [...connections.values()];
}
/** Re-evaluate pass and reservoir access without replacing residents or their identities. */
export function refreshSocietyConnections(state: GenerationState) {
  const work = state.society!,
    communities = work.region.communities;
  const seeds = communities.map((c) => {
    let best = -1,
      distance = Infinity;
    for (let i = 0; i < state.surface.active.length; i++) {
      if (!dryLand(state, i)) continue;
      const p = gridPosition(state.surface, i),
        d = Math.hypot(p.x - c.position.x, p.y - c.position.y);
      if (d < distance) {
        best = i;
        distance = d;
      }
    }
    return best;
  });
  if (seeds.some((i) => i < 0)) {
    work.region.connections = [];
    return;
  }
  work.edges = landEdges(state);
  const { owner, distances } = assignCells(state, seeds, work.edges);
  for (let index = communities.length; index < seeds.length; index++)
    communities.push(community(state, seeds[index], index));
  work.owner = owner;
  work.region.connections = connectionsFor(communities, owner, distances, work.edges);
}
export function refreshSocietySupport(state: GenerationState) {
  const work = state.society!;
  for (const c of work.region.communities) {
    c.support = emptySupport();
    c.areaKm2 = 0;
  }
  for (let i = 0; i < work.owner.length; i++) {
    const c = work.region.communities[work.owner[i]];
    if (!c) continue;
    const area = state.surface.measures[i] / 1e6,
      support = supportAt(state, i, work.river[i]);
    c.areaKm2 += area;
    for (const key of Object.keys(support) as (keyof SocietySupport)[])
      c.support[key] += support[key] * area;
  }
  for (const c of work.region.communities) c.support.water /= Math.max(1e-9, c.areaKm2);
}
