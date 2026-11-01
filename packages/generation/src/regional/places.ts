import {
  canonicalPosition,
  gridPosition,
  point,
  population,
  spatial,
  settlementSiteKinds,
  KeyedHeap,
} from "@atlas/domain";
import { generationFeatures } from "../generationFeatures";
import { regionalCommunitySpacing } from "../regionalSociety";
import { localTownShare } from "../societySettlements";
import { rankSites, type SiteOpportunity } from "../societySites";
import { regionalMoisture } from "./climate";
import { proposedSeat } from "./evidence";
import { putRegionalFeature } from "./extraction/features";
import { usableSite } from "./seats";
import {
  channel,
  clamp,
  gridNeighbors,
  neighbors,
  spacing as gridSpacing,
  type ProposedPlace,
  type RegionalState,
} from "./state";
import { connectSeats, slopeCost } from "./ways";

const societyDomains = ["built", "cultural", "political"];
export function placesEnabled(state: RegionalState) {
  return state.input.domains.some((id) => societyDomains.includes(id));
}

/** Samples over which reach to a river, lake or shore fades out. */
const waterReach = 4;
/** Residents an inhabited mapped village needs, by the existing occupation model, and the
 * higher bar open country away from water and sites must clear. */
const villageResidents = 80,
  openCountryResidents = 240;
/** Share of a site's support that wells and rain give away from surface water. */
const drylandShare = 0.25;
/** How far, in travel cost, a village's hinterland reaches, as a share of the community spacing. */
const hinterlandReach = 1.5;
/** Travel cost of fording a channel. */
const fordCost = 3;
/** Most elimination rounds of the hinterland competition; it ends sooner once every place is supported. */
const competitionRounds = 24;
/** Cells within which two candidate sites are the same place. */
const samePlace = 2;

/** Society's own seats and occupation enter before the evidence is read. */
export function preparePlaces(state: RegionalState) {
  if (!placesEnabled(state)) return;
  retainSocietySeats(state);
  regionalOccupation(state);
}

/**
 * New local places are the network's own events (spec 6.3): junctions, mouths, fords, cols,
 * bays, springs and the magical sites the developed geography offers, read once in round
 * two. They compete for hinterland over the travel cost of the present surface; a place
 * whose hinterland cannot support a village gives way to its neighbours. Spacing is a
 * consequence of that competition: valleys and shores fill, uplands stay sparse.
 */
export function proposePlaces(state: RegionalState) {
  if (!placesEnabled(state) || !state.surface.channels.populationDensity) return;
  const sites = (state.sites = rankSites(state)),
    access = waterAccess(state),
    seats = (state.evidence?.seats ?? [])
      .filter((seat) => seat.strength === "established")
      .map((seat) => seat.cell),
    support = (i: number) => siteScore(state, i, access),
    needed = (i: number) =>
      sites[i] || access[i] >= 0.25 ? villageResidents : openCountryResidents,
    candidates = compete(
      state,
      seats,
      eventCandidates(state, sites, access, seats),
      (i, residents) => residents * support(i) * localTownShare >= needed(i)
    ),
    residents = hinterlandResidents(state, [...seats, ...candidates]);
  for (const i of candidates)
    recordProposal(state, i, residents.get(i)! * support(i) * localTownShare, sites[i]);
}

function recordProposal(
  state: RegionalState,
  cell: number,
  population: number,
  site: SiteOpportunity | null
) {
  state.proposed.push({
    cell,
    population: Math.round(population),
    siteKind: site?.kind ?? "rural",
    siteReason: site?.reason ?? "local farming and grazing country",
    accepted: true,
  });
  state.evidence?.seats.push(proposedSeat(state, `village:${cell}`, cell));
}

/** The weakest third of the unsupported candidates gives way each round; the rest compete again. */
function compete(
  state: RegionalState,
  seats: number[],
  candidates: number[],
  supported: (cell: number, residents: number) => boolean
) {
  for (let round = 0; round <= competitionRounds && candidates.length; round++) {
    const residents = hinterlandResidents(state, [...seats, ...candidates]),
      weak = candidates.filter((i) => !supported(i, residents.get(i)!));
    if (!weak.length) break;
    if (round === competitionRounds) return candidates.filter((i) => !weak.includes(i));
    // The weakest half of the unsupported give way; the rest compete for their ground.
    weak.sort((a, b) => residents.get(a)! - residents.get(b)! || a - b);
    const leaving = new Set(weak.slice(0, Math.max(1, Math.ceil(weak.length / 2))));
    candidates = candidates.filter((i) => !leaving.has(i));
  }
  return candidates;
}

