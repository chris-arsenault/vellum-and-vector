import { closedByAridity } from "../water/closedBasin";
import { fractalNoise } from "../world/noise";
import { capturedSinks, connectedSea, smoothedBase } from "./base";
import { influenceCosts } from "./causes/registry";
import { evolveNetwork } from "./evolution";
import { distance, frameEdge, isContent, neighborsOf, positionOf, regionalSpan } from "./lattice";
import { materialResistance } from "./material";
import { clamp, type NetworkWork, type RegionalState } from "./state";
import { ask } from "../coupling/answers";
import { physicalContext } from "../world/context";
import { waterPassage } from "../water/waterQuantity";
import { gathered, riverSizes } from "../water/riverSize";

/** Resistance near a known peak or cone, so channels cut around it and it stands on a divide. */
const peakRepulsion = 12;
/**
 * Heterogeneity of the ground's erodibility: it decides between valleys the organizing terms
 * leave equal. On a plain nothing else does, and the water finds its way through every local
 * unevenness; on a slope the fall decides.
 */
const steepRoughness = 0.5,
  flatRoughness = 1.6,
  flatGradient = 0.01,
  // The longest unevenness of the ground's erodibility, as a number of the map's samples.
  roughnessSpan = 20,
  roughnessOctaves = 4;
const referenceRunoff = 0.0000001;
export const secondsPerYear = 365.25 * 24 * 3600;

/** Discharge of one interior sample at reference runoff, in m³/s. */
export function referenceDischarge(state: RegionalState) {
  const scale = state.physical.map.scale;
  return (scale.length(referenceRunoff) * scale.cellArea()) / secondsPerYear;
}

/**
 * Grow the drainage network once (spec 7.3) by eroding the smoothed captured base down to
 * the established waters (the connected sea, the valleys that leave the frame, captured
 * lakes and the parent's closed basins) through the ground's erodibility: the material
 * bands along the grain, the captured courses and the known peaks. Where the network
 * branches, joins, runs along strike or breaks through a band is a consequence of that
 * erosion; no random geography is drawn. Heights are metres above the present sea level.
 */
export function growNetwork(state: RegionalState): NetworkWork {
  const map = state.physical.map,
    n = map.mesh.count,
    datum = MapScale.metres(map.EffectiveSeaLevel, "native"),
    evidence = state.regional.evidence!,
    base = smoothedBase(state, datum),
    sea = connectedSea(state, base),
    lake = new Int32Array(n).fill(-1);
  evidence.lakes.forEach(({ cells }, k) => {
    for (const i of cells) if (!sea[i]) lake[i] = k;
  });
  const network: NetworkWork = {
    receiver: new Int32Array(n).fill(-1),
    order: new Int32Array(n),
    count: 0,
    cost: new Float64Array(n),
    area: new Float64Array(n),
    flow: new Float64Array(n),
    inflow: new Float64Array(n),
    steadyInflow: new Float64Array(n),
    inflowCatchment: new Float64Array(n),
    channel: new Uint8Array(n),
    level: new Float64Array(n),
    sea,
    base,
    lake,
    ...capturedSinks(state, base, sea, lake),
  };
  for (const entry of evidence.entries) {
    network.inflow[entry.cell] = entry.discharge;
    network.steadyInflow[entry.cell] = entry.least;
    network.inflowCatchment[entry.cell] = entry.catchment;
  }
  const root = networkRoots(state, network);
  evolveNetwork(state, network, root, cellCosts(state, sea, base));
  gatherFlow(state, network);
  // Every cell takes its root's level, receivers first (the order the tree was grown in).
  const { receiver, order, level } = network;
  for (let k = 0; k < network.count; k++) {
    const i = order[k];
    if (receiver[i] >= 0) level[i] = level[receiver[i]];
  }
  state.regional.network = network;
  return network;
}

const closedBasin = (state: RegionalState, i: number) =>
  closedByAridity(state.physical.map, state.physical.profile, i);

/**
 * Roots: every land cell beside the sea or at an exit across the frame drains out; lake cells
 * receive their tributaries at the lake's level; a captured sink's floor receives its own
 * where the climate keeps the basin closed. Captured exit levels seed this initial proposal;
 * subsequent physical development can change them.
 */
