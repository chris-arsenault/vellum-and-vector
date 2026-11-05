import { units } from "../canonry/math";
import { distance, isContent } from "./lattice";
import { materialResistance } from "./material";
import type { NetworkWork, RegionalState } from "./state";

/** Gradient above which a hillslope fails (talus stands at about 27°), and the share of the excess that fails in one pass. */
const stableGradient = 0.5,
  failureShare = 0.3,
  failureLimit = 40;
/** Share of a valley's incision below the captured base that is moving sediment in one round. */
const incisionSupplyShare = 0.05;
/** Channel gradient below which a load starts to settle, and the distance over which a load settles out on flat ground (m). */
const settlingGradient = 0.004,
  settlingLength = 10_000;
/** The most a cell's floor rises in one round (m), and the share of a load that stops where a channel enters a lake. */
const floorLimit = 15,
  lakeEntryShare = 0.8;

/**
 * Capped mass wasting (plan: one failure pass as a hillslope term after the surface is
 * drainable): a hillslope cell that stands steeper above its receiver than the material holds
 * fails by a bounded share of the excess. The failed rock is the round's sediment supply at
 * that cell. Channels and basins keep their heights; a knickpoint step the base carries is
 * macro character and is softened only by this bounded share.
 */
export function wasteHillslopes(state: RegionalState, h: Float64Array, supply: Float64Array) {
  const mesh = state.physical.map.mesh,
    network = state.regional.network!,
    { receiver, order, count } = network;
  for (let k = count - 1; k >= 0; k--) {
    const j = order[k],
      i = receiver[j];
    if (i < 0 || network.channel[j] || network.lake[j] >= 0 || !isContent(mesh, j)) continue;
    const length = distance(mesh, j, i),
      stable = stableGradient * Math.sqrt(materialResistance(state, j)),
      excess = h[j] - h[i] - stable * length;
    if (excess <= 0) continue;
    const failed = Math.min(failureLimit, excess * failureShare);
    h[j] -= failed;
    supply[j] += failed * mesh.contentArea(j);
  }
}

/**
 * Sediment transport along the network tree (plan: fluvial incision with sediment supply,
 * sediment transport, alluvial floors, fans, lacustrine deltas). The supply is the failed
 * hillslope rock and a share of each channel's incision below the captured base; it travels
 * down the tree and settles where the gradient falls: on floors and at the foot of steep
 * ground as fans, at the first cell of a lake as a small delta, and at the sea as the mouth
 * load the coast will read. Deposits raise the derived surface by their thickness, bounded,
 * and the sediment band is the captured thickness plus the ledger plus this round's deposit.
 */
export function transportSediment(state: RegionalState, h: Float64Array, supply: Float64Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    network = state.regional.network!,
    { deposit, mouthLoad } = routeLoads(state, h, supply);
  // The band already holds the captured thickness, the ledger and this derivation's moraines
  // (the glacial step starts it afresh each derivation); the round's deposit goes on top.
  for (let i = 0; i < n; i++) {
    if (!isContent(mesh, i) || network.sea[i]) continue;
    const thickness = Math.min(floorLimit, deposit[i] / mesh.contentArea(i));
    if (thickness <= 0) continue;
    h[i] += thickness;
    map.SedimentThickness.add(i, units(thickness));
  }
  state.regional.sediment = { mouthLoad };
}

/** Loads gathered down the tree, what settles at each cell and what reaches the sea. */
function routeLoads(state: RegionalState, h: Float64Array, supply: Float64Array) {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    network = state.regional.network!,
    { receiver, order, count, base } = network,
    load = new Float64Array(n),
    deposit = new Float64Array(n),
    mouthLoad = new Float64Array(n);
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k],
      j = receiver[i];
    if (!isContent(mesh, i) || network.sea[i]) continue;
    // A channel's incision below the captured base supplies; a hillslope supplies only what failed.
    const incision = network.channel[i] ? Math.max(0, base[i] - h[i]) : 0;
    load[i] += supply[i] + incision * incisionSupplyShare * mesh.contentArea(i);
    if (j < 0) {
      if (shoreRoot(network, i)) mouthLoad[i] += load[i];
      continue;
    }
    const settled = settledShare(state, i, j) * load[i];
    deposit[i] += settled;
    load[j] += load[i] - settled;
  }
  return { deposit, mouthLoad };
}
/** Only a shore root delivers to the sea; exits, sinks and lake roots end their loads. */
const shoreRoot = (network: NetworkWork, i: number) =>
  network.level[i] <= 0 && network.lake[i] < 0 && !network.sink[i];

/**
 * The share of a cell's load that stops there: a lake entry's first share, else by the
 * captured base's gradient down the tree (the macro slope a load travels; the derived profile's
 * own steps and flats are finer than the round's transport).
 */
function settledShare(state: RegionalState, i: number, j: number) {
  const network = state.regional.network!;
  if (network.lake[j] >= 0 && network.lake[i] < 0) return lakeEntryShare;
  if (network.lake[i] >= 0) return 0;
  const length = distance(state.physical.map.mesh, i, j),
    gradient = Math.max(0, network.base[i] - network.base[j]) / length;
  // A load crossing flat ground settles over kilometres, not in the first flat cell.
  return Math.min(1, length / settlingLength) * Math.max(0, 1 - gradient / settlingGradient);
}
