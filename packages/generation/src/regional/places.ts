import {
  canonicalPosition,
  MapScale,
  fieldInterpolator,
  population,
  spatial,
  settlementSiteKinds,
  KeyedHeap,
} from "@atlas/domain";
import { projectNative, selectedNativeProjection } from "../world/atlasProjection";
import { runOperation } from "../processOperation";
import { processOwner } from "../processTraits";
import type { MapProcessContext } from "../process";
import { generationFeature, generationFeatures } from "../generationFeatures";
import { publishKinds } from "../poi/poiPublish";
import { regionalCommunitySpacing } from "../regionalSociety";
import { localTownShare } from "../societySettlements";
import { rankSites, type SiteOpportunity } from "../societySites";
import { celsius, regionalMoisture } from "./climate";
import { regionalId } from "./extraction/features";
import {
  cellAt,
  distance,
  isContent,
  neighborhood,
  neighborhoodCapacity,
  neighborsOf,
  positionOf,
} from "./lattice";
import { proposedSeat, usableSite } from "./seats";
import { clamp, type RegionalState } from "./state";
import { developSociety } from "./society";
import { fordCost } from "./societyWays";
import { slopeCost } from "./ways";

const societyDomains = ["built", "cultural", "political"];
export function placesEnabled(domains: string[]) {
  return domains.some((id) => societyDomains.includes(id));
}

/** Samples over which reach to a river, lake or shore fades out. */
// length-unit: ratio
const waterReach = 4;
/** Residents an inhabited mapped village needs, by the existing occupation model, and the
 * higher bar open country away from water and sites must clear. */
const villageResidents = 80,
  openCountryResidents = 240;
/** Share of a site's support that wells and rain give away from surface water. */
const drylandShare = 0.25;
/** How far, in travel cost, a village's hinterland reaches, as a share of the community spacing. */
// length-unit: ratio
const hinterlandReach = 1.5;
/** Most elimination rounds of the hinterland competition; it ends sooner once every place is supported. */
const competitionRounds = 24;
/** Cells within which two candidate sites are the same place. */
const samePlace = 2;

/** Society's own seats and occupation enter before the evidence is read. */
export function preparePlaces(state: RegionalState) {
  if (!placesEnabled(state.regional.input.domains)) return;
  publishKinds(state, "society");
  regionalOccupation(state);
}

/**
 * New local places are the network's own events (spec 6.3): junctions, mouths, fords, cols,
 * bays, springs and the magical sites the developed geography offers, read once in round
 * two. They compete for hinterland over the travel cost of the present surface; a place
 * whose hinterland cannot support a village gives way to its neighbours. Spacing is a
 * consequence of that competition: valleys and shores fill, uplands stay sparse.
 */
export function proposePlaces(state: RegionalState, context: MapProcessContext) {
  const density = state.regional.populationDensity;
  if (!placesEnabled(state.regional.input.domains) || !density) return;
  const sites = (state.regional.sites = siteClasses(state, context)),
    access = waterAccess(state),
    seats = (state.regional.evidence?.seats ?? [])
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

/**
 * The developed terrain's site classes per mesh cell. The society engine's classifier reads
 * the surface, so the field is projected onto it first and each surface sample's class is
 * carried to the physical cell beneath it.
 */
function siteClasses(state: RegionalState, context: MapProcessContext): (SiteOpportunity | null)[] {
  runOperation(processOwner(state), projectNative, selectedNativeProjection(state, context));
  const work = state.physical,
    rank = (site: SiteOpportunity) => settlementSiteKinds.indexOf(site.kind),
    sites: (SiteOpportunity | null)[] = new Array(work.map.mesh.count).fill(null),
    perSample = rankSites(state);
  for (let s = 0; s < perSample.length; s++) {
    const site = perSample[s];
    if (!site) continue;
    const cell = work.samples.get(s);
    if (cell < 0) continue;
    const held = sites[cell];
    if (!held || rank(site) < rank(held) || (rank(site) === rank(held) && site.score > held.score))
      sites[cell] = site;
  }
  return sites;
}

function recordProposal(
  state: RegionalState,
  cell: number,
  residents: number,
  site: SiteOpportunity | null
) {
  state.regional.proposed.push({
    cell,
    population: Math.round(residents),
    siteKind: site?.kind ?? "rural",
    siteReason: site?.reason ?? "local farming and grazing country",
    accepted: true,
  });
  state.regional.evidence?.seats.push(proposedSeat(state, `village:${cell}`, cell));
}

/** The weakest half of the unsupported candidates gives way each round; the rest compete again. */
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
  const mesh = state.physical.map.mesh,
    density = state.regional.populationDensity!,
    ranked: number[] = [],
    rank = (i: number) =>
      sites[i] ? settlementSiteKinds.indexOf(sites[i]!.kind) : settlementSiteKinds.length,
    // Open country is a candidate only where the occupation is dense enough to gather.
    gathers = (i: number) =>
      Boolean(sites[i]) || access[i] >= 0.25 || density[i] * localTownShare >= 1;
  for (let i = 0; i < mesh.count; i++)
    if (usableSite(state, i) && density[i] > 0 && siteScore(state, i, access) > 0 && gathers(i))
      ranked.push(i);
  ranked.sort(
    (a, b) => rank(a) - rank(b) || (sites[b]?.score ?? 0) - (sites[a]?.score ?? 0) || a - b
  );
  const accepted: number[] = [],
    near = (i: number, j: number) =>
      distance(mesh, i, j) <= state.physical.map.scale.cells(samePlace * 1.5);
  for (const i of ranked)
    if (!seats.some((s) => near(i, s)) && !accepted.some((a) => near(i, a))) accepted.push(i);
  return accepted;
}