/** Candidate places: one per event cluster, in order of the event's reliability. */
function eventCandidates(
  state: RegionalState,
  sites: (SiteOpportunity | null)[],
  access: Float64Array,
  seats: number[]
) {
  const g = state.surface,
    density = g.channels.populationDensity,
    ranked: number[] = [],
    rank = (i: number) =>
      sites[i] ? settlementSiteKinds.indexOf(sites[i]!.kind) : settlementSiteKinds.length,
    // Open country is a candidate only where the occupation is dense enough to gather.
    gathers = (i: number) =>
      Boolean(sites[i]) || access[i] >= 0.25 || density.get(i) * localTownShare >= 1;
  for (let i = 0; i < g.active.length; i++)
    if (usableSite(state, i) && density.get(i) > 0 && siteScore(state, i, access) > 0 && gathers(i))
      ranked.push(i);
  ranked.sort(
    (a, b) => rank(a) - rank(b) || (sites[b]?.score ?? 0) - (sites[a]?.score ?? 0) || a - b
  );
  const accepted: number[] = [],
    near = (i: number, j: number) =>
      Math.abs((i % g.width) - (j % g.width)) <= samePlace &&
      Math.abs(Math.floor(i / g.width) - Math.floor(j / g.width)) <= samePlace;
  for (const i of ranked)
    if (!seats.some((s) => near(i, s)) && !accepted.some((a) => near(i, a))) accepted.push(i);
  return accepted;
}

/**
 * Residents in each place's hinterland: every land cell belongs to the place it can reach at
 * the least travel cost over the present surface, within the hinterland reach.
 */
function hinterlandResidents(state: RegionalState, places: number[]) {
  const g = state.surface,
    n = g.active.length,
    c = g.channels,
    density = c.populationDensity,
    cost = new Float64Array(n).fill(Infinity),
    owner = new Int32Array(n).fill(-1),
    heap = new KeyedHeap(),
    around = new Int32Array(8),
    [dx, dy] = gridSpacing(g),
    reach = regionalCommunitySpacing(state) * hinterlandReach,
    residents = new Map<number, number>();
  for (const p of places) {
    residents.set(p, 0);
    cost[p] = 0;
    owner[p] = p;
    heap.push(p, 0);
  }
  const travel = (i: number, j: number) => {
    const step = Math.hypot(
        ((j % g.width) - (i % g.width)) * dx,
        (Math.floor(j / g.width) - Math.floor(i / g.width)) * dy
      ),
      ford = c.riverOrder.get(j) > 0 ? fordCost : 1,
      slope = Math.abs(c.elevation.get(j) - c.elevation.get(i)) / step;
    return step * (1 + slope * slopeCost) * ford;
  };
  while (heap.size) {
    const i = heap.pop();
    if (heap.poppedKey() !== cost[i]) continue;
    const m = gridNeighbors(g.width, g.height, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (c.water.get(j) !== 0) continue;
      const next = cost[i] + travel(i, j);
      if (next >= cost[j] || next > reach) continue;
      cost[j] = next;
      owner[j] = owner[i];
      heap.push(j, next);
    }
  }
  for (let i = 0; i < n; i++)
    if (owner[i] >= 0)
      residents.set(
        owner[i],
        residents.get(owner[i])! + (Math.max(0, density.get(i)) * g.measures.get(i)) / 1e6
      );
  return residents;
}

/**
 * A proposed place has weaker influence than an established one: if the terrain that
 * developed under it in round three is no longer usable it moves to usable ground within
 * one cell or is dropped. It does not reshape the region.
 */
export function supportProposals(state: RegionalState) {
  if (!placesEnabled(state)) return;
  const sites = state.sites ?? [];
  for (const proposal of state.proposed) {
    if (usableSite(state, proposal.cell)) continue;
    const moved = flattestUsableNeighbour(state, proposal.cell);
    if (moved < 0) {
      proposal.accepted = false;
      continue;
    }
    proposal.cell = moved;
    proposal.siteKind = sites[moved]?.kind ?? proposal.siteKind;
    proposal.siteReason = sites[moved]?.reason ?? proposal.siteReason;
  }
}
function flattestUsableNeighbour(state: RegionalState, cell: number) {
  const slope = state.surface.channels.slope;
  let moved = -1;
  for (const j of neighbors(state.surface, cell))
    if (usableSite(state, j) && (moved < 0 || slope.get(j) < slope.get(moved))) moved = j;
  return moved;
}

