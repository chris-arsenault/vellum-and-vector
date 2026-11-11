import { MapScale } from "@atlas/domain";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { groundOf } from "../rock/ground";
import { averageGroundQuery, groundFact } from "../rock/groundQuery";
import { clamp } from "./math";
import { respond } from "../coupling/answers";

type ReturnReceiver = (cell: number, returned: number, available: number) => void;
// hpc-exempt: per-map operation receiver; retained water remains in the physical bands.
const returnReceivers = new WeakMap<PhysicalField, ReturnReceiver>();
/** The interval belongs to the transient transfer receipts, not to a later query's context. */
const returnIntervals = new WeakMap<PhysicalField, number>();
/** Material owners receive the actual water withdrawn by an instantaneous surface return. */
export function receiveGroundwaterReturn(map: PhysicalField, receive: ReturnReceiver) {
  returnReceivers.set(map, receive);
}
/** A dissolved inventory accompanies the fraction of its carrier actually withdrawn. */
export function returnedCharge(inventory: number, available: number, returned: number) {
  return available > 0 ? Math.max(0, inventory) * clamp(returned / available, 0, 1) : 0;
}
/** A transfer depth becomes a current rate over the interval that actually moved its water. */
export function groundwaterReturnRate(returned: number, exposure: number) {
  return exposure > 0 ? Math.max(0, returned) / exposure : 0;
}

respond({
  key: "surfaceWater",
  by: "groundwater springs",
  reads: ["GroundwaterReturn"],
  add: (map, i) =>
    MapScale.inUnits(
      groundwaterReturnRate(map.GroundwaterReturn.get(i), returnIntervals.get(map) ?? 0),
      "mm"
    ),
});
respond({
  key: "wetness",
  by: "groundwater return",
  reads: ["GroundwaterReturn"],
  add: (map, i) => map.GroundwaterReturn.get(i) / map.scale.length(2.5e-7),
});

const permeability = averageGroundQuery({
  start: 0,
  rock: (_, layer) => Math.max(groundFact(layer, "porosity"), groundFact(layer, "solubility")),
});
/** Retained water depth is a volume per area, not the elevation of a water table. */
export function groundwaterBalance(
  storage: number,
  recharge: number,
  capacity: number,
  drainage: number,
  marine: boolean,
  exposure: number
) {
  if (!(exposure > 0)) return { storage, outflow: 0, returned: 0 };
  const wet = Math.max(0, storage + recharge * exposure);
  if (marine) return { storage: 0, outflow: wet, returned: 0 };
  const share = -Math.expm1(Math.log1p(-clamp(drainage, 0, 1)) * exposure),
    outflow = wet * share,
    returned = Math.max(0, wet - outflow - capacity);
  return { storage: wet - outflow - returned, outflow, returned };
}
/** Start one transfer batch: its receipts and rate interval share the same lifetime. */
export function beginGroundwaterExchange(map: PhysicalField, exposure: number) {
  returnIntervals.set(map, Math.max(0, exposure));
  for (const band of [
    "GroundwaterExchangeVolume",
    "GroundwaterRecharge",
    "GroundwaterOutflow",
    "GroundwaterReturn",
  ] as const)
    map[band].fill(0);
  map.GroundwaterTargets.fill(-1);
}
/** A coarse saturated store routes by hydraulic head and the actual substrate's permeability. */
export function advanceGroundwater(map: PhysicalField, context: PhysicalContext) {
  const exposure = Math.max(0, context.Span);
  beginGroundwaterExchange(map, exposure);
  if (!exposure) return;
  const depth = map.scale.length(2.5e-6),
    conductance = workingArray(map, "float64", "groundwater:conductance"),
    head = workingArray(map, "float64", "groundwater:head"),
    arriving = workingArray(map, "float64", "groundwater:arriving");
  for (let i = 0; i < map.mesh.count; i++) {
    const permeable = clamp(groundOf(map).fold(i, permeability), 0, 1);
    conductance.set(i, permeable);
    const rain = MapScale.metres(map.Rainfall.get(i), "mm"),
      recharge =
        map.WaterKindCodes.get(i) === 1
          ? 0
          : Math.max(0, rain * map.Infiltration.get(i) - map.Evapotranspiration.get(i)) * exposure;
    map.GroundwaterStorage.add(i, recharge);
    map.GroundwaterRecharge.set(i, recharge);
    head.set(
      i,
      map.WaterKindCodes.get(i) === 1
        ? MapScale.metres(map.EffectiveSeaLevel, "native")
        : MapScale.metres(map.Elevation.get(i), "native") -
            depth +
            map.GroundwaterStorage.get(i) / Math.max(0.01, permeable)
    );
  }
  for (let i = 0; i < map.mesh.count; i++)
    routeWater(map, i, head, conductance, arriving, depth, exposure);
  for (let i = 0; i < map.mesh.count; i++) {
    const water = arriving.get(i) / map.mesh.area(i);
    if (map.WaterKindCodes.get(i) !== 1) map.GroundwaterStorage.add(i, water);
  }
  releaseWorking(map, conductance, head, arriving);
}
function routeWater(
  map: PhysicalField,
  i: number,
  head: import("@atlas/domain").Band,
  conductance: import("@atlas/domain").Band,
  arriving: import("@atlas/domain").Band,
  depth: number,
  exposure: number
) {
  let target = -1,
    gradient = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j < 0) continue;
    const slope =
      ((head.get(i) - head.get(j)) / map.mesh.edgeLength(i, edge)) *
      Math.min(conductance.get(i), conductance.get(j));
    if (slope > gradient) {
      target = j;
      gradient = slope;
    }
  }
  const available = map.GroundwaterStorage.get(i),
    marine = map.WaterKindCodes.get(i) === 1;
  map.GroundwaterExchangeVolume.set(i, available);
  const balance = groundwaterBalance(
    available,
    0,
    depth * conductance.get(i),
    gradient / (gradient + 0.01),
    marine,
    exposure
  );
  if (marine) target = -1;
  map.GroundwaterTargets.set(i, target);
  map.GroundwaterOutflow.set(i, balance.outflow);
  map.GroundwaterStorage.set(i, balance.storage);
  map.GroundwaterReturn.add(i, balance.returned);
  if (target >= 0) arriving.add(target, balance.outflow * map.mesh.area(i));
}
/** Immediate withdrawal into the caller's soil receiver; it is not another river-flow receipt. */
export function returnGroundwater(map: PhysicalField, i: number, fraction: number, room: number) {
  const available = map.GroundwaterStorage.get(i);
  const returned = Math.min(Math.max(0, room), available * clamp(fraction, 0, 1));
  map.GroundwaterStorage.add(i, -returned);
  if (returned > 0) returnReceivers.get(map)?.(i, returned, available);
  return returned;
}