/**
 * Residents in each place's hinterland: every land cell belongs to the place it can reach at
 * the least travel cost over the present surface, within the hinterland reach.
 */
function hinterlandResidents(state: RegionalState, places: number[]) {
  const mesh = state.physical.map.mesh,
    density = state.regional.populationDensity!,
    { owner } = hinterlandOwners(state, places),
    residents = new Map<number, number>();
  for (const p of places) residents.set(p, 0);
  for (let i = 0; i < mesh.count; i++)
    if (owner[i] >= 0)
      residents.set(
        owner[i],
        residents.get(owner[i])! +
          Math.max(0, density[i]) * MapScale.areaUnits(mesh.contentArea(i), "m2", "km2")
      );
  return residents;
}
/**
 * The hinterland partition: every land cell belongs to the place it can reach at the least
 * travel cost over the present surface, within the hinterland reach; the cost of reaching it.
 */
export function hinterlandOwners(state: RegionalState, places: number[]) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    cost = new Float64Array(n).fill(Infinity),
    owner = new Int32Array(n).fill(-1),
    heap = new KeyedHeap(),
    around = new Int32Array(neighborhoodCapacity),
    reach = regionalCommunitySpacing(state) * hinterlandReach,
    height = (i: number) => MapScale.metres(map.Elevation.get(i), "native");
  for (const p of places) {
    cost[p] = 0;
    owner[p] = p;
    heap.push(p, 0);
  }
  const travel = (i: number, j: number) => {
      const step = distance(mesh, i, j),
        ford = map.RiverOrders.get(j) > 0 ? fordCost : 1,
        slope = Math.abs(height(j) - height(i)) / step;
      return step * (1 + slope * slopeCost) * ford;
    },
    passable = (j: number) => isContent(mesh, j) && map.WaterKindCodes.get(j) === 0,
    claim = (i: number, j: number) => {
      const next = cost[i] + travel(i, j);
      if (next >= cost[j] || next > reach) return;
      cost[j] = next;
      owner[j] = owner[i];
      heap.push(j, next);
    };
  while (heap.size) {
    const i = heap.pop();
    if (heap.poppedKey() !== cost[i]) continue;
    const m = neighborhood(mesh, i, around);
    for (let k = 0; k < m; k++) if (passable(around[k])) claim(i, around[k]);
  }
  return { owner, cost };
}

/**
 * A proposed place has weaker influence than an established one: if the terrain that
 * developed under it in round three is no longer usable it moves to usable ground within
 * one cell or is dropped. It does not reshape the region.
 */