function networkRoots(state: RegionalState, network: NetworkWork) {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    { sea, base, lake, sink, level } = network,
    evidence = state.regional.evidence!,
    root = new Uint8Array(n),
    around = new Int32Array(mesh.stride),
    guarded = entryProtection(state, evidence.entries),
    exits = edgeExits(state),
    shore = (i: number) => {
      const m = neighborsOf(mesh, i, around);
      for (let k = 0; k < m; k++) if (sea[around[k]]) return true;
      return false;
    };
  openWetBasins(state, sink);
  const rootLevel = (i: number) => {
    if (lake[i] >= 0) return evidence.lakes[lake[i]].level;
    if (sink[i]) return base[i];
    if (exits[i] && !guarded[i]) return Math.max(base[i], 1);
    return shore(i) ? 0 : null;
  };
  for (let i = 0; i < n; i++) {
    if (sea[i] || !isContent(mesh, i)) continue;
    const at = rootLevel(i);
    if (at === null) continue;
    level[i] = at;
    root[i] = 1;
  }
  return root;
}
/** A wet basin is a hollow its water overflows, not an end: it keeps its bowl, not its sink. */
function openWetBasins(state: RegionalState, sink: Uint8Array) {
  for (let i = 0; i < sink.length; i++) if (sink[i] && !closedBasin(state, i)) sink[i] = 0;
}

/**
 * Upstream area and discharge gathered down the tree. An entering river drains country
 * beyond the frame: the catchment the parent map gives it. A channel is where a river is: water
 * gathered from a catchment the map shows, in a river's amount (`water/riverSize`), so dry
 * country needs a larger catchment for the same flow.
 */
export function gatherFlow(state: RegionalState, network: NetworkWork) {
  const map = state.physical.map,
    mesh = map.mesh,
    context = physicalContext(state.regional.input.seed, 0, state.physical.profile),
    supply = ask(map, "surfaceWater", context),
    pass = waterPassage(map, context),
    { receiver, order, count, area, flow, inflow, channel } = network;
  area.fill(0);
  flow.fill(0);
  for (let k = 0; k < count; k++) {
    const i = order[k],
      runoff = Math.max(0, MapScale.metres(supply.get(i), "mm"));
    area[i] = mesh.contentArea(i) + network.inflowCatchment[i];
    flow[i] = (runoff * mesh.contentArea(i)) / secondsPerYear + inflow[i];
  }
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k],
      j = receiver[i];
    flow[i] = pass(i, flow[i]);
    if (j < 0) continue;
    area[j] += area[i];
    flow[j] += flow[i];
  }
  const river = riverSizes(map.scale);
  channel.fill(0);
  for (let k = 0; k < count; k++) {
    const i = order[k];
    channel[i] = Number(
      gathered(area[i], river) &&
        flow[i] >= river.discharge * slopeFactor(mesh, network, i) &&
        network.lake[i] < 0
    );
  }
}
/** Gradient of the captured base at which the channel threshold is the reference. */
const referenceGradient = 0.02;
/**
 * The river network's slope factor (checklist row): gullies start earlier on steep ground
 * and later on plains, so a channel on a slope five times the reference needs less than half
 * the flow and one on a plain up to twice as much.
 */
function slopeFactor(
  mesh: RegionalState["physical"]["map"]["mesh"],
  network: NetworkWork,
  i: number
) {
  const j = network.receiver[i];
  if (j < 0) return 1;
  const gradient = Math.abs(network.base[i] - network.base[j]) / distance(mesh, i, j);
  return clamp(Math.sqrt(referenceGradient / Math.max(1e-4, gradient)), 0.5, 2);
}

/** Mark the tree path from a cell down to the nearest channel as channel: the stream it stands on. */
export function promoteChannel(state: RegionalState, cell: number) {
  const network = state.regional.network!,
    river = riverSizes(state.physical.map.scale);
  for (let i = cell; i >= 0 && !network.channel[i]; i = network.receiver[i]) {
    if (network.flow[i] < river.discharge * 0.2) return false;
    network.channel[i] = 1;
  }
  return true;
}

/**
 * The cost of running water through a cell: material resistance (bands, rock, fractures),
 * the heterogeneity that decides between routes the organizing terms leave equal, repulsion
 * around the character's cones, and the established features' influence (peak massifs,
 * course corridors, river seats) through the cause registry.
 */
