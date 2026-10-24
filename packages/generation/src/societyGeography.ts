import {
  gridPosition,
  livelihoodChannels,
  neighbors,
  semanticId,
  spatial,
  type SocietyRegion,
  type SocietyCommunity,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { RouteHeap } from "./mapRouting";
import { channelAccess, coastalFishery, dryLand, emptySupport, supportAt } from "./societySupport";
import { practiceSkill } from "./societySkill";
import { atlasName } from "./atlasNaming";
import { nearestSocietySample } from "./societySpatial";
import { chooseSettlementSites } from "./societySites";

export interface SocietyEdge {
  a: number;
  b: number;
  cost: number;
  distance: number;
  /** Absent for a land edge. A sea edge from a dry cell to a sea cell is a launch. */
  kind?: "river" | "sea";
}
export interface SocietyWorkspace {
  region: SocietyRegion;
  owner: Int32Array;
  /** Land edges between dry cells; a reach between two channel cells is a river edge. */
  edges: SocietyEdge[];
  river: Float64Array;
  /** Catch available from the sea beside each shore cell. */
  coast: Float64Array;
  /** The era of a mobile round inside an earlier epoch; camps, cold-age works, no publication. */
  round?: string;
  inherited: boolean;
  /** Surface channels society edited since the last environmental refresh. */
  changed: Set<string>;
  /**
   * The subset of `changed` edited by a work on a mesh-scale medium (an earthwork, a tapped
   * vein, a quarried prism). Only these re-route water or re-propagate magic (ADR 0005); a
   * practice warming its seat cell does not.
   */
  mediumChanged: Set<string>;
  /** Elevation before local earthworks, for transferring only their terrain changes. */
  elevationBefore?: Float64Array;
  cycle?: { index: number; elapsed: number; final: boolean };
}
/**
 * Travel on land costs its distance and thirty times its rise. Along a river both banks
 * carry boats, so a reach between two channel cells costs half its distance and no rise:
 * the river is the road. Which kind a connection is follows from the edge it crossed.
 */
const riverTravel = 0.5;
function riverCell(state: GenerationState, i: number) {
  return state.surface.channels.riverOrder?.[i] >= 1;
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
      if (riverCell(state, i) && riverCell(state, j)) {
        edges.push({ a: i, b: j, distance, cost: distance * riverTravel, kind: "river" });
        continue;
      }
      if (rise / Math.max(1, distance) > 0.6) continue;
      edges.push({ a: i, b: j, distance, cost: distance + 30 * rise });
    }
  }
  return edges;
}
/**
 * The sea is a road for whoever holds a shore. Open water costs half its distance between
 * neighbouring sea cells; putting out from a shore cell and landing on one costs a fixed
 * launch each, so a crossing is worth it only when the land way is longer or steeper.
 */
const seaTravel = 0.5,
  seaLaunch = 10000;
