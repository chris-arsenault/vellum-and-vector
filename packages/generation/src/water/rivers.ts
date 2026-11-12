// RiverNetworkLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "../world/field";
import type { PhysicalContext } from "../world/context";
import { gatherDown, sourceToOutletOrder } from "../world/flowGraph";
import { depthRateToDischarge } from "../world/dimensions";
import { edgeLeadingTo } from "../world/mesh";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "../world/physicalNumerics";
import { ask } from "../coupling/answers";
import { waterPassage, waterPassageParts } from "./waterQuantity";
import { moveFlow } from "./waterLedger";
import { lakeLosses } from "./lakeStage";
import { gathered, riverSizes } from "./riverSize";
import { waterYearOf } from "./runoff";
import { months } from "./waterBalance";
import { keepReaches } from "./riverKeeping";
import { enteringInMonth } from "./inflow";

/**
 * The cells a river runs through: those reached, in at least one month of the year, by a
 * river's flow gathered from a catchment the map shows (see `riverSize`). No share of its
 * basin and no help from the cells below: a river starts where enough water has gathered and
 * ends where it has lost it. One exception is deliberate: a parent map's named river
 * continues on a finer map whatever its water there, because named things persist.
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
  /** Where each of a parent map's rivers that continue here enters. */
  continuingHeads: readonly number[] = [],
  entering: EnteringRivers = {}
) {
  map.RiverOrders.fill(0);
  const order = sourceToOutletOrder(map);
  gatherCatchments(map, order, entering.catchment);
  gatherYear(map, c, order, incoming);
  seasonalFlows(map, c, order, incoming, entering.steady);
  const channels = buildChannels(map);
  retainChannels(map, channels, continuingHeads);
  strahlerOrders(map, order, channels);
  // The rivers are kept as things: this pass's courses are carried onto the map's reaches.
  keepReaches(map, c, channels);
  spineMasks(map);
  releaseWorking(map, order, channels);
}

/**
 * The ground each cell's water is gathered from. A river entering across the map's edge
 * drains country beyond it, and brings the catchment the map it comes from says it has, so an
 * entering river is a gathered river from its first cell.
 */
function gatherCatchments(map: PhysicalField, order: Band, beyond?: Band) {
  for (let i = 0; i < map.mesh.count; i++)
    map.CatchmentArea.set(i, map.mesh.area(i) + Math.max(0, beyond?.get(i) ?? 0));
  gatherDown(order, map.FlowTargets, map.CatchmentArea);
}
/** What the map a river comes from says of it, at the cell where it enters this one. */
export interface EnteringRivers {
  /** What still enters in the river's driest month, in cubic metres a second. */
  steady?: Band;
  /** The catchment the river drains beyond this map, in square metres. */
  catchment?: Band;
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
    river = riverSizes(map.scale);
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
/**
 * One month's flow at a cell, kept as its greatest and least month, and counted as a month
 * in flow when it is a river's: enough water, gathered from ground the map shows.
 */
function noteMonth(map: PhysicalField, i: number, carried: number, river: RiverSizes) {
  if (carried > map.FloodFlow.get(i)) map.FloodFlow.set(i, carried);
  if (carried < map.PerennialFlow.get(i)) map.PerennialFlow.set(i, carried);
  if (carried >= river.discharge && gathered(map.CatchmentArea.get(i), river))
    map.FlowingMonths.add(i, 1);
}
type RiverSizes = ReturnType<typeof riverSizes>;
/** Captured named rivers remain channels along their actual present route. */
function retainChannels(map: PhysicalField, channels: Band, heads: readonly number[]) {
  for (const head of heads)
    for (let cell = head; cell >= 0; cell = map.FlowTargets.get(cell)) {
      const water = map.WaterKindCodes.get(cell);
      if (water === 1 || channels.get(cell)) break;
      if (water === 0) channels.set(cell, 1);
    }
}
