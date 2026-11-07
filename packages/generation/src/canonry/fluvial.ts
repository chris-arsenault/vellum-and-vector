// SedimentTransportLayer.cs, Canonry 0f62584c.
import type { Band } from "@atlas/domain";
import { meshDeltaX } from "./mesh";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { units } from "./math";
import { deposit } from "../rock/groundLedger";
import { sourceToOutletOrder } from "./flowGraph";
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
/** How much a cell can take before it stands above the graded slope down to where its water goes. */
function room(
  map: PhysicalField,
  p: PhysicalContext["Profile"],
  i: number,
  target: number,
  still: boolean,
  distance: number
) {
  if (map.WaterKindCodes.get(i) !== 0) return Math.max(0, map.WaterDepths.get(i));
  const base = target >= 0 ? map.Elevation.get(target) : map.EffectiveSeaLevel,
    catchment = map.CatchmentArea.get(i) / 100_000_000,
    grade = p.FluvialEquilibriumGradient / Math.max(1, catchment) ** 0.12;
  return Math.max(0, base + units(still ? 0 : grade * distance) - map.Elevation.get(i));
}
export function sedimentTransport(map: PhysicalField, c: PhysicalContext) {
  const moving = workingArray(map, "float64", "sediment:moving"),
    p = c.Profile;
  const previous = workingArray(map, "int32", "sediment:previous").fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets.get(i);
    if (target >= 0) previous.set(target, i);
  }
  const order = sourceToOutletOrder(map);
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      area = map.mesh.area(i);
    const load = moving.get(i) + (map.SedimentSupply.get(i) / 1024) * area;
    map.SedimentSupply.set(i, 0);
    if (load <= 0) continue;
    const target = map.FlowTargets.get(i);
    // Water carries what its flow and slope can. Standing water carries nothing, and what it cannot
    // carry settles over the distance it takes to drop out, which is what builds plains and deltas.
    const still =
      map.WaterKindCodes.get(i) === 2 || (target >= 0 && map.WaterKindCodes.get(target) === 1);
    const capacity = still
      ? 0
      : p.SedimentCarry * map.CatchmentArea.get(i) * map.Slope.get(i) * c.Span;
    const distance = transportDistance(map, i, previous);
    const capture = -Math.expm1(
      (Math.log1p(-p.SedimentTransportFraction / 1000) * distance) / p.SedimentDepositionLength
    );
    const dropped = Math.max(0, load - capacity) * capture;
    // It can only build up to the grade the water needs to keep flowing; a lake fills to its surface.
    const fits = Math.min((dropped * 1024) / area, room(map, p, i, target, still, distance));
    const deposited = fits > 0 ? deposit(map, i, fits, "rivers") : 0;
    const volume = (deposited / 1024) * area;
    if (target >= 0) moving.add(target, load - volume);
    else map.SedimentExportedTotal += load - volume;
  }
  releaseWorking(map, order, moving, previous);
}