function seaEdges(state: GenerationState) {
  const grid = state.surface,
    covers = spatial.geometryCoverage(grid.scope.footprint),
    water = grid.channels.water;
  const edges: SocietyWorkspace["edges"] = [];
  if (!water) return edges;
  const sea = (i: number) => Boolean(grid.active[i]) && water[i] === 1;
  for (let i = 0; i < grid.active.length; i++) {
    if (!sea(i)) continue;
    const a = gridPosition(grid, i);
    for (const j of neighbors(grid, i, false, covers)) {
      const b = gridPosition(grid, j),
        distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (sea(j)) {
        if (j > i) edges.push({ a: i, b: j, distance, cost: distance * seaTravel, kind: "sea" });
      } else if (dryLand(state, j))
        edges.push({ a: j, b: i, distance, cost: distance * seaTravel + seaLaunch, kind: "sea" });
    }
  }
  return edges;
}
/** The territory floor: units spaced by capacity. Where each unit's settlement sits is decided after. */
function seedCells(
  state: GenerationState,
  river: Float64Array,
  coast: Float64Array,
  context: MapProcessContext
) {
  const grid = state.surface;
  const ranked = Array.from(grid.active.keys())
    .filter((i) => dryLand(state, i))
    .map((i) => {
      const support = supportAt(state, i, river[i], coast[i]);
      return { i, score: -Math.log(Math.max(1e-12, context.random())) / (1 + support.capacity) };
    })
    .sort((a, b) => a.score - b.score || a.i - b.i);
  const spacing = communitySpacing(state);
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
        const density = supportAt(state, i, river[i], coast[i]).capacity;
        const other = supportAt(state, j, river[j], coast[j]).capacity;
        const radius = spacing * (0.35 + 0.65 / (1 + Math.min(density, other) / 8));
        return Math.hypot(p.x - q.x, p.y - q.y) < radius;
      })
    )
      continue;
    const key = `${x}:${y}`;
    buckets.set(key, [...(buckets.get(key) ?? []), i]);
    selected.push(i);
  }
  return selected;
}
function communitySpacing(state: GenerationState) {
  const grid = state.surface;
  const nominal = { world: 100000, region: 25000, local: 2500, site: 250, interior: 25 }[
    state.domain.world.areas[state.domain.scope.areaId].profile
  ];
  return Math.min(
    nominal,
    Math.max(grid.bounds[2] - grid.bounds[0], grid.bounds[3] - grid.bounds[1]) / 3
  );
}
/** Multi-source spread: every cell takes the owner of the seed it is cheapest to reach from. */
class Spread {
  readonly owner: Int32Array;
  readonly distances: Float64Array;
  private readonly queue = new RouteHeap();
  private readonly adjacency: { next: number; cost: number }[][];
  constructor(n: number, edges: readonly SocietyEdge[]) {
    this.owner = new Int32Array(n).fill(-1);
    this.distances = new Float64Array(n).fill(Infinity);
    this.adjacency = Array.from({ length: n }, () => []);
    for (const edge of edges) {
      this.adjacency[edge.a].push({ next: edge.b, cost: edge.cost });
      this.adjacency[edge.b].push({ next: edge.a, cost: edge.cost });
    }
  }
  seed(cell: number, owner: number, cost = 0) {
    if (cost >= this.distances[cell]) return;
    this.owner[cell] = owner;
    this.distances[cell] = cost;
    this.queue.push({ cell, cost });
  }
  run() {
    for (let entry = this.queue.pop(); entry; entry = this.queue.pop()) {
      if (entry.cost !== this.distances[entry.cell]) continue;
      for (const { next, cost } of this.adjacency[entry.cell]) {
        if (entry.cost + cost >= this.distances[next]) continue;
        this.owner[next] = this.owner[entry.cell];
        this.distances[next] = entry.cost + cost;
        this.queue.push({ cell: next, cost: this.distances[next] });
      }
    }
  }
}
function assignCells(state: GenerationState, seeds: number[], edges: SocietyWorkspace["edges"]) {
  const n = state.surface.active.length,
    spread = new Spread(n, edges);
  for (const [index, cell] of seeds.entries()) spread.seed(cell, index);
  spread.run();
  // Disconnected islands and valleys retain their own communities.
  for (let i = 0; i < n; i++)
    if (dryLand(state, i) && spread.owner[i] < 0) {
      spread.seed(i, seeds.length);
      seeds.push(i);
      spread.run();
    }
  return { owner: spread.owner, distances: spread.distances };
}
function community(state: GenerationState, cell: number): SocietyCommunity {
  const p = gridPosition(state.surface, cell);
  const key = `${state.domain.scope.areaId}:${p.x}:${p.y}`;
  return {
    id: semanticId(state.domain.world.id, "community", key),
    name: atlasName(state.domain.world, {
      key: `community:${key}`,
      kind: "settlement",
      position: p,
    }).name,
    position: p,
    areaKm2: 0,
    groups: [],
    support: emptySupport(),
    founded: "",
    status: "abandoned",
    protected: false,
    causes: [],
  };
}
export function createSocietyGeography(
  state: GenerationState,
  context: MapProcessContext,
  options: { mobile?: boolean; round?: string } = {}
) {
  context.progress(0, "Locating communities and traversable connections");
  const river = channelAccess(state),
    coast = coastalFishery(state),
    edges = landEdges(state),
    units = seedCells(state, river, coast, context);
  // The draw makes the units; each unit then settles the site its geography offers,
  // and the country is divided again from the sites.
  const draft = assignCells(state, units, edges);
  const chosen = chooseSettlementSites(state, context, draft.owner, units, river, coast, {
    mobile: options.mobile ?? false,
    // A round, like the present, finds the camps of the rounds before it.
    ruins: roundRuins(state),
  });
  const sites = chosen.map((choice) => choice.cell);
  const { owner, distances } = assignCells(state, sites, edges);
  const communities = sites.map((cell, index) => ({
    ...community(state, cell),
    ...(chosen[index]?.site ? { site: chosen[index].site! } : {}),
  }));
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
  state.society = {
    region,
    owner,
    edges,
    river,
    coast,
    ...(options.round ? { round: options.round } : {}),
    inherited: false,
    changed: new Set(),
    mediumChanged: new Set(),
  };
  refreshSocietySupport(state);
  region.connections = connectionsFor(state, communities, owner, distances, edges);
  return state.society;
}
/** Camps of earlier rounds, as the cell each stands on; a present town prefers to sit on them. */
function roundRuins(state: GenerationState) {
  const ruins = new Map<number, string>();
  for (const round of state.rounds ?? [])
    for (const ruin of round.ruins) {
      const cell = nearestSocietySample(state.surface, ruin, (i) => dryLand(state, i));
      if (cell >= 0 && !ruins.has(cell)) ruins.set(cell, ruin.name);
    }
  return ruins;
}
type Connection = SocietyRegion["connections"][number];
/** Keep the cheapest way between two countries; its kind is the edge that crossing used. */
function connect(
  connections: Map<string, Connection>,
  communities: SocietyCommunity[],
  a: number,
  b: number,
  travelCost: number,
  kind: Connection["kind"]
) {
  if (a === b || a < 0 || b < 0 || !Number.isFinite(travelCost)) return;
  const key = [a, b].sort((x, y) => x - y).join(":");
  if ((connections.get(key)?.travelCost ?? Infinity) <= travelCost) return;
  connections.set(key, {
    from: communities[a].id,
    to: communities[b].id,
    distance: travelCost,
    travelCost,
    kind,
  });
}
function connectionsFor(
  state: GenerationState,
  communities: SocietyCommunity[],
  owner: Int32Array,
  distances: Float64Array,
  edges: SocietyWorkspace["edges"]
) {
  const connections = new Map<string, Connection>();
  for (const edge of edges)
    connect(
      connections,
      communities,
      owner[edge.a],
      owner[edge.b],
      distances[edge.a] + edge.cost + distances[edge.b],
      edge.kind ?? "land"
    );
  seaConnections(state, communities, owner, distances, connections);
  return [...connections.values()];
}
/**
 * Each country's boats spread over the sea from its shore, at its land distance to that
 * shore plus the launch; where two countries' waters meet, or one's waters touch another's
 * shore, the sea connects them at the cost of the crossing.
 */
