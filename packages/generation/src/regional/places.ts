import {
  canonicalPosition,
  gridPosition,
  point,
  population,
  spatial,
  translateGeometry,
  type AtlasFeature,
  type Position,
  settlementSiteKinds,
  KeyedHeap,
} from "@atlas/domain";
import { generationFeatures } from "../generationFeatures";
import { regionalCommunitySpacing } from "../regionalSociety";
import { localTownShare } from "../societySettlements";
import { rankSites, type SiteOpportunity } from "../societySites";
import { hashUnit } from "../canonry/noise";
import { regionalMoisture } from "./climate";
import { putRegionalFeature, putRegionalNetwork } from "./extraction/features";
import { realizeSupports, usableSite } from "./supports";
import {
  cellAt,
  channel,
  clamp,
  distance,
  neighbors,
  type ProposedPlace,
  type RegionalState,
} from "./state";

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

/**
 * Known places first (spec 5.3): captured settlements and society seats are evidence. Each
 * round they are re-sited or supported against the present terrain; in round two the new
 * local places are proposed once; in round three the accepted ones take their support.
 */
export function respondPlaces(state: RegionalState, round: number) {
  if (!placesEnabled(state)) return;
  if (round === 1) {
    retainSocietySeats(state);
    regionalOccupation(state);
  }
  // Site classes are read once the broad organization exists (round two) and kept for the
  // local round; round one supports seats on usable ground alone.
  if (round === 2) state.sites = rankSites(state);
  const sites = state.sites ?? [],
    seats = knownSeats(state);
  realizeSupports(state, seats, sites);
  if (round === 2) proposePlaces(state, seats, sites);
  if (round === 3) supportProposals(state, sites);
}

/** Publish the accepted villages and the local ways; society events keep their footprint. */
export function extractPlaces(state: RegionalState) {
  if (!placesEnabled(state)) return;
  retainSocietyEvents(state);
  const seats = knownSeats(state);
  for (const proposal of state.proposed) {
    if (!proposal.accepted) continue;
    seats.push({ feature: village(state, proposal), cell: proposal.cell });
  }
  connectSeats(state, seats);
}

/**
 * Known seats start from their captured position every time this map is refined, so a seat
 * an earlier refinement moved is re-sited from the same evidence, not from its last move.
 */
