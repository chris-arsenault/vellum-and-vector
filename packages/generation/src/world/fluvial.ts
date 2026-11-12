import { MapScale, type Band } from "@atlas/domain";
import { meshDeltaX } from "./mesh";
import type { PhysicalField } from "./field";
import { isOpenOutlet } from "./field";
import type { PhysicalContext } from "./context";
import { units } from "./math";
import { carryOut, deposit } from "../rock/groundLedger";
import { loadOf, MaterialLoad } from "../rock/groundLoad";
import type { MaterialLayer } from "../rock/rockColumn";
import { cutShare, facetSurface } from "../rock/groundShares";
import { ask, respond } from "../coupling/answers";
import { sourceToOutletOrder, waterGathered } from "./flowGraph";
import { cellTravel } from "./physicalMetric";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { referenceWaterPassage } from "../water/waterQuantity";

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
    catchment = map.CatchmentArea.get(i) / map.scale.area(0.00000625),
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
/** A closed lake keeps rejected sediment; only a physical map outlet exports it. */
function releaseRiverLoad(map: PhysicalField, cell: number, material: MaterialLayer) {
  if (isOpenOutlet(map, cell)) carryOut(map, material.depth, "river-load", material);
  else loadOf(map).add(cell, material);
}
/**
 * The share of a river's load that stays where it meets the sea: what waves and currents do
 * not carry off. A sheltered, still shore keeps nearly all of it and an exposed one little.
 */
export const mouthKeeps = (waveExposure: number, currentStrength: number) =>
  (1 - Math.min(1, Math.max(0, waveExposure / 1000))) *
  (1 - Math.min(1, Math.max(0, currentStrength / 1000)));
/**
 * What a river brings to the sea settles on the floor at its mouth, as high as the sea's
 * surface and no higher. A floor built to the surface is new land: a delta, which the river
 * then crosses to build the next. What waves and currents take, and what does not fit, goes
 * out to sea.
 */
function settleAtSea(map: PhysicalField, i: number, moving: MaterialLoad) {
  const load = moving.amount(i);
  if (load <= 0) return;
  const area = map.mesh.area(i),
    kept = load * mouthKeeps(map.WaveExposure.get(i), map.OceanCurrentStrength.get(i)),
    fits = Math.min(
      MapScale.inUnits(kept / area, "native"),
      Math.max(0, map.EffectiveSeaLevel - map.Elevation.get(i))
    ),
    laid = fits > 0 ? deposit(map, i, fits, "river-load", "load", moving.get(i)) : 0;
  moving.take(i, MapScale.metres(laid, "native") * area);
  const rest = moving.amount(i);
  if (rest > 0) carryOut(map, rest, "river-load", moving.take(i, rest), i);
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
    water = waterGathered(
      map,
      map.FlowTargets,
      ask(map, "discharge", c),
      referenceWaterPassage(map, c)
    ),
    carries = ask(map, "loadCapacity", c);
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      area = map.mesh.area(i);
    if (map.WaterKindCodes.get(i) === 1) {
      settleAtSea(map, i, moving);
      // What the sea's own floor has loose stays the sea's.
      carryOut(map, supply.amount(i), "river-load", supply.take(i, supply.amount(i)), i);
      continue;
    }
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
    const fits = Math.min(
      MapScale.inUnits(dropped / area, "native"),
      room(map, p, i, target, still, distance)
    );
    const deposited = landRiverLoad(map, i, fits, moving);
    const volume = MapScale.metres(deposited, "native") * area;
    moving.take(i, volume);
    const carried = moving.take(i, moving.amount(i));
    if (target >= 0) moving.add(target, carried);
    else releaseRiverLoad(map, i, carried);
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
