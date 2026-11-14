import type { PhysicalField } from "../world/field";
import { rockKindOfCode } from "./rockCatalogue";
import {
  columnSize,
  deepestLayer,
  layDownRock,
  readLayer,
  stripRock,
  finiteSlice,
  type MaterialLayer,
} from "./rockColumn";
import type { Column } from "@atlas/domain";
import { releasedMaterial } from "./groundCargoIdentity";

/** A withdrawal visits the actual layers before they disappear; callbacks must consume snapshots. */
export type MaterialReceiver = (material: MaterialLayer) => void;
export function withdrawColumn(
  map: PhysicalField,
  cell: number,
  column: Column,
  amount: number,
  receive?: MaterialReceiver
) {
  const solid = column === "land" || column === "cut",
    last = deepestLayer(map, cell, column);
  let left = Math.max(0, amount);
  for (let slot = 0; slot <= last && left > 0; slot++) {
    const layer = readLayer(map, cell, slot, column),
      taken = Math.min(left, solid && slot === last ? Infinity : layer.depth);
    if (taken > 0)
      receive?.(releasedMaterial(map, finiteSlice(layer, taken, solid && slot === last)));
    left -= taken;
  }
  const removed = amount - left;
  stripRock(map, cell, removed, column);
  return removed;
}
export function placeMaterial(
  map: PhysicalField,
  cell: number,
  column: Column,
  material: MaterialLayer
) {
  layDownRock(map, cell, rockKindOfCode(material.kind), material.depth, material, column);
}
/** Burial consumes the oldest loose material at the bottom, preserving the younger cover. */
export function withdrawBuried(
  map: PhysicalField,
  cell: number,
  column: Column,
  amount: number,
  receive: MaterialReceiver
) {
  let left = Math.max(0, amount);
  for (let slot = columnSize(column) - 1; slot >= 0 && left > 0; slot--) {
    const layer = readLayer(map, cell, slot, column),
      taken = Math.min(left, layer.depth);
    if (taken <= 0) continue;
    receive({ ...layer, depth: taken });
    groundStorage(map)[columnFields[column].depth[slot]].add(cell, -taken);
    if (taken >= layer.depth) writeCargo(map, cell, slot, column);
    else touchCargo(map, cell);
    left -= taken;
  }
  return amount - left;
}
import { columnFields } from "@atlas/domain";
import { groundStorage } from "./groundStorage";
import { writeCargo, touchCargo } from "./groundCargo";
