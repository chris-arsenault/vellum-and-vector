import { MapScale } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { PhysicalContext } from "../world/context";
import { workingArray, releaseWorking } from "../world/physicalNumerics";
import { groundOf } from "../rock/ground";
import { averageGroundQuery, groundFact } from "../rock/groundQuery";
import { clamp } from "../world/math";
import { respond } from "../coupling/answers";
import { moveWater } from "./waterLedger";

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
      // The interval is the one the returned water was moved over, kept on the map with it.
      groundwaterReturnRate(map.GroundwaterReturn.get(i), map.GroundwaterInterval),
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
/** How far a cell's ground lets water through, 0 to 1, by the rock at its surface. */
export const groundPermeability = (map: PhysicalField, i: number) =>
  clamp(groundOf(map).fold(i, permeability), 0, 1);
/** The water a cell's ground holds when full, as a depth over the cell. */
export const groundwaterCapacity = (map: PhysicalField, i: number) =>
  map.scale.length(2.5e-6) * groundPermeability(map, i);
/** How full a cell's ground is, 0 to 1; ground that holds nothing counts as full. */
export function groundwaterFilled(map: PhysicalField, i: number) {
  const capacity = groundwaterCapacity(map, i);
  return capacity > 0 ? clamp(map.GroundwaterStorage.get(i) / capacity, 0, 1) : 1;
}
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
  map.GroundwaterInterval = Math.max(0, exposure);
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
    // What the year's water budget says sank in: the same water the surface did not get.
    const recharge =
      map.WaterKindCodes.get(i) === 1
        ? 0
        : MapScale.metres(map.WaterRecharge.get(i), "mm") * exposure;
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
  let toSea = 0,
    sprung = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const water = arriving.get(i) / map.mesh.area(i);
    if (map.WaterKindCodes.get(i) !== 1) map.GroundwaterStorage.add(i, water);
    // What arrives under the sea has left the land's groundwater.
    else toSea += arriving.get(i);
    sprung += map.GroundwaterReturn.get(i) * map.mesh.area(i);
  }
  moveWater(map, "seepToSea", toSea / exposure);
  moveWater(map, "spring", sprung / exposure);
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
