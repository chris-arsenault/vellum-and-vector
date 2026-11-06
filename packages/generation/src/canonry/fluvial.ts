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
    const shouldDeposit =
      map.WaterKindCodes.get(i) === 2 ||
      map.Slope.get(i) <= p.SedimentDepositionSlopeThreshold ||
      (target >= 0 && map.WaterKindCodes.get(target) === 1);
    const distance = transportDistance(map, i, previous);
    const capture = -Math.expm1(
      (Math.log1p(-p.SedimentTransportFraction / 1000) * distance) / p.SedimentDepositionLength
    );
    const deposited = shouldDeposit
      ? deposit(
          map,
          i,
          Math.min(units(p.MaximumSedimentDepositionPerPass), ((load * 1024) / area) * capture)
        )
      : 0;
    const volume = (deposited / 1024) * area;
    if (target >= 0) moving.add(target, load - volume);
    else map.SedimentExportedTotal += load - volume;
  }
  releaseWorking(map, order, moving, previous);
}
