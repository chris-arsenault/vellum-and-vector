import type { AtlasFeature } from "@atlas/domain";
import { generationFeatures } from "../generationFeatures";
import { putRegionalFeature, putRegionalNetwork } from "./extraction/features";
import { cellAt, distance, isContent, positionOf, stepVector } from "./lattice";
import type { RegionalState } from "./state";
import { regionalPath, type PathOptions } from "./ways";

/** Travellers a year that wear a track and a road: a tenth of the world's counts. */
export const trackTravellers = 10,
  roadTravellers = 100;
/** How much worn ground discounts travel, and the cost of fording a channel. */
const wearDiscount = 0.6,
  fordCost = 3;
/** River flow (m³/s) above which a road crosses by a bridge. */
const bridgeFlow = 20;

export interface Place {
  feature: AtlasFeature | null;
  cell: number;
  residents: number;
  settled: boolean;
}
type Flow = { from: Place; to: Place; travellers: number };
type Path = Flow & { cells: number[] | null };
type Position = { x: number; y: number };

/**
 * Ways by use: every settled place sends its residents to the market seat and half as many to
 * its nearest larger neighbour; the flows are traced over the present surface with captured
 * roads as inherited wear and door ends as free edges, twice, the second time over the ground
 * the first pass wore, so later lanes bend into earlier ways. Each way is published at the
 * class its own flow earns. Returns the traffic per cell and the channel cells the ways ford.
 */
export function traceWays(state: RegionalState, places: Place[]) {
  const mesh = state.physical.map.mesh,
    inherited = inheritedWear(state),
    settled = places.filter((p) => p.settled && p.residents > 0),
    links = doorLinks(state),
    channels = channelLinks(state),
    flows = commutingFlows(mesh, settled);
  let traffic = Float64Array.from(inherited),
    crossed = new Float64Array(mesh.count);
  for (let pass = 0; pass < 2; pass++) {
    const worn = traffic,
      options: PathOptions = {
        links,
        factor: (i, j) => wornFactor(state, channels, worn, i, j),
      },
      paths: Path[] = flows.map((flow) => ({
        ...flow,
        cells: regionalPath(state, flow.from.cell, flow.to.cell, options),
      }));
    // Each pass wears the inherited ground afresh with this pass's flows.
    traffic = Float64Array.from(inherited);
    crossed = new Float64Array(mesh.count);
    for (const path of paths) wear(state, channels, path, traffic, crossed);
    if (pass === 1) for (const path of paths) if (path.cells) publishWay(state, path);
  }
  return { traffic, crossed };
}
/** Worn ground is cheaper to travel; a channel on the way, under the step or across it, costs a ford. */
function wornFactor(
  state: RegionalState,
  channels: Channels,
  worn: Float64Array,
  i: number,
  j: number
) {
  const ford = fordAt(state, channels, i, j) >= 0 ? fordCost : 1;
  return ford / (1 + wearDiscount * Math.log2(1 + worn[j] / trackTravellers));
}
/** A path wears its cells and fords the channel cells its steps land on or cross. */
function wear(
  state: RegionalState,
  channels: Channels,
  path: Path,
  traffic: Float64Array,
  crossed: Float64Array
) {
  const cells = path.cells ?? [];
  for (const [k, i] of cells.entries()) {
    traffic[i] += path.travellers;
    if (k === 0) continue;
    const ford = fordAt(state, channels, cells[k - 1], i);
    if (ford >= 0) crossed[ford] += path.travellers;
  }
}

/**
 * The channels as the drainage tree's links between channel cells, indexed by every cell a
 * link covers (its ends and the cells it passes between), so a step finds the links it could
 * cross among the cells it covers itself: two short segments that cross share a covered cell.
 */
