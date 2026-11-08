import type { Band } from "@atlas/domain";
import { meshDeltaX } from "./mesh";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { units } from "./math";
import { carryOut, deposit } from "../rock/groundLedger";
import { loadOf, MaterialLoad } from "../rock/groundLoad";
import { cutShare, facetSurface } from "../rock/groundShares";
import { ask, respond } from "../coupling/answers";
import { sourceToOutletOrder, waterGathered } from "./flowGraph";
import { cellTravel } from "./physicalMetric";
import { workingArray, releaseWorking } from "./physicalNumerics";

function transportDistance(map: PhysicalField, i: number, previous: Band) {
  const target = map.FlowTargets.get(i),
    next = target >= 0 ? target : previous.get(i);
  return next >= 0
    ? cellTravel(
        map.mesh,
        i,
        meshDeltaX(map.mesh, map.mesh.x(next) - map.mesh.x(i)),
        map.mesh.y(next) - map.mesh.y(i)
      )
    : Math.sqrt(map.mesh.area(i));
}
const riverSurface = (map: PhysicalField, cell: number) =>
  cutShare(map, cell) > 0 ? facetSurface(map, cell, "cut") : map.Elevation.get(cell);
/** Mean-cell thickness that fits over the receiving floor, up to its downstream grade. */
function room(
  map: PhysicalField,
  p: PhysicalContext["Profile"],
  i: number,
  target: number,
  still: boolean,
  distance: number
) {
  const share = cutShare(map, i) || 1,
    surface = riverSurface(map, i);
  if (map.WaterKindCodes.get(i) !== 0)
    return Math.max(0, map.WaterDepths.get(i) + map.Elevation.get(i) - surface) * share;
  const base = target >= 0 ? riverSurface(map, target) : map.EffectiveSeaLevel,
    catchment = map.CatchmentArea.get(i) / 100_000_000,
    grade = p.FluvialEquilibriumGradient / Math.max(1, catchment) ** 0.12;
  return Math.max(0, base + units(still ? 0 : grade * distance) - surface) * share;
}
function landRiverLoad(map: PhysicalField, i: number, fits: number, moving: MaterialLoad) {
  return fits > 0
    ? deposit(
        map,
        i,
        fits,
        "river-load",
        "load",
        moving.get(i),
        cutShare(map, i) > 0 ? "cut" : undefined
      )
    : 0;
}
export function sedimentTransport(map: PhysicalField, c: PhysicalContext) {
  const moving = new MaterialLoad(map, "sediment:moving"),
    supply = loadOf(map),
    p = c.Profile;
  const previous = workingArray(map, "int32", "sediment:previous").fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets.get(i);
    if (target >= 0) previous.set(target, i);
  }
  const order = sourceToOutletOrder(map),
    water = waterGathered(map, map.FlowTargets, ask(map, "discharge", c)),
    carries = ask(map, "loadCapacity", c);
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      area = map.mesh.area(i);
    moving.add(i, supply.take(i, supply.amount(i)));
    const load = moving.amount(i);
    if (load <= 0) continue;
    const target = map.FlowTargets.get(i);
    // Water carries what its flow and slope can. Standing water carries nothing, and what it cannot
    // carry settles over the distance it takes to drop out, which is what builds plains and deltas.
    const still =
      map.WaterKindCodes.get(i) === 2 || (target >= 0 && map.WaterKindCodes.get(target) === 1);
    const capacity = still ? 0 : carries.get(i) * water.get(i) * c.Span;
    const distance = transportDistance(map, i, previous);
    const capture = -Math.expm1(
      (Math.log1p(-p.SedimentTransportFraction / 1000) * distance) / p.SedimentDepositionLength
    );
    const dropped = Math.max(0, load - capacity) * capture;
    // It can only build up to the grade the water needs to keep flowing; a lake fills to its surface.
    const fits = Math.min((dropped * 1024) / area, room(map, p, i, target, still, distance));
    const deposited = landRiverLoad(map, i, fits, moving);
    const volume = (deposited / 1024) * area;
    moving.take(i, volume);
    const carried = moving.take(i, moving.amount(i));
    if (target >= 0) moving.add(target, carried);
    else carryOut(map, carried.depth, "river-load", carried);
  }
  moving.release();
  releaseWorking(map, order, previous, water);
}
/** Flowing water carries more the steeper it runs. */
respond({
  key: "loadCapacity",
  by: "flowing water",
  reads: ["Slope"],
  base: (map, i, { Profile: p }) => p.SedimentCarry * map.Slope.get(i),
});
/** What wear has fed to the water on each cell since the water last carried it away. */
respond({
  key: "looseSupply",
  by: "worn ground",
  reads: ["SedimentSupply"],
  base: (map, i) => map.SedimentSupply.get(i),
});
