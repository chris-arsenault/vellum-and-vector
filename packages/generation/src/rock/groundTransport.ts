import type { Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { releaseWorking } from "../world/physicalNumerics";
import { crustHeight, units } from "../world/math";
import { recordFlow } from "../coupling/flows";
import { allColumnFields, columnFields, columns, type Column } from "./rockLayerFields";
import {
  bindMaterialReader,
  finiteSlice,
  type MaterialLayer,
  type MaterialReader,
} from "./rockColumn";
import { holdCargo, cargoSlot, clearCellCargo, writeCargo, type CargoStore } from "./groundCargo";
import { buryUnderPackage } from "./groundBurial";
import { carryOut, depositPackage, shiftRock, standGround } from "./groundLedger";
import { projectGround, resetShares } from "./groundShares";
import { oceanicColumn } from "./rockHistory";
import { loadOf, seaLoadOf, MaterialLoad } from "./groundLoad";
import { deformFabric, deformSlope, deformGround, type Deformation } from "./groundTransform";
export { deformFabric, deformSlope, deformGround, type Deformation } from "./groundTransform";
import { weightScale, type TransportPlan } from "../world/transportPlan";
import { groundStorage } from "./groundStorage";
import { releaseCargoCustody, releasedMaterial } from "./groundCargoIdentity";
import { observeTransfer } from "./groundTransferObservation";
export { watchGroundTransfers, type GroundTransferObservation } from "./groundTransferObservation";

export const groundPlacementFields = [
  "BedrockElevation",
  "CrustSupportElevation",
  "SurfaceRockLoad",
] as const;
export const groundSheetFields = [
  "ThrustPairIds",
  "ThrustSheetIndex",
  "ThrustSegmentIds",
  "ThrustAcross",
  "ThrustDip",
] as const;
export const groundMaterialFields = [
  ...allColumnFields,
  "GroundCutShare",
  "GroundCutDepth",
  "CrustSutureStrength",
  "CrustSuturePairIds",
  "CrustProvinceSeam",
] as const;
export const groundProjectionFields = [
  "Elevation",
  "SedimentThickness",
  "RockResistance",
  "RockKindCodes",
  "GroundCutCover",
  "StructuralGrainX",
  "StructuralGrainY",
] as const;
// hpc-exempt: fixed named schema offsets, not per-cell state or numerical storage.
const propertyOffsets = Object.fromEntries(
  groundMaterialFields.map((name, index) => [name, index])
) as Record<(typeof groundMaterialFields)[number], number>;
/** A process-local bulk snapshot, not another persistent representation of the ground. */
export interface HeldRock {
  properties: Band[];
  kinds: Band[];
  before: Band[];
  read: MaterialReader;
  cargo?: CargoStore;
}
// hpc-exempt: one bounded latest-donor cache per operation snapshot, never per-cell retained objects.
const donorColumns = new WeakMap<
  HeldRock,
  { cell: number; columns: Partial<Record<Column, MaterialLayer[]>> }
>();
export function holdRock(map: PhysicalField): HeldRock {
  const properties = groundMaterialFields.map((name) => map.coverage.copyBand(map[name])),
    read = bindMaterialReader((name) => properties[propertyOffsets[name]]),
    cargo = holdCargo(map);
  return {
    properties,
    kinds: groundSheetFields.map((name) => map.coverage.copyBand(map[name])),
    before: groundPlacementFields.map((name) => map.coverage.copyBand(map[name])),
    cargo,
    read: (cell, slot, column = "land") => ({
      ...read(cell, slot, column),
      cargo: cargo?.get(cargoSlot(map.mesh.count, cell, slot, column)),
    }),
  };
}
export function releaseHeldRock(map: PhysicalField, held: HeldRock) {
  donorColumns.delete(held);
  held.cargo?.release(map);
  releaseWorking(map, ...held.properties, ...held.kinds, ...held.before);
}
export const heldPlacement = (
  held: HeldRock,
  field: (typeof groundPlacementFields)[number],
  cell: number
) => held.before[groundPlacementFields.indexOf(field)].get(cell);
export const heldProperty = (
  held: HeldRock,
  field: (typeof groundMaterialFields)[number],
  cell: number
) => held.properties[propertyOffsets[field]].get(cell);
/** A held column's actual layer, including alteration and fabric from the same donor. */
export function heldLayer(
  held: HeldRock,
  cell: number,
  slot: number,
  column: Column = "land"
): MaterialLayer {
  return held.read(cell, slot, column);
}
export const heldLayers = (held: HeldRock, cell: number, column: Column = "land") =>
  columnFields[column].kind.map((_, slot) => heldLayer(held, cell, slot, column));
/** A footprint sends the same captured donor to many receivers; decode its material once. */
function collisionLayers(held: HeldRock, cell: number, column: Column) {
  let donor = donorColumns.get(held);
  if (donor?.cell !== cell) {
    donor = { cell, columns: {} };
    donorColumns.set(held, donor);
  }
  return (donor.columns[column] ??= heldLayers(held, cell, column));
}
function takeHeldSheet(map: PhysicalField, held: HeldRock, cell: number, origin: number) {
  for (let n = 0; n < groundSheetFields.length; n++)
    groundStorage(map)[groundSheetFields[n]].set(cell, held.kinds[n].get(origin));
}
/** One donor supplies every material fact. Placement may move independently without making rock. */
function takeHeldRock(
  map: PhysicalField,
  held: HeldRock,
  cell: number,
  origin: number,
  natural = false
) {
  groundMaterialFields.forEach((name, n) =>
    groundStorage(map)[name].set(cell, held.properties[n].get(origin))
  );
  clearCellCargo(map, cell);
  if (held.cargo)
    for (const column of columns)
      for (let slot = 0; slot < columnFields[column].depth.length; slot++)
        writeCargo(map, cell, slot, column, carriedCargo(map, held, origin, slot, column, natural));
  takeHeldSheet(map, held, cell, origin);
  projectGround(map, cell);
}
function carriedCargo(
  map: PhysicalField,
  held: HeldRock,
  origin: number,
  slot: number,
  column: Column,
  natural: boolean
) {
  const cargo = held.cargo?.get(cargoSlot(map.mesh.count, origin, slot, column));
  return natural ? releaseCargoCustody(map, cargo) : cargo;
}
/** A captured geological column conditioned to a chosen placement, settled as one operation. */
export function restoreGround(
  map: PhysicalField,
  held: HeldRock,
  cell: number,
  source: number,
  elevation: number
) {
  takeHeldRock(map, held, cell, source);
  standGround(map, cell, elevation, "ground restoration");
}
/** Reassign a captured column while retaining the destination's present ground elevation. */
export function transplantHeldColumn(
  map: PhysicalField,
  held: HeldRock,
  cell: number,
  source: number
) {
  restoreGround(map, held, cell, source, map.Elevation.get(cell));
}
/** Placement carried by a plate, selected before any destination writes can affect its source. */
export function placeCarriedGround(
  map: PhysicalField,
  held: HeldRock,
  cell: number,
  origin: number,
  f: Deformation
) {
  const observed = observeTransfer(map, held, origin, cell, "plate-placement");
  takeHeldRock(map, held, cell, origin, true);
  groundPlacementFields.forEach((name, n) =>
    groundStorage(map)[name].set(cell, held.before[n].get(origin))
  );
  deformGround(map, cell, f);
  observed();
}
/** An opening really forms new ocean crust; no abandoned donor strata remain underneath it. */
export function formTransportOpening(map: PhysicalField, cell: number) {
  const stored = groundStorage(map);
  for (const name of groundMaterialFields) stored[name].set(cell, 0);
  clearCellCargo(map, cell);
  resetShares(map, cell);
  for (const name of groundSheetFields) stored[name].set(cell, 0);
  stored.SurfaceRockLoad.set(cell, 0);
  stored.CrustSupportElevation.set(
    cell,
    units(
      crustHeight(
        MapScale.metres(map.CrustThickness.get(cell), "native"),
        map.CrustContinentalFraction.get(cell) / 1000,
        map.scale
      )
    )
  );
  stored.BedrockElevation.set(cell, map.CrustSupportElevation.get(cell));
  oceanicColumn(map, cell);
  projectGround(map, cell);
}
/** Top-first slice of an intact donor. A basement can supply more than its recorded thickness. */
function sliceLayers(held: HeldRock, source: number, column: Column, amount: number) {
  const layers = collisionLayers(held, source, column),
    result: MaterialLayer[] = [];
  let last = 0,
    left = amount;
  while (last + 1 < layers.length && layers[last + 1].depth > 0) last++;
  for (let slot = 0; slot <= last && left > 0; slot++) {
    const layer = layers[slot],
      depth = Math.min(left, slot === last ? left : layer.depth);
    if (depth > 0) result.push(finiteSlice(layer, depth, slot === last));
    left -= depth;
  }
  return result;
}
function collisionBeds(
  held: HeldRock,
  source: number,
  sourceDepth: number,
  landedDepth: number,
  f: Deformation
) {
  const share = heldProperty(held, "GroundCutShare", source),
    result: MaterialLayer[] = [];
  // Cut material lands after intact material, so it comes first in this top-first package.
  for (const facet of ["cut", "land"] as const) {
    const part = facet === "land" ? 1 - share : share;
    if (part <= 0) continue;
    for (const layer of sliceLayers(held, source, facet, sourceDepth)) {
      const [grainX, grainY] = deformFabric(layer.grainX, layer.grainY, f),
        [bedSlopeX, bedSlopeY] = deformSlope(layer.bedSlopeX, layer.bedSlopeY, f);
      result.push({
        ...layer,
        depth: layer.depth * part * (landedDepth / sourceDepth),
        grainX,
        grainY,
        bedSlopeX,
        bedSlopeY,
      });
    }
  }
  return result;
}
/** An overlapping donor's coherent beds join the collision pile. */
export function accreteHeldGround(
  map: PhysicalField,
  held: HeldRock,
  target: number,
  source: number,
  amount: number,
  f: Deformation = [1, 0, 0, 1],
  sourceDepth?: number
) {
  const observed = observeTransfer(map, held, source, target, "rock-accretion"),
    admitted = Math.max(0, amount);
  if (admitted <= 0) {
    observed(0);
    return 0;
  }
  const layers = collisionBeds(held, source, sourceDepth ?? admitted, admitted, f).map((layer) =>
    releasedMaterial(map, layer)
  );
  // Colliding donor shares stack vertically; unresolved horizontal parcel alignment is lost.
  buryUnderPackage(map, target, layers);
  groundStorage(map).BedrockElevation.add(target, admitted);
  groundStorage(map).SurfaceRockLoad.add(target, admitted);
  recordFlow(
    map,
    "plates",
    "rock",
    "rock",
    MapScale.metres(admitted, "native") * map.mesh.area(target)
  );
  projectGround(map, target);
  observed(admitted);
  return admitted;
}
export function joinGroundSheet(
  map: PhysicalField,
  cell: number,
  pair: number,
  sheet: number,
  segment: number,
  across: number
) {
  const stored = groundStorage(map);
  stored.ThrustPairIds.set(cell, pair);
  stored.ThrustSheetIndex.set(cell, sheet);
  stored.ThrustSegmentIds.set(cell, segment);
  stored.ThrustAcross.set(cell, Math.round(across * 1000));
}
export function leaveGroundSheet(map: PhysicalField, cell: number) {
  groundStorage(map).ThrustPairIds.set(cell, 0);
  groundStorage(map).ThrustSheetIndex.set(cell, 0);
}
export function heldCoverDepth(held: HeldRock, source: number) {
  const share = heldProperty(held, "GroundCutShare", source),
    thickness = (column: Column) =>
      columnFields[column].depth.reduce((sum, name) => sum + heldProperty(held, name, source), 0);
  return thickness("loose") * (1 - share) + thickness("cutLoose") * share;
}
/** Displaced cover lands from its actual donor, retaining each bed rather than a generic sediment. */
export function accreteHeldCover(
  map: PhysicalField,
  held: HeldRock,
  target: number,
  source: number,
  areaRatio: number,
  f: Deformation = [1, 0, 0, 1]
) {
  const observed = observeTransfer(map, held, source, target, "cover-accretion"),
    share = heldProperty(held, "GroundCutShare", source),
    arriving: MaterialLayer[] = [];
  // Cut cover lands last; the package owner admits older land cover first.
  for (const column of ["cutLoose", "loose"] as const) {
    const part = column === "loose" ? 1 - share : share;
    if (part <= 0) continue;
    for (const layer of collisionLayers(held, source, column)) {
      const depth = layer.depth * part * areaRatio;
      if (depth <= 0) continue;
      const [grainX, grainY] = deformFabric(layer.grainX, layer.grainY, f),
        [bedSlopeX, bedSlopeY] = deformSlope(layer.bedSlopeX, layer.bedSlopeY, f);
      arriving.push({
        ...releasedMaterial(map, layer),
        depth,
        grainX,
        grainY,
        bedSlopeX,
        bedSlopeY,
      });
    }
  }
  observed(depositPackage(map, target, arriving, "plates", "loose"));
}
function transportLoad(
  map: PhysicalField,
  plan: TransportPlan,
  current: MaterialLoad,
  key: string
) {
  const arriving = new MaterialLoad(map, key);
  for (let source = 0; source < map.mesh.count; source++) {
    const material = releasedMaterial(map, current.get(source));
    if (material.depth <= 0) continue;
    let retained = 0;
    for (let offset = plan.offsets.get(source); offset < plan.offsets.get(source + 1); offset++) {
      const target = plan.targets.get(offset),
        share = plan.weights.get(offset) / weightScale;
      if (target < 0 || share <= 0) continue;
      arriving.add(target, { ...material, depth: material.depth * share });
      retained += share;
    }
    const lost = material.depth * Math.max(0, 1 - retained);
    if (lost > 0) carryOut(map, lost, "plates", material);
  }
  for (let cell = 0; cell < map.mesh.count; cell++) {
    current.clear(cell);
    current.add(cell, arriving.get(cell));
  }
  arriving.release();
}
/** Both terrestrial cargo and local marine deposits retain their receiving geography through motion. */
export function transportGroundLoad(map: PhysicalField, plan: TransportPlan) {
  transportLoad(map, plan, loadOf(map), "plates:load");
  transportLoad(map, plan, seaLoadOf(map), "plates:seaLoad");
}
/** Sheet translation replaces the donor package and its standing load in one owner operation. */
export function moveHeldSheet(map: PhysicalField, held: HeldRock, cell: number, source: number) {
  const observed = observeTransfer(map, held, source, cell, "sheet-move"),
    wanted = heldPlacement(held, "SurfaceRockLoad", source) - map.SurfaceRockLoad.get(cell);
  takeHeldRock(map, held, cell, source, true);
  shiftRock(map, cell, wanted, "mountains");
  observed(wanted);
}
/** A collision route carries a whole donor package; callers cannot forget its cover or history. */
export function landCollisionPackage(
  map: PhysicalField,
  held: HeldRock,
  target: number,
  source: number,
  areaRatio: number,
  f: Deformation
) {
  const rock = Math.max(0, heldPlacement(held, "SurfaceRockLoad", source));
  accreteHeldGround(map, held, target, source, rock * areaRatio, f, rock);
  accreteHeldCover(map, held, target, source, areaRatio, f);
}
export function superposeHeldSheets(
  map: PhysicalField,
  held: HeldRock,
  cell: number,
  under: number,
  top: number
) {
  moveHeldSheet(map, held, cell, under);
  landCollisionPackage(map, held, cell, top, 1, [1, 0, 0, 1]);
  takeHeldSheet(map, held, cell, top);
}
import { MapScale } from "@atlas/domain";
