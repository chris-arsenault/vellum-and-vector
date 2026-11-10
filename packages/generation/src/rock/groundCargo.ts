import { CellList, FloatList, type Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { retainedArray, releaseWorking } from "../world/physicalNumerics";
import { columns, columnFields, type Column } from "./rockLayerFields";
import type { MaterialCargo } from "./materialCargo";

/** Exclusive sparse chains per material slot. Freed records are reused, never shared by snapshots. */
export class CargoStore {
  private readonly keys = new CellList();
  private readonly hosts = new CellList();
  private readonly densities = new FloatList();
  private readonly next = new CellList();
  private free = 0;
  constructor(readonly heads: Band) {}
  get(slot: number): MaterialCargo | undefined {
    let count = 0;
    for (let head = this.heads.get(slot); head; head = this.next.at(head - 1)) count++;
    if (!count) return undefined;
    const cargo = new Float64Array(count * 3);
    let at = 0;
    for (let head = this.heads.get(slot); head; head = this.next.at(head - 1)) {
      cargo[at++] = this.keys.at(head - 1);
      cargo[at++] = this.hosts.at(head - 1);
      cargo[at++] = this.densities.at(head - 1);
    }
    return cargo;
  }
  set(slot: number, cargo?: MaterialCargo) {
    this.clear(slot);
    if (!cargo) return;
    let head = 0;
    for (let at = cargo.length - 3; at >= 0; at -= 3) {
      if (!(cargo[at + 2] > 0)) continue;
      const index = this.allocate();
      this.keys.set(index, cargo[at]);
      this.hosts.set(index, cargo[at + 1]);
      this.densities.set(index, cargo[at + 2]);
      this.next.set(index, head);
      head = index + 1;
    }
    this.heads.set(slot, head);
  }
  clear(slot: number) {
    let head = this.heads.get(slot);
    while (head) {
      const next = this.next.at(head - 1);
      this.next.set(head - 1, this.free);
      this.free = head;
      head = next;
    }
    this.heads.set(slot, 0);
  }
  private allocate() {
    if (this.free) {
      const index = this.free - 1;
      this.free = this.next.at(index);
      return index;
    }
    const index = this.keys.length;
    this.keys.push(0);
    this.hosts.push(0);
    this.densities.push(0);
    this.next.push(0);
    return index;
  }
  snapshot(map: PhysicalField) {
    const copy = new CargoStore(map.coverage.copyBand(this.heads));
    copy.keys.copyFrom(this.keys.finish());
    copy.hosts.copyFrom(this.hosts.finish());
    copy.densities.copyFrom(this.densities.finish());
    copy.next.copyFrom(this.next.finish());
    copy.free = this.free;
    return copy;
  }
  release(map: PhysicalField) {
    releaseWorking(map, this.heads);
  }
}

let slots = 0;
// hpc-exempt: fixed column schema offsets, not per-cell state.
const offsets = Object.fromEntries(
  columns.map((column) => {
    const offset = slots;
    slots += columnFields[column].depth.length;
    return [column, offset];
  })
) as Record<Column, number>;
export const cargoSlot = (count: number, cell: number, layer: number, column: Column) =>
  (offsets[column] + layer) * count + cell;
// hpc-exempt: one Ground-owned typed payload store per map, not object storage per cell.
const stores = new WeakMap<PhysicalField, CargoStore>();
// hpc-exempt: per-map typed derived occupancy and invalidation bands, never a second inventory.
const indices = new WeakMap<PhysicalField, { occupied: Band; revision: Band }>();
export function groundCargo(map: PhysicalField) {
  let store = stores.get(map);
  if (!store) {
    store = new CargoStore(
      retainedArray(map, "int32", "ground:cargo-heads", map.mesh.count * slots)
    );
    stores.set(map, store);
    indices.set(map, {
      occupied: retainedArray(map, "uint8", "ground:cargo-occupied"),
      revision: retainedArray(map, "float64", "ground:cargo-revision"),
    });
  }
  return store;
}
export function holdCargo(map: PhysicalField) {
  return stores.get(map)?.snapshot(map);
}
export function clearCellCargo(map: PhysicalField, cell: number) {
  const store = stores.get(map);
  if (!store) return;
  for (let slot = 0; slot < slots; slot++) store.clear(slot * map.mesh.count + cell);
  indices.get(map)!.occupied.set(cell, 0);
  touchCargo(map, cell);
}
export function readCargo(map: PhysicalField, cell: number, layer: number, column: Column) {
  if (!hasCargo(map, cell)) return undefined;
  return stores.get(map)?.get(cargoSlot(map.mesh.count, cell, layer, column));
}
export function writeCargo(
  map: PhysicalField,
  cell: number,
  layer: number,
  column: Column,
  cargo?: MaterialCargo
) {
  const store = cargo ? groundCargo(map) : stores.get(map);
  if (!store) return;
  const slot = cargoSlot(map.mesh.count, cell, layer, column),
    before = Number(store.heads.get(slot) > 0);
  store.set(slot, cargo);
  indices.get(map)!.occupied.add(cell, Number(store.heads.get(slot) > 0) - before);
  touchCargo(map, cell);
}
export const hasCargo = (map: PhysicalField, cell: number) =>
  (indices.get(map)?.occupied.get(cell) ?? 0) > 0;
export const cargoRevision = (map: PhysicalField, cell: number) =>
  indices.get(map)?.revision.get(cell) ?? 0;
export function touchCargo(map: PhysicalField, cell: number) {
  indices.get(map)?.revision.add(cell, 1);
}
