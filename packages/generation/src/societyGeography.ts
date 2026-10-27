import {
  gridPosition,
  livelihoodChannels,
  semanticId,
  generateNumerical,
  type SocietyRegion,
  type SocietyCommunity,
  type NumericalVector,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { SocietySpread, landEdges, seaEdges } from "./societyTraversal";
export type { SocietyEdge } from "./societyTraversal";
import { orderedIndices } from "./canonry/numericalOrder";
import { channelAccess, coastalFishery, dryLand, emptySupport, supportAt } from "./societySupport";
import { practiceSkill } from "./societySkill";
import { atlasName } from "./atlasNaming";
import { nearestSocietySample } from "./societySpatial";
import { chooseSettlementSites } from "./societySites";
import { doorEdges } from "./societyDoors";
import {
  retainedSeatCells,
  retainRegionalConnections,
  regionalCommunitySpacing,
} from "./regionalSociety";

export interface SocietyWorkspace {
  region: SocietyRegion;
  owner: NumericalVector;
  river: NumericalVector;
  /** Catch available from the sea beside each shore cell. */
  coast: NumericalVector;
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
  elevationBefore?: NumericalVector;
  cycle?: { index: number; elapsed: number; final: boolean };
  /** This cycle's central-place allocation of town-dwellers, read by settlements. */
  urban?: import("./societyCentres").UrbanAllocation;
  /** People who travelled each connection this cycle, by index into `region.connections`. */
  traffic?: Float64Array;
  /** The coefficients the recipe's outcome choices set, bound each cycle from the context. */
  profile?: import("./societyProfile").SocietyProfile;
  /** Systems whose stocks people drew or deposited this cycle; the refresh re-evaluates them. */
  magicTouched?: Set<string>;
  /** Each community's net population fall this cycle: a die-off the mesh records as deaths. */
  dieOff?: Map<string, number>;
  /** Events whose casualties the mesh already records. */
  deathsRecorded?: Set<string>;
}
/** The territory floor: units spaced by capacity. Where each unit's settlement sits is decided after. */
function seedCells(
  state: GenerationState,
  river: NumericalVector,
  coast: NumericalVector,
  context: MapProcessContext,
  retained?: SocietyCommunity[]
) {
  const grid = state.surface;
  const scores = generateNumerical(
      {
        type: "float64",
        length: grid.active.length,
        lifetime: "process",
        name: "society-site-scores",
      },
      (i) => {
        if (!dryLand(state, i)) return Infinity;
        const support = supportAt(state, i, river[i], coast[i]);
        return -Math.log(Math.max(1e-12, context.random())) / (1 + support.capacity);
      },
      state.numerical
    ),
    ranked = orderedIndices(scores, false, state.numerical);
  const spacing = regionalCommunitySpacing(state, retained);
  const buckets = new Map<string, number[]>(),
    selected: number[] = [];
  for (const i of ranked) {
    if (scores[i] === Infinity) break;
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
  state.numerical?.releaseUnused([scores, ranked], []);
  return selected;
}
function assignCells(state: GenerationState, seeds: number[]) {
  const n = state.surface.active.length,
    spread = new SocietySpread(state);
  for (const [index, cell] of seeds.entries()) spread.seed(cell, index);
  spread.run();
  // Disconnected islands and valleys retain their own communities.
  for (let i = 0; i < n; i++)
    if (dryLand(state, i) && spread.owner[i] < 0) {
      spread.seed(i, seeds.length);
      seeds.push(i);
      spread.run();
    }
  spread.close();
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
  options: { mobile?: boolean; round?: string; retained?: SocietyCommunity[] } = {}
) {
  context.progress(0, "Locating communities and traversable connections");
  const river = channelAccess(state),
    coast = coastalFishery(state),
    units = seedCells(state, river, coast, context, options.retained);
  // The draw makes the units; each unit then settles the site its geography offers,
  // and the country is divided again from the sites.
  const draft = assignCells(state, units);
  const chosen = chooseSettlementSites(state, context, draft.owner, units, river, coast, {
    mobile: options.mobile ?? false,
    // A round, like the present, finds the camps of the rounds before it.
    ruins: roundRuins(state),
  });
  const pinned = retainedSeatCells(state, options.retained);
  state.numerical?.releaseUnused([draft.owner, draft.distances], []);
  const sites = [
    ...pinned,
    ...chosen.map((choice) => choice.cell).filter((cell) => !pinned.includes(cell)),
  ];
  const { owner, distances } = assignCells(state, sites);
  for (const values of [owner, river, coast]) values.retain?.();
  const communities = sites.map((cell) => ({
    ...community(state, cell),
    ...(chosen.find((choice) => choice.cell === cell)?.site
      ? { site: chosen.find((choice) => choice.cell === cell)!.site! }
      : {}),
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
    river,
    coast,
    ...(options.round ? { round: options.round } : {}),
    inherited: false,
    changed: new Set(),
    mediumChanged: new Set(),
    magicTouched: new Set(),
    dieOff: new Map(),
    deathsRecorded: new Set(),
  };
  refreshSocietySupport(state);
  region.connections = connectionsFor(state, communities, owner, distances);
  state.numerical?.releaseUnused([distances], []);
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
  owner: NumericalVector,
  distances: NumericalVector
) {
  const connections = new Map<string, Connection>();
  function* edges() {
    yield* landEdges(state);
    yield* doorEdges(state);
  }
  for (const edge of edges())
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
  owner: NumericalVector,
  distances: NumericalVector,
  connections: Map<string, Connection>
) {
  const spread = new SocietySpread(state, true);
  for (const edge of seaEdges(state))
    if (dryLand(state, edge.a) && owner[edge.a] >= 0)
      spread.seed(edge.b, owner[edge.a], distances[edge.a] + edge.cost);
  spread.run();
  spread.close();
  const { owner: seaOwner, distances: seaDistance } = spread;
  for (const edge of seaEdges(state)) {
    if (dryLand(state, edge.a)) continue;
    connect(
      connections,
      communities,
      seaOwner[edge.a],
      seaOwner[edge.b],
      seaDistance[edge.a] + edge.cost + seaDistance[edge.b],
      "sea"
    );
  }
  for (const edge of seaEdges(state)) {
    if (!dryLand(state, edge.a)) continue;
    connect(
      connections,
      communities,
      owner[edge.a],
      seaOwner[edge.b],
      distances[edge.a] + edge.cost + seaDistance[edge.b],
      "sea"
    );
  }
  state.numerical?.releaseUnused([seaOwner, seaDistance], []);
}
/** Re-evaluate pass and reservoir access without replacing residents or their identities. */
export function refreshSocietyConnections(state: GenerationState) {
  const work = state.society!,
    communities = work.region.communities,
    previous = work.region.connections;
  const seeds = communities.map((c) =>
    nearestSocietySample(state.surface, c.position, (i) => dryLand(state, i))
  );
  if (seeds.some((i) => i < 0)) {
    work.region.connections = [];
    return;
  }
  const { owner, distances } = assignCells(state, seeds);
  for (let index = communities.length; index < seeds.length; index++)
    communities.push(community(state, seeds[index]));
  state.numerical?.releaseUnused([work.owner], [owner]);
  work.owner = owner;
  owner.retain?.();
  const current = connectionsFor(state, communities, owner, distances);
  state.numerical?.releaseUnused([distances], []);
  work.region.connections = retainRegionalConnections(
    current,
    previous,
    new Set(communities.map((c) => c.id))
  );
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