interface Channels {
  from: number[];
  to: number[];
  at: Map<number, number[]>;
}
function channelLinks(state: RegionalState): Channels {
  const map = state.physical.map,
    mesh = map.mesh,
    receiver = state.regional.drainage?.receiver,
    channels: Channels = { from: [], to: [], at: new Map() };
  if (!receiver) return channels;
  const channel = (i: number) => isContent(mesh, i) && map.RiverOrders.get(i) > 0,
    water = (i: number) => i >= 0 && (channel(i) || map.WaterKindCodes.get(i) !== 0);
  for (let i = 0; i < mesh.count; i++) {
    const r = receiver[i];
    if (!channel(i) || !water(r)) continue;
    const k = channels.from.length;
    channels.from.push(i);
    channels.to.push(r);
    for (const c of [i, r, ...swept(state, i, r)]) {
      const list = channels.at.get(c) ?? [];
      list.push(k);
      channels.at.set(c, list);
    }
  }
  return channels;
}
/**
 * The channel cell a step fords, or -1: the channel cell it lands on, or the nearer channel end
 * of a drainage link whose segment the step's segment crosses (both the tree and a path link
 * cells across the vertex ring, so a channel runs between cells a path never touches).
 */
function fordAt(state: RegionalState, channels: Channels, i: number, j: number) {
  const map = state.physical.map,
    mesh = map.mesh;
  if (map.RiverOrders.get(j) > 0) return j;
  const a = positionOf(mesh, i),
    b = positionOf(mesh, j),
    ends = new Set([i, j]),
    candidates = new Set<number>();
  for (const c of [i, j, ...swept(state, i, j)])
    for (const k of channels.at.get(c) ?? []) candidates.add(k);
  for (const k of candidates) {
    const from = channels.from[k],
      to = channels.to[k];
    if (ends.has(from) || ends.has(to)) continue;
    if (segmentsCross(a, b, positionOf(mesh, from), positionOf(mesh, to)))
      return nearerChannelEnd(state, from, to, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  return -1;
}
/** The link end that is a channel cell nearest the crossing; a lake or sea end is no ford. */
function nearerChannelEnd(state: RegionalState, from: number, to: number, x: number, y: number) {
  const map = state.physical.map;
  if (map.RiverOrders.get(to) <= 0 || map.WaterKindCodes.get(to) !== 0) return from;
  const p = positionOf(map.mesh, from),
    q = positionOf(map.mesh, to);
  return Math.hypot(p.x - x, p.y - y) <= Math.hypot(q.x - x, q.y - y) ? from : to;
}
const turn = (a: Position, b: Position, c: Position) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
/** Whether segments ab and cd cross at an interior point. */
function segmentsCross(a: Position, b: Position, c: Position, d: Position) {
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}
/**
 * The cells a step passes through without landing on them, read at its quarter points. A step
 * reaches at most two centroid spacings across the vertex ring, so the segment crosses at
 * most the cells around one shared vertex; a face step passes nothing.
 */
function swept(state: RegionalState, i: number, j: number) {
  const mesh = state.physical.map.mesh,
    a = positionOf(mesh, i),
    { dx, dy } = stepVector(mesh, i, j),
    cells: number[] = [];
  for (const t of [0.25, 0.5, 0.75]) {
    const c = cellAt(mesh, a.x + dx * t, a.y + dy * t);
    if (c >= 0 && c !== i && c !== j && isContent(mesh, c) && !cells.includes(c)) cells.push(c);
  }
  return cells;
}

/** Residents to the market seat, half as many to the nearest larger place. */
function commutingFlows(mesh: RegionalState["physical"]["map"]["mesh"], settled: Place[]) {
  const flows: Flow[] = [];
  if (settled.length < 2) return flows;
  const market = settled.reduce((a, b) => (b.residents > a.residents ? b : a));
  for (const from of settled) {
    if (from === market) continue;
    flows.push({ from, to: market, travellers: from.residents });
    const larger = settled
      .filter((p) => p !== from && p !== market && p.residents > from.residents)
      .sort((a, b) => distance(mesh, from.cell, a.cell) - distance(mesh, from.cell, b.cell))[0];
    if (larger) flows.push({ from, to: larger, travellers: from.residents / 2 });
  }
  return flows;
}
/** A captured road's cells are worn ground already (plan: roads as inherited wear). */
function inheritedWear(state: RegionalState) {
  const mesh = state.physical.map.mesh,
    traffic = new Float64Array(mesh.count);
  for (const f of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    if (f.kind !== "road" || f.attributes.developedBy === "regional") continue;
    if (f.geometry.type !== "LineString") continue;
    for (const [x, y] of f.geometry.coordinates) {
      const i = cellAt(mesh, x, y);
      if (i >= 0 && isContent(mesh, i)) traffic[i] = Math.max(traffic[i], roadTravellers);
    }
  }
  return traffic;
}
/**
 * The line through cell centres carries the lattice's stair steps; corner cutting (two
 * Chaikin passes, ends kept) draws the way the path takes without them.
 */
function cutCorners(line: number[][]) {
  let out = line;
  for (let pass = 0; pass < 2 && out.length > 2; pass++) {
    const next = [out[0]];
    for (let k = 0; k < out.length - 1; k++) {
      const [ax, ay] = out[k],
        [bx, by] = out[k + 1];
      next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
      next.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    next.push(out.at(-1)!);
    out = next;
  }
  return out;
}
/** A door's ends join the travel graph for nothing (plan X4). */
function doorLinks(state: RegionalState) {
  const links = new Map<number, number>();
  for (const field of state.physical.magic?.fields ?? [])
    for (const door of field.doors) {
      links.set(door.a, door.b);
      links.set(door.b, door.a);
    }
  return links;
}
/**
 * A way is a land road at the class its own flow earns: a road above the road count, a track
 * below (the smallest flows are tracks the map draws thin; `routeType` keeps the plan's lane
 * class on the record). The catalogue's `lane` is a shipping lane and is never used for land.
 */
function publishWay(state: RegionalState, path: Path) {
  const mesh = state.physical.map.mesh,
    coordinates = cutCorners(
      path.cells!.map((i) => {
        const p = positionOf(mesh, i);
        return [p.x, p.y];
      })
    ),
    routeType =
      path.travellers >= roadTravellers
        ? "road"
        : path.travellers >= trackTravellers
          ? "track"
          : "lane",
    roadClass = routeType === "road" ? "road" : "track",
    f = putRegionalFeature(
      state,
      `way:${path.from.cell}:${path.to.cell}`,
      "road",
      "roads",
      { type: "LineString", coordinates },
      {
        from: path.from.feature?.id,
        to: path.to.feature?.id,
        routeType,
        roadClass,
        travellers: path.travellers,
      },
      routeType === "lane" ? "Lane" : routeType === "track" ? "Track" : "Road"
    );
  putRegionalNetwork(state, f, 0, coordinates);
}

/** Where ways ford channels (plan S4): a ford, or a bridge where a road meets a sizeable river. A seat's own channel cell is no crossing. */
export function publishCrossings(
  state: RegionalState,
  traffic: Float64Array,
  crossed: Float64Array,
  seatCells: Set<number>
) {
  const map = state.physical.map;
  for (let i = 0; i < map.mesh.count; i++) {
    if (crossed[i] <= 0 || seatCells.has(i) || map.WaterKindCodes.get(i) !== 0) continue;
    const travellers = Math.max(traffic[i], crossed[i]),
      bridge = travellers >= roadTravellers && map.FlowAccumulation.get(i) >= bridgeFlow,
      p = positionOf(map.mesh, i);
    putRegionalFeature(
      state,
      `crossing:${i}`,
      bridge ? "bridge" : "ford",
      "transportSites",
      { type: "Point", coordinates: [p.x, p.y] },
      { workKind: bridge ? "bridge" : "ford", flow: map.FlowAccumulation.get(i), travellers },
      bridge ? "Bridge" : "Ford"
    );
  }
}
