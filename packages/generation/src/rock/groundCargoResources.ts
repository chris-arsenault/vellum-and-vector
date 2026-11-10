import {
  FloatList,
  requireThat,
  writeRange,
  type Coverage,
  type MaterialCargoSamples,
} from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { cargoIdentities, cargoIdentity, cargoReleaseNames } from "./groundCargoIdentity";
import { clearCellCargo, readCargo, writeCargo } from "./groundCargo";
import { columns, columnFields, type Column } from "./rockLayerFields";
import { layerDepth } from "./rockColumn";
import { loadOf, seaLoadOf } from "./groundLoad";
import type { MaterialCargo } from "./materialCargo";

// hpc-exempt: fixed material schema slots, not retained per-cell object storage.
const slots = columns.flatMap((column) =>
  columnFields[column].depth.map((_, layer) => ({ column, layer }))
);
export const materialCargoSlots = [
  ...slots.map(({ column, layer }) => `${column}:${layer}`),
  "ground-load",
  "sea-load",
];

/** Detached sparse capture follows the same complete material donor as its scalar columns. */
export function captureMaterialCargo(
  map: PhysicalField,
  coverage: Coverage = map.coverage,
  count = map.mesh.count,
  donor: (cell: number) => number = (cell) => cell
): MaterialCargoSamples {
  const offsets = coverage.scratch("uint32", "material:capture-offsets", count + 1),
    entries = new FloatList();
  let records: MaterialCargoSamples["records"] | undefined;
  try {
    for (let cell = 0; cell < count; cell++) {
      offsets.set(cell, entries.length / 4);
      captureCell(map, donor(cell), entries);
    }
    offsets.set(count, entries.length / 4);
    records = coverage.scratch("float64", "material:capture-records", entries.length);
    writeRange(records, 0, entries.finish());
    offsets.retain();
    records.retain();
    return {
      keys: [...cargoIdentities(map)],
      releasedTo: cargoReleaseNames(map),
      slots: [...materialCargoSlots],
      offsets,
      records,
    };
  } catch (error) {
    coverage.release(offsets);
    if (records) coverage.release(records);
    throw error;
  }
}
function captureCell(map: PhysicalField, cell: number, entries: FloatList) {
  for (const [slot, { column, layer }] of slots.entries())
    if (layerDepth(map, cell, layer, column) > 0)
      append(entries, slot, readCargo(map, cell, layer, column));
  append(entries, slots.length, loadOf(map).readCargo(cell));
  append(entries, slots.length + 1, seaLoadOf(map).readCargo(cell));
}
function append(entries: FloatList, slot: number, cargo?: MaterialCargo) {
  if (!cargo) return;
  for (let at = 0; at < cargo.length; at += 3) {
    requireCargo(cargo[at], cargo[at + 1], cargo[at + 2]);
    entries.push(slot);
    entries.push(cargo[at]);
    entries.push(cargo[at + 1]);
    entries.push(cargo[at + 2]);
  }
}
/** Import after complete material columns/loads; key IDs are local and remap by captured names. */
export function importMaterialCargo(
  map: PhysicalField,
  captured: MaterialCargoSamples,
  donor: (cell: number) => number = (cell) => cell
) {
  requireThat(
    captured.slots.length === materialCargoSlots.length &&
      captured.slots.every((name, slot) => name === materialCargoSlots[slot]),
    "material_cargo",
    "Import complete current material cargo slots."
  );
  requireThat(
    Array.isArray(captured.releasedTo) && captured.releasedTo.length === captured.keys.length,
    "material_custody",
    "Current material capture requires every identity's release target."
  );
  const keys = Uint32Array.from(captured.keys, (name) => cargoIdentity(map, name));
  for (const [index, name] of captured.keys.entries()) {
    const target = captured.releasedTo[index],
      targetIndex = captured.keys.indexOf(target);
    requireThat(
      targetIndex >= 0 && captured.releasedTo[targetIndex] === target,
      "material_custody",
      "Captured custody returns directly to an ordinary material identity."
    );
    cargoIdentity(map, name, target);
  }
  for (let cell = 0; cell < map.mesh.count; cell++) {
    clearCellCargo(map, cell);
    loadOf(map).importCargo(cell);
    seaLoadOf(map).importCargo(cell);
    importCell(map, cell, captured, donor(cell), keys);
  }
}
function importCell(
  map: PhysicalField,
  cell: number,
  captured: MaterialCargoSamples,
  source: number,
  keys: Uint32Array
) {
  requireThat(
    source >= 0 && source + 1 < captured.offsets.length,
    "material_cargo",
    "Material donor must address captured cells."
  );
  const begin = captured.offsets.get(source),
    end = captured.offsets.get(source + 1);
  requireThat(
    begin <= end && end * 4 <= captured.records.length,
    "material_cargo",
    "Material offsets must address their records."
  );
  for (let at = begin; at < end;) {
    const slot = captured.records.get(at * 4),
      entries = new FloatList();
    requireThat(
      Number.isInteger(slot) && slot >= 0 && slot < materialCargoSlots.length,
      "material_cargo",
      "Cargo requires a current material slot."
    );
    do {
      appendImported(entries, captured, at, keys);
      at++;
    } while (at < end && captured.records.get(at * 4) === slot);
    installSlot(map, cell, slot, entries.finish());
  }
}
function appendImported(
  entries: FloatList,
  captured: MaterialCargoSamples,
  at: number,
  keys: Uint32Array
) {
  const key = keys[captured.records.get(at * 4 + 1) - 1],
    host = captured.records.get(at * 4 + 2),
    density = captured.records.get(at * 4 + 3);
  requireCargo(key, host, density);
  entries.push(key);
  entries.push(host);
  entries.push(density);
}
/** Capture and restore reject the same unrepresentable material before it becomes a saved resource. */
function requireCargo(key: number, host: number, density: number) {
  requireThat(
    Number.isInteger(key) &&
      key > 0 &&
      Number.isInteger(host) &&
      host >= 0 &&
      Number.isFinite(density) &&
      density > 0,
    "material_cargo",
    "Cargo requires a named reservoir, constituent and positive density."
  );
}
function installSlot(map: PhysicalField, cell: number, slot: number, cargo: MaterialCargo) {
  if (slot >= slots.length) {
    (slot === slots.length ? loadOf(map) : seaLoadOf(map)).importCargo(cell, cargo);
    return;
  }
  const { column, layer } = slots[slot];
  requireThat(
    layerDepth(map, cell, layer, column as Column) > 0,
    "material_cargo",
    "Cargo must arrive with an occupied material bed."
  );
  writeCargo(map, cell, layer, column, cargo);
}