/** Publish the accepted villages and the local ways; society events keep their footprint. */
export function extractPlaces(state: RegionalState) {
  if (!placesEnabled(state)) return;
  retainSocietyEvents(state);
  const seats = [...generationFeatures(state, { areaId: state.input.areaId })]
    .filter((f) => f.kind === "settlement" && f.geometry.type === "Point")
    .map((f) => ({
      feature: f,
      cell:
        state.evidence?.seats.find((seat) => seat.featureId === f.id)?.cell ??
        nearestCell(state, (f.geometry as GeoJSON.Point).coordinates),
    }));
  for (const proposal of state.proposed)
    if (proposal.accepted) seats.push({ feature: village(state, proposal), cell: proposal.cell });
  connectSeats(state, seats);
}
function nearestCell(state: RegionalState, [x, y]: number[]) {
  const g = state.surface,
    col = Math.round(((x - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * (g.width - 1)),
    row = Math.round(((y - g.bounds[1]) / (g.bounds[3] - g.bounds[1])) * (g.height - 1));
  return clamp(row, 0, g.height - 1) * g.width + clamp(col, 0, g.width - 1);
}

function village(state: RegionalState, proposal: ProposedPlace) {
  return putRegionalFeature(
    state,
    `village:${proposal.cell}`,
    "settlement",
    "settlements",
    point(gridPosition(state.surface, proposal.cell)),
    {
      population: proposal.population,
      settlementPopulation: proposal.population,
      status: "inhabited",
      founded: "Revealed in regional detail",
      scale: "village",
      siteKind: proposal.siteKind,
      siteReason: proposal.siteReason,
    },
    "Village"
  );
}
function retainSocietyEvents(state: RegionalState) {
  const society = state.domain.world.societies?.[state.input.areaId];
  if (!society) return;
  const intersects = spatial.intersectionPredicate(state.surface.scope.footprint);
  for (const event of society.events) {
    const geometry = spatial.buffer(point(event.position), event.radius);
    if (!geometry || !intersects(geometry)) continue;
    putRegionalFeature(
      state,
      `event:${event.id}`,
      "societyEvent",
      "historicalEvents",
      geometry,
      {
        era: event.era,
        eventKind: event.kind,
        casualties: event.casualties,
        displaced: event.displaced,
      },
      event.kind
    );
  }
}
function retainSocietySeats(state: RegionalState) {
  const society = state.domain.world.societies?.[state.input.areaId];
  if (!society) return;
  const covered = spatial.pointCoverage(state.surface.scope.footprint),
    known = [...generationFeatures(state, { areaId: state.input.areaId })].filter(
      (f) => f.kind === "settlement"
    );
  for (const c of society.communities) {
    if (!c.founded || !covered(c.position)) continue;
    if (known.some((f) => f.attributes.communityId === c.id || f.name === c.name)) continue;
    const f = putRegionalFeature(
      state,
      `known-seat:${c.id}`,
      "settlement",
      "settlements",
      point(c.position),
      { communityId: c.id, population: c.settlement?.population ?? 0, status: c.status },
      c.name
    );
    f.name = c.name;
    f.placeId = c.id;
    if (state.features) state.features.put(f);
    else state.domain.world.features[f.id] = f;
  }
}
/** Present located residents can supply a missing projection; an explicit field remains authoritative. */
function regionalOccupation(state: RegionalState) {
  if (state.surface.channels.populationDensity) return;
  const communities =
    state.domain.world.societies?.[state.input.areaId]?.communities.filter(
      (c) => c.footprint && c.areaKm2 > 0 && population(c) > 0
    ) ?? [];
  if (!communities.length) return;
  const g = state.surface,
    density = channel(state, "populationDensity", "people/square-kilometre"),
    footprints = communities.map((c) => c.footprint!),
    coverage = footprints.map((shape) => spatial.pointCoverage(shape));
  spatial.withIndex(footprints, (index) => {
    for (let i = 0; i < g.active.length; i++) {
      const p = canonicalPosition(state.domain.world.reference, gridPosition(g, i));
      for (const k of index.query([p.x, p.y, p.x, p.y]))
        if (coverage[k](p)) density.add(i, population(communities[k]) / communities[k].areaKm2);
    }
  });
}
function siteScore(state: RegionalState, i: number, access: Float64Array) {
  const c = state.surface.channels;
  if (c.water.get(i) !== 0 || c.temperature.get(i) < -5 || c.slope.get(i) > 0.12) return 0;
  // Villages gather along rivers, lakes and shores; humid uplands support fewer.
  const water = Math.max(access[i], drylandShare * regionalMoisture(state, i)),
    soil = clamp(c.soilDepth.get(i)),
    climate = clamp((c.temperature.get(i) + 5) / 25);
  return soil * water * climate * (1 - clamp(c.slope.get(i) * 5));
}
/** Reach to surface water: one at a river, lake or shore, fading over `waterReach` samples. */
function waterAccess(state: RegionalState) {
  const g = state.surface,
    c = g.channels,
    n = g.active.length,
    steps = new Int32Array(n).fill(-1),
    queue = new Int32Array(n),
    access = new Float64Array(n);
  let write = 0;
  for (let i = 0; i < n; i++)
    if (c.water.get(i) !== 0 || c.riverOrder.get(i) > 0) {
      steps[i] = 0;
      queue[write++] = i;
    }
  for (let read = 0; read < write; read++) {
    const i = queue[read];
    access[i] = clamp(1 - steps[i] / waterReach);
    if (steps[i] >= waterReach) continue;
    for (const j of neighbors(g, i))
      if (steps[j] < 0) {
        steps[j] = steps[i] + 1;
        queue[write++] = j;
      }
  }
  return access;
}

export { regionalPath } from "./ways";