function cellCosts(state: RegionalState, sea: Uint8Array, base: Float64Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    cost = new Float64Array(n),
    flat = flatness(state, base);
  for (let i = 0; i < n; i++) {
    if (sea[i]) continue;
    const p = positionOf(mesh, i),
      amplitude = steepRoughness + (flatRoughness - steepRoughness) * flat[i],
      roughness = fractalNoise(
        p.x,
        p.y,
        state.regional.input.seed ^ 0x3a27,
        map.scale.cells(roughnessSpan),
        roughnessOctaves
      );
    cost[i] = materialResistance(state, i) * Math.exp(amplitude * roughness);
  }
  influenceCosts(state, cost);
  for (const cone of state.regional.character!.cones) repel(state, cost, cone.cell, cone.radius);
  return cost;
}

/** How flat the captured base is at each cell: one on a plain, zero on a slope. */
function flatness(state: RegionalState, base: Float64Array) {
  const mesh = state.physical.map.mesh,
    around = new Int32Array(mesh.stride),
    flat = new Float64Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) {
    const m = neighborsOf(mesh, i, around);
    let steepest = 0;
    for (let k = 0; k < m; k++) {
      const j = around[k];
      steepest = Math.max(steepest, Math.abs(base[j] - base[i]) / distance(mesh, i, j));
    }
    flat[i] = clamp(1 - steepest / flatGradient);
  }
  return flat;
}

/** Cells within `reach` of a centre, by breadth-first walk, with their distances. */
function within(state: RegionalState, center: number, reach: number) {
  const mesh = state.physical.map.mesh,
    around = new Int32Array(mesh.stride),
    cells = [center],
    distances = [0],
    seen = new Uint8Array(mesh.count);
  seen[center] = 1;
  for (let head = 0; head < cells.length; head++) {
    const m = neighborsOf(mesh, cells[head], around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (seen[j]) continue;
      const d = distance(mesh, center, j);
      if (d > reach) continue;
      seen[j] = 1;
      cells.push(j);
      distances.push(d);
    }
  }
  return { cells, distances };
}

/** The factor on each cell's cost around a peak or cone, dearest on the cell itself. */
export function repulsion(state: RegionalState, center: number, reach: number) {
  const { cells, distances } = within(state, center, reach * 2.5);
  return cells.map((cell, k) => {
    const d = distances[k] / reach;
    return { cell, factor: (1 + peakRepulsion * Math.exp(-d * d)) * (cell === center ? 50 : 1) };
  });
}
/** Dear ground around a peak or cone, dearest on the cell itself. */
export function repel(state: RegionalState, cost: Float64Array, center: number, reach: number) {
  for (const { cell, factor } of repulsion(state, center, reach)) cost[cell] *= factor;
}

/** Scale the cost of every cell within `reach` of a centre. */
export function scaleAround(
  state: RegionalState,
  cost: Float64Array,
  center: number,
  reach: number,
  by: number
) {
  for (const i of within(state, center, reach).cells) cost[i] *= by;
}

/**
 * Water leaves the frame wherever the exterior is no higher: an exit is a frame-edge cell
 * that the parent's channel raster leaves through, or that has exterior ground no higher
 * than itself to run on to. These initial roots carry contextual drainage into detail
 * realization. They do not constrain later routing or reconcile the child's edge heights.
 */
function edgeExits(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    exits = new Uint8Array(n),
    inherited = state.regional.inheritedHeight,
    around = new Int32Array(mesh.stride);
  const descends = (i: number) => {
    const m = neighborsOf(mesh, i, around);
    let exterior = false;
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (isContent(mesh, j)) continue;
      exterior = true;
      if (inherited.get(j) <= inherited.get(i)) return true;
    }
    return !exterior && mesh.boundary(i);
  };
  for (let i = 0; i < n; i++)
    if (frameEdge(mesh, i) && (map.RiverOrders.get(i) > 0 || descends(i))) exits[i] = 1;
  return exits;
}

/** Edge cells beside a river entry do not drain the entering river straight back out. */
function entryProtection(state: RegionalState, entries: { cell: number }[]) {
  const guarded = new Uint8Array(state.physical.map.mesh.count),
    reach = 2 * regionalSpan(state);
  for (const { cell } of entries) for (const i of within(state, cell, reach).cells) guarded[i] = 1;
  return guarded;
}
import { MapScale } from "@atlas/domain";
