import {
  fieldPosition,
  gridPosition,
  point,
  spatial,
  translateGeometry,
  type AtlasFeature,
  type Position,
  settlementSiteKinds,
} from "@atlas/domain";
import { KeyedHeap } from "@atlas/domain";
import { generationFeatures } from "../generationFeatures";
import { putRefinementFeature, putRefinementNetwork } from "./features";
import { regionalCommunitySpacing } from "../regionalSociety";
import { clamp, distance, neighbors, type RefinementState } from "./state";
import { regionalMoisture } from "./environment";
import { localTownShare } from "../societySettlements";
import { rankSites, type SiteOpportunity } from "../societySites";
import { hashUnit } from "../canonry/noise";
import { regionalOccupation } from "./occupation";

export function refinePlaces(state: RefinementState) {
  if (!state.input.domains.some((id) => ["built", "cultural", "political"].includes(id))) return;
  retainSocietySeats(state);
  retainSocietyEvents(state);
  regionalOccupation(state);
  const g = state.surface,
    known = [...generationFeatures(state, { areaId: state.input.areaId })].filter(
      (f) => f.kind === "settlement" && f.geometry.type === "Point"
    ),
    seats = known.map((f) => ({
      feature: f,
      cell: cellAt(state, (f.geometry as GeoJSON.Point).coordinates),
    })),
    spacing = regionalCommunitySpacing(state),
    bins = new Map<string, Position[]>(),
    heap = new KeyedHeap(),
    sites = rankSites(state),
    access = waterAccess(state);
  for (const seat of seats) addBin(state, bins, seat.cell, spacing);
  for (let i = 0; i < g.active.length; i++) {
    const residents = localResidents(state, i, spacing, access);
    // Unresolved occupation remains in the captured density field. Suitable but empty
    // country does not imply a village, and no parent population is allocated or spent.
    if (residents >= 80) heap.push(i, sitePriority(state, i, residents, sites[i]));
  }
  while (heap.size) {
    const i = heap.pop(),
      p = gridPosition(g, i);
    if (nearSeat(bins, p, spacing)) continue;
    const population = Math.round(localResidents(state, i, spacing, access)),
      f = village(state, i, population, sites[i]);
    seats.push({ feature: f, cell: i });
    addBin(state, bins, i, spacing);
  }
  connectSeats(state, seats);
}
function village(
  state: RefinementState,
  i: number,
  population: number,
  site: SiteOpportunity | null
) {
  return putRefinementFeature(
    state,
    `village:${i}`,
    "settlement",
    "settlements",
    point(gridPosition(state.surface, i)),
    {
      population,
      settlementPopulation: population,
      status: "inhabited",
      founded: "Revealed in regional detail",
      scale: "village",
      siteKind: site?.kind ?? "rural",
      siteReason: site?.reason ?? "local farming and grazing country",
    },
    "Village"
  );
}
function sitePriority(
  state: RefinementState,
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
function retainSocietyEvents(state: RefinementState) {
  const society = state.domain.world.societies?.[state.input.areaId];
  if (!society) return;
  const intersects = spatial.intersectionPredicate(state.surface.scope.footprint);
  for (const event of society.events) {
    const geometry = spatial.buffer(point(event.position), event.radius);
    if (!geometry || !intersects(geometry)) continue;
    putRefinementFeature(
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
function retainSocietySeats(state: RefinementState) {
  const society = state.domain.world.societies?.[state.input.areaId];
  if (!society) return;
  const covered = spatial.pointCoverage(state.surface.scope.footprint),
    known = [...generationFeatures(state, { areaId: state.input.areaId })].filter(
      (f) => f.kind === "settlement"
    );
  for (const c of society.communities) {
    if (!c.founded || !covered(c.position)) continue;
    if (known.some((f) => f.attributes.communityId === c.id || f.name === c.name)) continue;
    const f = putRefinementFeature(
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
function cellAt(state: RefinementState, coordinate: number[]) {
  const g = state.surface,
    p = fieldPosition(g, { x: coordinate[0], y: coordinate[1], z: 0 }),
    x = Math.round(((p.x - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * (g.width - 1)),
    y = Math.round(((p.y - g.bounds[1]) / (g.bounds[3] - g.bounds[1])) * (g.height - 1));
  return Math.max(0, Math.min(g.height - 1, y)) * g.width + Math.max(0, Math.min(g.width - 1, x));
}
/** Samples over which reach to a river, lake or shore fades out. */
const waterReach = 4;
/** Share of a site's support that wells and rain give away from surface water. */
const drylandShare = 0.25;
function siteScore(state: RefinementState, i: number, access: Float64Array) {
  const c = state.surface.channels;
  if (c.water.get(i) !== 0 || c.temperature.get(i) < -5 || c.slope.get(i) > 0.12) return 0;
  // Villages gather along rivers, lakes and shores; humid uplands support fewer.
  const water = Math.max(access[i], drylandShare * regionalMoisture(state, i)),
    soil = clamp(c.soilDepth.get(i)),
    climate = clamp((c.temperature.get(i) + 5) / 25);
  return soil * water * climate * (1 - clamp(c.slope.get(i) * 5));
}
function localResidents(state: RefinementState, i: number, spacing: number, access: Float64Array) {
  const density = Math.max(0, state.surface.channels.populationDensity?.get(i) ?? 0);
  return ((density * spacing ** 2) / 1e6) * localTownShare * siteScore(state, i, access);
}
/** Reach to surface water: one at a river, lake or shore, fading over `waterReach` samples. */
function waterAccess(state: RefinementState) {
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
function addBin(state: RefinementState, bins: Map<string, Position[]>, i: number, size: number) {
  const p = gridPosition(state.surface, i),
    key = binKey(p, size);
  if (!bins.has(key)) bins.set(key, []);
  bins.get(key)!.push(p);
}
function nearSeat(bins: Map<string, Position[]>, p: Position, size: number) {
  const x = Math.floor(p.x / size),
    y = Math.floor(p.y / size);
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      if (
        (bins.get(`${x + dx}:${y + dy}`) ?? []).some((q) => Math.hypot(p.x - q.x, p.y - q.y) < size)
      )
        return true;
  return false;
}
function connectSeats(state: RefinementState, seats: { feature: AtlasFeature; cell: number }[]) {
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
        f = putRefinementFeature(
          state,
          `way:${key}`,
          "road",
          "roads",
          { type: "LineString", coordinates },
          { from: seat.feature.id, to: seats[b].feature.id, routeType: "local" },
          "Local way"
        );
      putRefinementNetwork(state, f, 0, coordinates);
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
const searches = new WeakMap<RefinementState, PathSearch>();
function pathSearch(state: RefinementState) {
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
export function regionalPath(state: RefinementState, start: number, end: number): number[] | null {
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