function knownSeats(state: RegionalState) {
  return [...generationFeatures(state, { areaId: state.input.areaId })]
    .filter((f) => f.kind === "settlement" && f.geometry.type === "Point")
    .map((f) => {
      const captured = f.attributes.sitedFrom as [number, number] | undefined,
        [x, y] = captured ?? ((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      return { feature: f, cell: cellAt(state, x, y) };
    });
}

/**
 * New local places come from sites and situations the developed terrain offers, in the
 * order of their reliability; their hinterland spacing follows the site class and the
 * local support, so valleys and coasts cluster and uplands stay sparse.
 */
function proposePlaces(
  state: RegionalState,
  seats: { feature: AtlasFeature; cell: number }[],
  sites: (SiteOpportunity | null)[]
) {
  const g = state.surface,
    spacing = regionalCommunitySpacing(state),
    bins = new Map<string, { p: Position; reach: number }[]>(),
    heap = new KeyedHeap(),
    access = waterAccess(state);
  for (const seat of seats) addBin(state, bins, seat.cell, spacing, spacing);
  for (let i = 0; i < g.active.length; i++) {
    const residents = localResidents(state, i, spacing, access),
      // Open country away from water and from any site supports a village only where the
      // occupation is dense; valleys, shores and sites gather them.
      needed = sites[i] || access[i] >= 0.25 ? villageResidents : openCountryResidents;
    // Unresolved occupation remains in the captured density field. Suitable but empty
    // country does not imply a village, and no parent population is allocated or spent.
    if (residents >= needed) heap.push(i, sitePriority(state, i, residents, sites[i]));
  }
  while (heap.size) {
    const i = heap.pop(),
      p = gridPosition(g, i),
      reach = hinterland(
        spacing,
        sites[i],
        access[i],
        hashUnit(state.input.seed ^ 0x2a9d, i % g.width, Math.floor(i / g.width))
      );
    if (nearSeat(bins, p, spacing, reach)) continue;
    state.proposed.push({
      cell: i,
      population: Math.round(localResidents(state, i, spacing, access)),
      siteKind: sites[i]?.kind ?? "rural",
      siteReason: sites[i]?.reason ?? "local farming and grazing country",
      accepted: true,
    });
    addBin(state, bins, i, spacing, reach);
  }
}
/**
 * A place's hinterland: a market site (pass, river node, harbour) claims the full spacing;
 * a plain site a little more, so open country stays sparse; a site on a river, lake or
 * shore tolerates a nearer neighbour, so valleys and coasts cluster. A seeded variation
 * per place keeps uniform country from settling into a lattice.
 */
function hinterland(spacing: number, site: SiteOpportunity | null, access: number, draw: number) {
  const rank = site ? settlementSiteKinds.indexOf(site.kind) : settlementSiteKinds.length,
    classShare = 1 + 0.3 * clamp(rank / settlementSiteKinds.length);
  return spacing * classShare * (access > 0.5 ? 0.8 : 1) * (0.75 + 0.6 * draw);
}

/**
 * A proposed place has weaker influence than an established one: if the terrain that
 * developed under it in round three is no longer usable it moves to usable ground within
 * one cell or is dropped. It does not reshape the region.
 */
function supportProposals(state: RegionalState, sites: (SiteOpportunity | null)[]) {
  const g = state.surface;
  for (const proposal of state.proposed) {
    if (usableSite(state, proposal.cell)) continue;
    let moved = -1;
    for (const j of neighbors(g, proposal.cell))
      if (
        usableSite(state, j) &&
        (moved < 0 || g.channels.slope.get(j) < g.channels.slope.get(moved))
      )
        moved = j;
    if (moved < 0) {
      proposal.accepted = false;
      continue;
    }
    proposal.cell = moved;
    proposal.siteKind = sites[moved]?.kind ?? proposal.siteKind;
    proposal.siteReason = sites[moved]?.reason ?? proposal.siteReason;
  }
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
function sitePriority(
  state: RegionalState,
  i: number,
  residents: number,
  site: SiteOpportunity | null
) {
  const g = state.surface,
    draw = hashUnit(state.input.seed ^ 0x517e, i % g.width, Math.floor(i / g.width)),
    race = -Math.log(Math.max(1e-12, draw)) / (residents * (1 + (site?.score ?? 0))),
    rank = site ? settlementSiteKinds.indexOf(site.kind) : settlementSiteKinds.length;
  // Within a geographic site class, support and terrain outrank the randomized tie.
  if (site) return rank + 1 / (1 + residents * site.score) + draw * 1e-9;
  return rank + race / (1 + race);
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
function localResidents(state: RegionalState, i: number, spacing: number, access: Float64Array) {
  const density = Math.max(0, state.surface.channels.populationDensity?.get(i) ?? 0);
  return ((density * spacing ** 2) / 1e6) * localTownShare * siteScore(state, i, access);
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
function binKey(p: Position, size: number) {
  return `${Math.floor(p.x / size)}:${Math.floor(p.y / size)}`;
}
function addBin(
  state: RegionalState,
  bins: Map<string, { p: Position; reach: number }[]>,
  i: number,
  size: number,
  reach: number
) {
  const p = gridPosition(state.surface, i),
    key = binKey(p, size);
  if (!bins.has(key)) bins.set(key, []);
  bins.get(key)!.push({ p, reach });
}
/** Too close when inside either place's hinterland. */
function nearSeat(
  bins: Map<string, { p: Position; reach: number }[]>,
  p: Position,
  size: number,
  reach: number
) {
  const x = Math.floor(p.x / size),
    y = Math.floor(p.y / size);
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      if (
        (bins.get(`${x + dx}:${y + dy}`) ?? []).some(
          (q) => Math.hypot(p.x - q.p.x, p.y - q.p.y) < Math.max(reach, q.reach)
        )
      )
        return true;
  return false;
}
function connectSeats(state: RegionalState, seats: { feature: AtlasFeature; cell: number }[]) {
  if (seats.length < 2) return;
  const shapes = seats.map((s) => {
      const p = gridPosition(state.surface, s.cell),
        coordinate = (s.feature.geometry as GeoJSON.Point).coordinates;
      return translateGeometry(s.feature.geometry, p.x - coordinate[0]);
    }),
    pairs = new Set<string>();
  spatial.withIndex(shapes, (index) => {
    for (const [a, seat] of seats.entries()) {
      const p = gridPosition(state.surface, seat.cell),
        size = regionalCommunitySpacing(state) * 3,
        nearby = index
          .query([p.x - size, p.y - size, p.x + size, p.y + size])
          .filter((b) => b !== a && seats[b].cell !== seat.cell)
          .sort(
            (b, c) =>
              distance(state.surface, seat.cell, seats[b].cell) -
              distance(state.surface, seat.cell, seats[c].cell)
          );
      const b = nearby[0];
      if (b === undefined) continue;
      const key = [a, b].sort((x, y) => x - y).join(":");
      if (pairs.has(key)) continue;
      pairs.add(key);
      const cells = regionalPath(state, seat.cell, seats[b].cell);
      if (!cells || cells.length < 2) continue;
      const coordinates = cells.map((i) => {
          const p = gridPosition(state.surface, i);
          return [p.x, p.y];
        }),
        f = putRegionalFeature(
          state,
          `way:${key}`,
          "road",
          "roads",
          { type: "LineString", coordinates },
          { from: seat.feature.id, to: seats[b].feature.id, routeType: "local" },
          "Local way"
        );
      putRegionalNetwork(state, f, 0, coordinates);
    }
  });
}
/** Search arrays shared by every path on one map; a stamp marks each search's own entries. */
interface PathSearch {
  cost: Float64Array;
  previous: Int32Array;
  stamp: Uint32Array;
  settled: Uint32Array;
  search: number;
}
const searches = new WeakMap<RegionalState, PathSearch>();
function pathSearch(state: RegionalState) {
  const n = state.surface.active.length;
  let s = searches.get(state);
  if (!s || s.cost.length !== n) {
    s = {
      cost: new Float64Array(n),
      previous: new Int32Array(n),
      stamp: new Uint32Array(n),
      settled: new Uint32Array(n),
      search: 0,
    };
    searches.set(state, s);
  }
  s.search++;
  return s;
}
/** A* follows dry, passable ground; the search is sized by this map's cells. */
export function regionalPath(state: RegionalState, start: number, end: number): number[] | null {
  const g = state.surface,
    front = new KeyedHeap(),
    s = pathSearch(state),
    known = (j: number) => (s.stamp[j] === s.search ? s.cost[j] : Infinity);
  s.stamp[start] = s.search;
  s.cost[start] = 0;
  s.previous[start] = -1;
  front.push(start, 0);
  while (front.size) {
    const i = front.pop();
    if (i === end) return walkPath(s.previous, start, end);
    if (s.settled[i] === s.search) continue;
    s.settled[i] = s.search;
    for (const j of neighbors(g, i)) {
      if (g.channels.water.get(j) !== 0) continue;
      const slope =
          Math.abs(g.channels.elevation.get(j) - g.channels.elevation.get(i)) / distance(g, i, j),
        next = s.cost[i] + distance(g, i, j) * (1 + slope * 12);
      if (next >= known(j)) continue;
      s.stamp[j] = s.search;
      s.cost[j] = next;
      s.previous[j] = i;
      front.push(j, next + distance(g, j, end));
    }
  }
  return null;
}
function walkPath(previous: Int32Array, start: number, end: number) {
  const cells = [end];
  let i = end;
  while (i !== start) {
    i = previous[i];
    if (i < 0) return null;
    cells.push(i);
  }
  return cells.reverse();
}
