import { population, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState } from "./process";
import { communityRoutes } from "./societyContact";
import { compactGroups } from "./societyGroups";
import { profileOf } from "./societyProfile";
import { concentration, contactPopulation } from "./societySettlements";
import { peopleTrait } from "./societyTraits";

/**
 * Where town-dwellers live. Every catchment supports a share of its people outside primary
 * production (`concentration`); part of that share stays in the local market, the rest goes
 * to whichever centre within reach draws it. A centre draws by the town it already is, by a
 * seat of government, a harbour or a pass, less by travel cost; so one town in a region
 * becomes the city of its hinterland while the others stay market towns, and the city is fed
 * by the country it drew from, bounded by the food its own catchment holds.
 */
export interface UrbanAllocation {
  /** Town residents each community's catchment and hinterland support, per community index. */
  targets: Float64Array;
  /** Per centre: the communities that send it town-dwellers and how many each sends. */
  contributions: { from: number; residents: number }[][];
  /** Per centre: its least-cost tree over the contact graph, so flows can wear the ways they use. */
  paths: Map<number, { previous: Int32Array; via: Int32Array }>;
}
/** The share of a catchment's town-dwellers who stay in its own markets whatever is in reach. */
const localShare = 0.3;
/**
 * Of those, the share living in the catchment's chief town; the rest are its villages and
 * market towns, below the World mesh and so latent for a finer profile (ADR 0005).
 */
const chiefTownShare = 0.5;
/** The most of a catchment's food that may feed town-dwellers; the rest keeps its country. */
const townFoodShare = 0.5;
/** A centre's draw grows faster than its size: the bigger market wins its hinterland. */
const sizeExponent = 1.3;
/** A town needs this many residents to draw at all; smaller places are the countryside. */
const drawingTown = 200;
function siteDraw(c: SocietyCommunity, seats: ReadonlySet<string>) {
  let draw = 1;
  if (seats.has(c.id)) draw *= 2.5;
  switch (c.site?.kind) {
    case "harbour":
      draw *= 1.6;
      break;
    case "fire-seat":
      draw *= 1.4;
      break;
    case "pass":
      draw *= 1.3;
      break;
    case "river-node":
      draw *= 1.2;
      break;
  }
  return draw;
}
/** The room a centre has for town-dwellers once its own country people are fed. */
function townRoom(state: GenerationState, c: SocietyCommunity) {
  const capacity = c.support.capacity / Math.max(0.01, peopleTrait(state, c, "foodDemand", 1));
  return capacity * townFoodShare;
}
/** A town's pull on its surroundings: nothing below the drawing size, then more than linear. */
function townPull(c: SocietyCommunity, seats: ReadonlySet<string>) {
  const town = c.settlement?.population ?? 0;
  if (c.status !== "inhabited" || town < drawingTown) return 0;
  return Math.pow(town, sizeExponent) * siteDraw(c, seats);
}
/**
 * weights[a]: for each centre b within reach of a, how strongly b draws a's town-dwellers.
 * The reach is the travel cost over which a draw falls by e; beyond four reaches it is nothing.
 */
