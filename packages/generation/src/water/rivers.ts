// RiverNetworkLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "../world/field";
import type { PhysicalContext } from "../world/context";
import { contributingArea, gatherDown, sourceToOutletOrder } from "../world/flowGraph";
import { depthRateToDischarge } from "../world/dimensions";
import { edgeLeadingTo } from "../world/mesh";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "../world/physicalNumerics";
import { ask } from "../coupling/answers";
import { waterPassage, waterPassageParts } from "./waterQuantity";
import { moveFlow } from "./waterLedger";
import { lakeLosses } from "./lakeStage";
import { riverFlow } from "./channelRegime";
import { waterYearOf } from "./runoff";
import { months } from "./waterBalance";
import { closedByAridity } from "./closedBasin";
import { enteringInMonth } from "./inflow";

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
/**
 * What the ground keeps of its rivers. A cell that carries a river is marked with its order.
 * A bed whose river has gone (dried, drawn off or turned elsewhere) stays where the ground is
 * too dry to heal it; in wetter country slopes and growth fill a dry channel long before the
 * next pass, and the mark goes. Water standing on a cell drowns the bed.
 */
function rememberBeds(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    const order = map.RiverOrders.get(i);
    if (order > 0) map.RiverMemory.set(i, order);
    else if (map.RiverMemory.get(i) > 0 && !keepsBed(map, c, i)) map.RiverMemory.set(i, 0);
  }
}
/** A course known from elsewhere to have carried a river of this order: its land remembers it. */
export function rememberCourse(map: PhysicalField, cells: ArrayLike<number>, order: number) {
  for (let n = 0; n < cells.length; n++) {
    const i = cells[n];
    if (map.WaterKindCodes.get(i) === 0 && order > map.RiverMemory.get(i))
      map.RiverMemory.set(i, order);
  }
}
const keepsBed = (map: PhysicalField, c: PhysicalContext, i: number) =>
  map.WaterKindCodes.get(i) === 0 && closedByAridity(map, c.Profile, i);
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
  continuingHeads: readonly number[] = [],
  /** What of the incoming flow still enters in the entering river's driest month. */
  steadyIncoming?: Band
) {
  const area = contributingArea(map, map.FlowTargets);
  map.CatchmentArea.copyFrom(area);
  releaseWorking(map, area);
  map.RiverOrders.fill(0);
  const order = sourceToOutletOrder(map);
  gatherYear(map, c, order, incoming);
  seasonalFlows(map, c, order, incoming, steadyIncoming);
  const channels = buildChannels(map);
  retainChannels(map, channels, continuingHeads);
  strahlerOrders(map, order, channels);
  rememberBeds(map, c);
  spineMasks(map);
  releaseWorking(map, order, channels);
}

/**
 * The water each cell gives its river through the year, and what rivers bring in across the
 * map's edge, gathered down the routes as the year's mean flow.
 */
export function gatherYear(map: PhysicalField, c: PhysicalContext, order: Band, incoming?: Band) {
  const water = ask(map, "surfaceWater", c);
  let entering = 0,
    melt = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const brought = incoming?.get(i) ?? 0,
      area = map.mesh.area(i);
    map.FlowAccumulation.set(i, depthRateToDischarge(water.get(i), area) + brought);
    entering += brought;
    // All the water ice gives up reaches the rivers.
    if (map.WaterKindCodes.get(i) !== 1)
      melt += depthRateToDischarge(map.GlacialMeltwater.get(i), area);
  }
  moveFlow(map, "entering", entering);
  moveFlow(map, "iceMelt", melt);
  gatherMean(map, c, order);
}
/**
 * The year's mean flow gathered down the routes, with what left it on the way entered in the
 * water ledger: what beds took, what people drew, what lakes kept, and what reached the sea
 * or ran off the map's edge.
 */
function gatherMean(map: PhysicalField, c: PhysicalContext, order: Band) {
  const pass = waterPassageParts(map, c),
    left = { bedLoss: 0, withdrawal: 0, inflow: 0, spill: 0, mouth: 0, leaving: 0, pan: 0 };
  gatherDown(order, map.FlowTargets, map.FlowAccumulation, (i, received) => {
    const parts = pass(i, received);
    left.bedLoss += parts.bed;
    left.withdrawal += parts.drawn;
    let flow = parts.passed;
    if (map.LakeOutletTargets.get(i) >= 0) {
      // A lake lets out what it does not lose: what reached its outlet went into it.
      left.inflow += flow;
      flow = Math.min(flow, map.LakeOverflow.get(i));
      left.spill += flow;
    }
    const end = map.WaterKindCodes.get(i) === 1 ? undefined : endOf(map, i, map.FlowTargets.get(i));
    if (end) left[end] += flow;
    return flow;
  });
  for (const move of Object.keys(left) as (keyof typeof left)[]) moveFlow(map, move, left[move]);
  // What lakes took in and did not let out, they lost to the air and the ground.
  const kept = Math.max(0, left.inflow - left.spill),
    can = lakeLosses(map, c),
    whole = can.evaporation + can.seepage;
  moveFlow(map, "lakeEvaporation", whole > 0 ? (kept * can.evaporation) / whole : kept);
  moveFlow(map, "lakeSeepage", whole > 0 ? (kept * can.seepage) / whole : 0);
}
/**
 * Where a cell's water ends, if it ends here: at the sea or the map's edge, in a lake with no
 * way out, or on the dry floor of a closed basin.
 */
function endOf(map: PhysicalField, i: number, target: number) {
  if (target >= 0) return map.WaterKindCodes.get(target) === 1 ? "mouth" : undefined;
  if (map.mesh.boundary(i)) return "leaving";
  return map.WaterKindCodes.get(i) === 2 ? "inflow" : "pan";
}
/**
 * What each cell's river carries in flood and in its driest season, gathered down the same
 * routes as the mean. A cell's surface gives more in its wetter season and less in its drier;
 * what else reaches the river (springs, melt) comes steadily. A lake evens out what passes
 * through it: below its outlet all three start from what it overflows.
 */
function seasonalFlows(
  map: PhysicalField,
  c: PhysicalContext,
  order: Band,
  incoming?: Band,
  steadyIncoming?: Band
) {
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
        ) + enteringInMonth(each, i, month, incoming?.get(i) ?? 0, steadyIncoming)
      );
    gatherDown(order, map.FlowTargets, flow, (i, received) => {
      // A lake evens out the year: its outlet runs at the year's overflow in every month.
      const carried =
        map.LakeOutletTargets.get(i) >= 0 ? map.FlowAccumulation.get(i) : pass(i, received);
      noteMonth(map, i, carried, river);
      return carried;
    });
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