export function supportProposals(state: RegionalState) {
  if (!placesEnabled(state.regional.input.domains)) return;
  const sites = state.regional.sites ?? [];
  for (const proposal of state.regional.proposed) {
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
  const map = state.physical.map,
    around = new Int32Array(map.mesh.stride),
    m = neighborsOf(map.mesh, cell, around);
  let moved = -1;
  for (let k = 0; k < m; k++) {
    const j = around[k];
    if (usableSite(state, j) && (moved < 0 || map.Slope.get(j) < map.Slope.get(moved))) moved = j;
  }
  return moved;
}

/**
 * Publish the map's places, trace the local ways between its seats, then publish the crossings
 * and mills those ways make. Each entry writes a record once; a later pass adds what is new.
 */
export function extractPlaces(state: RegionalState) {
  if (!placesEnabled(state.regional.input.domains)) return;
  publishKinds(state, "society");
  const mesh = state.physical.map.mesh,
    villageIds = new Set(
      state.regional.proposed.map((proposal) => regionalId(state, `village:${proposal.cell}`))
    ),
    seats = [...generationFeatures(state, { areaId: state.regional.input.areaId })]
      .filter(
        (f) => f.kind === "settlement" && f.geometry.type === "Point" && !villageIds.has(f.id)
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((f) => ({
        feature: f,
        cell:
          state.regional.evidence?.seats.find((seat) => seat.featureId === f.id)?.cell ??
          cellAt(mesh, ...((f.geometry as GeoJSON.Point).coordinates as [number, number])),
      }))
      .filter((seat) => seat.cell >= 0);
  for (const proposal of state.regional.proposed) {
    const feature =
      proposal.accepted && generationFeature(state, regionalId(state, `village:${proposal.cell}`));
    if (feature) seats.push({ feature, cell: proposal.cell });
  }
  developSociety(state, seats);
  publishKinds(state, "society");
}

/**
 * The captured occupation per mesh cell: the parent's published density where there is one,
 * else the present located residents over their footprints.
 */
function regionalOccupation(state: RegionalState) {
  const mesh = state.physical.map.mesh,
    density = new Float64Array(mesh.count),
    surface = state.surface;
  if (surface.channels.populationDensity) {
    const at = fieldInterpolator(surface, "populationDensity");
    for (let i = 0; i < mesh.count; i++) density[i] = Math.max(0, at(positionOf(mesh, i)));
    state.regional.populationDensity = density;
    return;
  }
  const communities =
    state.domain.world.societies?.[state.regional.input.areaId]?.communities.filter(
      (c) => c.footprint && c.areaKm2 > 0 && population(c) > 0
    ) ?? [];
  if (!communities.length) return;
  const footprints = communities.map((c) => c.footprint!),
    coverage = footprints.map((shape) => spatial.pointCoverage(shape));
  spatial.withIndex(footprints, (index) => {
    for (let i = 0; i < mesh.count; i++) {
      const p = canonicalPosition(state.domain.world.reference, positionOf(mesh, i));
      for (const k of index.query([p.x, p.y, p.x, p.y]))
        if (coverage[k](p)) density[i] += population(communities[k]) / communities[k].areaKm2;
    }
  });
  state.regional.populationDensity = density;
}
function siteScore(state: RegionalState, i: number, access: Float64Array) {
  const map = state.physical.map,
    temperature = celsius(state, i);
  if (map.WaterKindCodes.get(i) !== 0 || temperature < -5 || map.Slope.get(i) > 0.12) return 0;
  // Villages gather along rivers, lakes and shores; humid uplands support fewer.
  const water = Math.max(access[i], drylandShare * regionalMoisture(state, i)),
    soil = clamp(map.SoilDepth.get(i)),
    climate = clamp((temperature + 5) / 25);
  return soil * water * climate * (1 - clamp(map.Slope.get(i) * 5));
}
/** Reach to surface water: one at a river, lake or shore, fading over `waterReach` samples. */
function waterAccess(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    steps = new Int32Array(n).fill(-1),
    queue = new Int32Array(n),
    access = new Float64Array(n),
    around = new Int32Array(mesh.stride);
  let write = 0;
  for (let i = 0; i < n; i++)
    if (map.WaterKindCodes.get(i) !== 0 || map.RiverOrders.get(i) > 0) {
      steps[i] = 0;
      queue[write++] = i;
    }
  for (let read = 0; read < write; read++) {
    const i = queue[read];
    access[i] = clamp(1 - steps[i] / waterReach);
    if (steps[i] >= waterReach) continue;
    const m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (steps[j] < 0) {
        steps[j] = steps[i] + 1;
        queue[write++] = j;
      }
    }
  }
  return access;
}