function centreWeights(state: GenerationState, seats: ReadonlySet<string>) {
  const region = state.society!.region,
    communities = region.communities;
  const reach = profileOf(state).cityReach;
  const routes = communityRoutes(region);
  const weights = communities.map(() => new Map<number, number>()),
    paths: UrbanAllocation["paths"] = new Map();
  for (const [b, c] of communities.entries()) {
    const pull = townPull(c, seats);
    if (pull <= 0) continue;
    const { distance, previous, via } = routes(b);
    paths.set(b, { previous, via });
    for (let a = 0; a < communities.length; a++) {
      if (a === b || distance[a] > 4 * reach) continue;
      weights[a].set(b, pull * Math.exp(-distance[a] / reach));
    }
  }
  // A catchment deals with a few centres, not every town in reach: this bounds the flows a
  // cycle moves to a handful per community whatever the world's size.
  for (const [a, w] of weights.entries())
    if (w.size > centresPerCommunity)
      weights[a] = new Map(
        [...w].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, centresPerCommunity)
      );
  return { weights, paths };
}
const centresPerCommunity = 3;
/** Scale a centre's incoming town-dwellers down to the room its country leaves them. */
function boundByFood(state: GenerationState, allocation: UrbanAllocation) {
  const { targets, contributions } = allocation;
  for (const [b, c] of state.society!.region.communities.entries()) {
    const room = townRoom(state, c);
    if (targets[b] <= room) continue;
    const home = contributions[b].find((x) => x.from === b)?.residents ?? 0,
      incoming = targets[b] - home,
      allowed = Math.max(0, room - home),
      scale = incoming > 0 ? allowed / incoming : 0;
    for (const x of contributions[b]) if (x.from !== b) x.residents *= scale;
    targets[b] = home + allowed;
  }
  return allocation;
}
export function urbanTargets(state: GenerationState): UrbanAllocation {
  const region = state.society!.region,
    communities = region.communities;
  const contact = contactPopulation(state);
  const seats = new Set(
    (region.politics?.polities ?? []).filter((p) => p.status !== "collapsed").map((p) => p.seat)
  );
  const { weights, paths } = centreWeights(state, seats);
  const targets = new Float64Array(communities.length),
    contributions: UrbanAllocation["contributions"] = communities.map(() => []);
  for (const [a, own] of communities.entries()) {
    const demand = concentration(own, contact.get(own.id) ?? 0);
    own.latentSettlementPopulation = demand * localShare * (1 - chiefTownShare);
    const home = townPull(own, seats);
    let total = home;
    for (const w of weights[a].values()) total += w;
    const mobile = demand * (1 - localShare);
    const stays =
      demand * localShare * chiefTownShare + (total > 0 ? (mobile * home) / total : mobile);
    targets[a] += stays;
    contributions[a].push({ from: a, residents: stays });
    for (const [b, w] of weights[a]) {
      const residents = (mobile * w) / total;
      targets[b] += residents;
      contributions[b].push({ from: a, residents });
    }
  }
  return boundByFood(state, { targets, contributions, paths });
}
/** The share of each contributor's people one centre takes this cycle toward its target. */
function drawFractions(
  communities: readonly SocietyCommunity[],
  people: readonly number[],
  taken: number[],
  b: number,
  allocation: UrbanAllocation,
  response: number
) {
  const centre = communities[b],
    draws: { from: number; fraction: number }[] = [];
  if (centre.protected || centre.status !== "inhabited") return draws;
  const gap = allocation.targets[b] - (centre.settlement?.population ?? 0);
  const sent = allocation.contributions[b].filter(
    (x) => x.from !== b && !communities[x.from].protected && people[x.from] > 0
  );
  const total = sent.reduce((sum, x) => sum + x.residents, 0);
  if (gap <= 0 || total <= 0) return draws;
  for (const { from, residents } of sent) {
    const fraction = Math.min(
      (gap * response * residents) / total / people[from],
      maxDrawPerCycle - taken[from]
    );
    // Fewer than one person is not a migration; it would only fragment the groups.
    if (fraction <= 0 || fraction * people[from] < 1) continue;
    taken[from] += fraction;
    draws.push({ from, fraction });
  }
  return draws;
}
/** No catchment loses more than this share of its people to the centres in one cycle. */
const maxDrawPerCycle = 0.3;
/** Movers from `from` to centre `b` walk the centre's tree; every way on it carries them. */
function chargeWays(
  traffic: Float64Array,
  tree: { previous: Int32Array; via: Int32Array } | undefined,
  from: number,
  b: number,
  movers: number
) {
  if (!tree) return;
  for (let cur = from, steps = 0; cur !== b && cur >= 0 && steps < tree.via.length; steps++) {
    if (tree.via[cur] >= 0) traffic[tree.via[cur]] += movers;
    cur = tree.previous[cur];
  }
}
/**
 * Centres draw the town-dwellers their hinterland sends them: each cycle a centre closes a
 * share of the gap between its target and its town, taking people from each contributor in
 * proportion to what that contributor sends, never more than a bounded share of a
 * contributor's people in one cycle. Movers carry their groups. Returns the people moved.
 */
export function drawToCentres(state: GenerationState, years: number, allocation: UrbanAllocation) {
  const communities = state.society!.region.communities;
  const response = 1 - Math.exp(-years / 30);
  const people = communities.map((c) => population(c)),
    taken = communities.map(() => 0),
    incoming = communities.map(() => [] as SocietyCommunity["groups"]);
  const traffic = (state.society!.traffic ??= new Float64Array(
    state.society!.region.connections.length
  ));
  let moved = 0;
  for (let b = 0; b < communities.length; b++)
    for (const { from, fraction } of drawFractions(
      communities,
      people,
      taken,
      b,
      allocation,
      response
    )) {
      const movers = fraction * people[from];
      moved += movers;
      chargeWays(traffic, allocation.paths.get(b), from, b, movers);
      for (const g of communities[from].groups)
        incoming[b].push({ ...g, count: g.count * fraction });
    }
  for (const [i, c] of communities.entries())
    if (taken[i] > 0 || incoming[i].length)
      c.groups = compactGroups([
        ...c.groups.map((g) => ({ ...g, count: g.count * (1 - taken[i]) })),
        ...incoming[i],
      ]);
  return moved;
}
