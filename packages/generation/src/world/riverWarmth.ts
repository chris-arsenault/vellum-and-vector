import type { PhysicalField } from "./field";
import { sourceToOutletOrder } from "./flowGraph";
import { physicalDistance } from "./physicalMetric";
import { workingArray, releaseWorking } from "./physicalNumerics";

/** Distance over which carried warmth falls to a third: a long tongue, not a whole basin. */
const warmthLength = 60_000;
/**
 * Thawed water runs downstream from halos and springs, so a river below a wellspring
 * stays open far beyond the heat. Magical heat forcing enters the drainage where it is
 * applied and is carried down the flow targets, fading with travel; the warmth a river
 * cell carries is the strongest that reaches it.
 */
export function riverWarmth(map: PhysicalField) {
  const carried = workingArray(map, "float64", "river:warmth"),
    order = sourceToOutletOrder(map);
  map.RiverWarmth.fill(0);
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n);
    const warmth = Math.max(carried.get(i), Math.max(0, map.ExternalHeatForcing.get(i)));
    if (warmth <= 1) continue;
    if (map.RiverOrders.get(i) >= 1 && map.WaterKindCodes.get(i) === 0)
      map.RiverWarmth.set(i, warmth);
    const target = map.FlowTargets.get(i);
    if (target < 0 || map.WaterKindCodes.get(target) === 1) continue;
    const next = warmth * Math.exp(-physicalDistance(map.mesh, i, target) / warmthLength);
    carried.set(target, Math.max(carried.get(target), next));
  }
  releaseWorking(map, carried, order);
}
