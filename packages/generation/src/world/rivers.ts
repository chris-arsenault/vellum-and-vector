// RiverNetworkLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { contributingArea, sourceToOutletOrder } from "./flowGraph";
import { depthRateToDischarge } from "./dimensions";
import { edgeLeadingTo } from "./mesh";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { ask } from "../coupling/answers";
import { waterPassage } from "./waterQuantity";
import { riverFlow } from "../water/channelRegime";
import { waterYearOf } from "../water/runoff";
import { months } from "../water/waterBalance";

/**
 * The cells that carry a river: those the gathered water reaches with a river's flow in at
 * least one month of the year (see `channelRegime`). Each cell is judged on what reaches it
 * and on nothing else: no share of its basin, no help from the cells below. A river therefore
 * starts where enough water has gathered, and ends where it has lost it.
 */
function buildChannels(map: PhysicalField): Band {
  const channels = workingArray(map, "uint8", "river:channels");
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 0 && map.FlowingMonths.get(i) > 0) channels.set(i, 1);
  return channels;
}
function strahlerOrder(largest: number, count: number): number {
  return largest === 0 ? 1 : count >= 2 ? largest + 1 : largest;
}
function strahlerOrders(map: PhysicalField, order: Band, channels: Band) {
  const largest = workingArray(map, "int32", "river:largest"),
    count = workingArray(map, "int32", "river:count");
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      channel = channels.get(i) !== 0,
      conduit = !channel && map.WaterKindCodes.get(i) === 2 && largest.get(i) > 0;
    if (!channel && !conduit) continue;
    const riverOrder = strahlerOrder(largest.get(i), count.get(i));
    if (channel) map.RiverOrders.set(i, riverOrder);
    const target = map.FlowTargets.get(i);
    if (target < 0) continue;
    if (riverOrder > largest.get(target)) {
      largest.set(target, riverOrder);
      count.set(target, 1);
    } else if (riverOrder === largest.get(target)) count.add(target, 1);
  }
  releaseWorking(map, largest, count);
}
export function carriesSpine(map: PhysicalField, source: number, target: number): boolean {
  return (
    map.RiverOrders.get(source) > 0 ||
    (map.WaterKindCodes.get(source) === 2 &&
      map.WaterKindCodes.get(target) !== 2 &&
      map.RiverOrders.get(target) > 0)
  );
}
function spineMasks(map: PhysicalField) {
  map.RiverSpineEdgeMasks.fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets.get(i);
    if (target < 0 || !carriesSpine(map, i, target)) continue;
    const sourceEdge = edgeLeadingTo(map.mesh, i, target),
      targetEdge = edgeLeadingTo(map.mesh, target, i);
    if (sourceEdge < 0 || targetEdge < 0)
      throw new Error("River spine contains a non-adjacent segment.");
    map.RiverSpineEdgeMasks.set(i, map.RiverSpineEdgeMasks.get(i) | (1 << sourceEdge));
    map.RiverSpineEdgeMasks.set(target, map.RiverSpineEdgeMasks.get(target) | (1 << targetEdge));
  }
}
export function riverNetwork(
  map: PhysicalField,
  c: PhysicalContext,
  incoming?: Band,
  continuingHeads: readonly number[] = []
) {
  const water = ask(map, "surfaceWater", c),
    pass = waterPassage(map, c);
  for (let i = 0; i < map.mesh.count; i++)
    map.FlowAccumulation.set(
      i,
      depthRateToDischarge(water.get(i), map.mesh.area(i)) + (incoming?.get(i) ?? 0)
    );
  const area = contributingArea(map, map.FlowTargets);
  map.CatchmentArea.copyFrom(area);
  releaseWorking(map, area);
  map.RiverOrders.fill(0);
  const order = sourceToOutletOrder(map);
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      target = map.FlowTargets.get(i);
    map.FlowAccumulation.set(i, pass(i, map.FlowAccumulation.get(i)));
    if (map.LakeOutletTargets.get(i) >= 0)
      map.FlowAccumulation.set(i, Math.min(map.FlowAccumulation.get(i), map.LakeOverflow.get(i)));
    if (target >= 0) map.FlowAccumulation.add(target, map.FlowAccumulation.get(i));
  }
  seasonalFlows(map, c, order, incoming);
  const channels = buildChannels(map);
  retainChannels(map, channels, continuingHeads);
  strahlerOrders(map, order, channels);
  spineMasks(map);
  releaseWorking(map, order, channels);
}

/**
 * What each cell's river carries in flood and in its driest season, gathered down the same
 * routes as the mean. A cell's surface gives more in its wetter season and less in its drier;
 * what else reaches the river (springs, melt) comes steadily. A lake evens out what passes
 * through it: below its outlet all three start from what it overflows.
 */
function seasonalFlows(map: PhysicalField, c: PhysicalContext, order: Band, incoming?: Band) {
  const water = ask(map, "surfaceWater", c),
    pass = waterPassage(map, c),
    each = waterYearOf(map),
    flow = workingArray(map, "float64", "river:month-flow"),
    river = riverFlow(map.mesh.area(0), c.Profile.FluvialReferenceRunoff);
  map.FloodFlow.fill(0);
  map.PerennialFlow.fill(Infinity);
  map.FlowingMonths.fill(0);
  for (let month = 0; month < months; month++) {
    for (let i = 0; i < map.mesh.count; i++)
      flow.set(
        i,
        depthRateToDischarge(
          // Springs and melt come steadily; the surface gives what this month gives.
          Math.max(0, water.get(i) - map.Runoff.get(i)) + each[month].get(i) * months,
          map.mesh.area(i)
        ) + (incoming?.get(i) ?? 0)
      );
    for (let n = 0; n < order.length; n++) {
      const i = order.get(n),
        target = map.FlowTargets.get(i);
      flow.set(i, pass(i, flow.get(i)));
      if (map.LakeOutletTargets.get(i) >= 0) flow.set(i, map.FlowAccumulation.get(i));
      if (target >= 0) flow.add(target, flow.get(i));
      noteMonth(map, i, flow.get(i), river);
    }
  }
  for (let i = 0; i < map.mesh.count; i++)
    if (!Number.isFinite(map.PerennialFlow.get(i))) map.PerennialFlow.set(i, 0);
  releaseWorking(map, flow);
}
/** One month's flow at a cell, kept as its greatest and least month and its months in flow. */
function noteMonth(map: PhysicalField, i: number, carried: number, river: number) {
  if (carried > map.FloodFlow.get(i)) map.FloodFlow.set(i, carried);
  if (carried < map.PerennialFlow.get(i)) map.PerennialFlow.set(i, carried);
  if (carried >= river) map.FlowingMonths.add(i, 1);
}
/** Captured named rivers remain channels along their actual present route. */
function retainChannels(map: PhysicalField, channels: Band, heads: readonly number[]) {
  for (const head of heads)
    for (let cell = head; cell >= 0; cell = map.FlowTargets.get(cell)) {
      const water = map.WaterKindCodes.get(cell);
      if (water === 1 || channels.get(cell)) break;
      if (water === 0) channels.set(cell, 1);
    }
}
