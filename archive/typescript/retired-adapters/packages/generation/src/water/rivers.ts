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
import { advanceReaches, refreshReachWater } from "./reachEvolution";
import { establishRiverIdentities, markDrawnReaches } from "./riverVisibility";
import { projectRivers } from "./riverProjection";
import { currentBed } from "./riverBed";
import { channelOrigins } from "./channelOrigins";
import { riverStorage } from "./riverStorage";
import { withBoundaryRivers, type BoundaryRivers } from "./boundaryWater";

/**
 * The cells a river runs through: those reached, in at least one month of the year, by a
 * river's flow gathered from a catchment the map shows (see `riverSize`). No share of its
 * basin and no help from the cells below: a river starts where enough water has gathered and
 * ends where it has lost it. One exception is deliberate: a parent map's named river
 * continues on a finer map whatever its water there, because named things persist.
 */
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
export function riverNetwork(map: PhysicalField, c: PhysicalContext) {
  withBoundaryRivers(map, (input) =>
    withRoutedYear(map, c, input, (_order, monthly) => {
      const store = riverStorage(map);
      for (const reach of store.reaches.values())
        refreshReachWater(reach, {
          flow: (cell, month) => monthly[month].get(cell),
          bed: (cell) => currentBed(map, cell),
          catchment: (cell) => map.CatchmentArea.get(cell),
          discharge: riverSizes(map.scale).discharge,
        });
      store.at = undefined;
      projectNetwork(map);
    })
  );
}

/** Only an explicit occurrence evolves courses, dry history and established river identity. */
export function advanceRiverNetwork(
  map: PhysicalField,
  c: PhysicalContext,
  channelLength?: Pick<Band, "get">
) {
  withBoundaryRivers(map, (input) =>
    withRoutedYear(map, c, input, (order, monthly) => {
      const heads = [...map.rivers.reaches.values()]
        .filter((reach) => reach.river)
        .map((reach) => reach.cells[0]);
      evolveNetwork(map, order, monthly, heads, channelLength);
      establishRiverIdentities(map);
      projectNetwork(map);
    })
  );
}

function withRoutedYear(
  map: PhysicalField,
  c: PhysicalContext,
  entering: BoundaryRivers,
  apply: (order: Band, monthly: Band[]) => void
) {
  const order = sourceToOutletOrder(map);
  gatherCatchments(map, order, entering.catchment);
  gatherYear(map, c, order, entering.incoming);
  const monthly = seasonalFlows(map, c, order, entering.incoming, entering.monthly);
  try {
    apply(order, monthly);
  } finally {
    releaseWorking(map, order, ...monthly);
  }
}

function projectNetwork(map: PhysicalField) {
  markDrawnReaches(map);
  projectRivers(map);
  spineMasks(map);
}

function evolveNetwork(
  map: PhysicalField,
  order: Band,
  monthly: Band[],
  heads: readonly number[],
  channelLength?: Pick<Band, "get">
) {
  const sizes = riverSizes(map.scale),
    forced = new Uint8Array(map.mesh.count),
    origins = channelLength ? channelOrigins(map, order, channelLength) : undefined;
  for (const head of heads)
    for (let cell = head; cell >= 0 && !forced[cell]; cell = map.FlowTargets.get(cell)) {
      if (map.WaterKindCodes.get(cell) === 1) break;
      forced[cell] = 1;
    }
  advanceReaches(riverStorage(map), {
    count: map.mesh.count,
    order: Int32Array.from({ length: order.length }, (_, n) => order.get(n)),
    next: (cell) => map.FlowTargets.get(cell),
    land: (cell) => map.WaterKindCodes.get(cell) === 0,
    resolved: (cell) =>
      forced[cell] > 0 ||
      (gathered(map.CatchmentArea.get(cell), sizes, map.mesh.area(cell)) &&
        monthly.some((flow) => flow.get(cell) >= sizes.discharge)),
    flow: (cell, month) => monthly[month].get(cell),
    bed: (cell) => currentBed(map, cell),
    catchment: (cell) => map.CatchmentArea.get(cell),
    discharge: sizes.discharge,
    epoch: map.CompletedEpochCount,
    newHead: origins ? (cell) => origins[cell] > 0 || forced[cell] > 0 : undefined,
  });
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
  map.SeepageRecharge.fill(0);
  gatherDown(order, map.FlowTargets, map.FlowAccumulation, (i, received) => {
    const parts = pass(i, received);
    left.bedLoss += parts.bed;
    map.SeepageRecharge.set(i, (parts.bed * 365.25 * 24 * 3600 * 1000) / map.mesh.area(i));
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
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (map.WaterKindCodes.get(cell) === 2 && whole > 0)
      map.SeepageRecharge.add(cell, (c.Profile.LakeInfiltrationLoss * kept) / whole);
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
  exactIncoming?: readonly Band[]
) {
  const water = ask(map, "surfaceWater", c),
    pass = waterPassage(map, c),
    each = waterYearOf(map),
    flow = workingArray(map, "float64", "river:month-flow"),
    monthly = Array.from({ length: months }, (_, n) =>
      workingArray(map, "float64", `river:flow-${n}`)
    );
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
        ) + (exactIncoming ? exactIncoming[month].get(i) : (incoming?.get(i) ?? 0))
      );
    gatherDown(order, map.FlowTargets, flow, (i, received) => {
      // A lake evens out the year: its outlet runs at the year's overflow in every month.
      const carried =
        map.LakeOutletTargets.get(i) >= 0 ? map.FlowAccumulation.get(i) : pass(i, received);
      monthly[month].set(i, carried);
      if (carried > map.FloodFlow.get(i)) map.FloodFlow.set(i, carried);
      if (carried < map.PerennialFlow.get(i)) map.PerennialFlow.set(i, carried);
      return carried;
    });
  }
  for (let i = 0; i < map.mesh.count; i++)
    if (!Number.isFinite(map.PerennialFlow.get(i))) map.PerennialFlow.set(i, 0);
  releaseWorking(map, flow);
  return monthly;
}