function seaConnections(
  state: GenerationState,
  communities: SocietyCommunity[],
  owner: Int32Array,
  distances: Float64Array,
  connections: Map<string, Connection>
) {
  const edges = seaEdges(state);
  if (!edges.length) return;
  const launches = edges.filter((edge) => dryLand(state, edge.a)),
    open = edges.filter((edge) => !dryLand(state, edge.a));
  const spread = new Spread(state.surface.active.length, open);
  for (const edge of launches)
    if (owner[edge.a] >= 0) spread.seed(edge.b, owner[edge.a], distances[edge.a] + edge.cost);
  spread.run();
  const { owner: seaOwner, distances: seaDistance } = spread;
  for (const edge of open)
    connect(
      connections,
      communities,
      seaOwner[edge.a],
      seaOwner[edge.b],
      seaDistance[edge.a] + edge.cost + seaDistance[edge.b],
      "sea"
    );
  for (const edge of launches)
    connect(
      connections,
      communities,
      owner[edge.a],
      seaOwner[edge.b],
      distances[edge.a] + edge.cost + seaDistance[edge.b],
      "sea"
    );
}
/** Re-evaluate pass and reservoir access without replacing residents or their identities. */
export function refreshSocietyConnections(state: GenerationState) {
  const work = state.society!,
    communities = work.region.communities;
  const seeds = communities.map((c) =>
    nearestSocietySample(state.surface, c.position, (i) => dryLand(state, i))
  );
  if (seeds.some((i) => i < 0)) {
    work.region.connections = [];
    return;
  }
  work.edges = landEdges(state);
  const { owner, distances } = assignCells(state, seeds, work.edges);
  for (let index = communities.length; index < seeds.length; index++)
    communities.push(community(state, seeds[index]));
  work.owner = owner;
  work.region.connections = connectionsFor(state, communities, owner, distances, work.edges);
}
/** Sum each country's yields, each livelihood raised by the skill its people's practice earns. */
export function refreshSocietySupport(state: GenerationState) {
  const work = state.society!;
  const skills = work.region.communities.map((c) => {
    c.support = emptySupport();
    c.areaKm2 = 0;
    return practiceSkill(c.groups);
  });
  for (let i = 0; i < work.owner.length; i++) {
    const c = work.region.communities[work.owner[i]];
    if (!c) continue;
    const area = state.surface.measures[i] / 1e6,
      support = supportAt(state, i, work.river[i], work.coast[i]),
      skill = skills[work.owner[i]];
    c.areaKm2 += area;
    let yield_ = 0,
      skilled = 0;
    for (const key of livelihoodChannels) {
      c.support[key] += support[key] * skill(key) * area;
      yield_ += support[key];
      skilled += support[key] * skill(key);
    }
    c.support.water += support.water * area;
    c.support.capacity += support.capacity * (yield_ > 0 ? skilled / yield_ : 1) * area;
  }
  for (const c of work.region.communities) c.support.water /= Math.max(1e-9, c.areaKm2);
}
