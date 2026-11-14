import { CellList, requireThat } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { mapCargoKeys, type MaterialCargo } from "./materialCargo";
import type { MaterialLayer } from "./rockLayerFields";

// hpc-exempt: map-level identity metadata; material quantities live only in Ground cargo.
const registries = new WeakMap<PhysicalField, { names: string[]; released: CellList }>();
function registry(map: PhysicalField) {
  let held = registries.get(map);
  if (!held) registries.set(map, (held = { names: [], released: new CellList() }));
  return held;
}
function identity(held: ReturnType<typeof registry>, name: string) {
  let index = held.names.indexOf(name);
  if (index < 0) {
    index = held.names.length;
    held.names.push(name);
    held.released.push(index + 1);
  }
  return index + 1;
}
/** A custodian declares the ordinary identity to which released grains return. */
export function cargoIdentity(map: PhysicalField, name: string, releasedTo?: string) {
  const held = registry(map),
    key = identity(held, name);
  if (releasedTo !== undefined) {
    const target = identity(held, releasedTo),
      previous = held.released.at(key - 1);
    requireThat(
      (previous === key || previous === target) && held.released.at(target - 1) === target,
      "cargo_identity",
      "Custody returns to one ordinary material identity."
    );
    held.released.set(key - 1, target);
  }
  return key;
}
export const cargoIdentities = (map: PhysicalField): readonly string[] =>
  registries.get(map)?.names ?? [];
export function cargoReleaseNames(map: PhysicalField): readonly string[] {
  const held = registries.get(map);
  return held ? held.names.map((_, i) => held.names[held.released.at(i) - 1]) : [];
}
/** Bulk natural movement ends custody; origin and constituent identity remain on the same grains. */
export function releaseCargoCustody(map: PhysicalField, cargo?: MaterialCargo) {
  const held = registries.get(map);
  return held && cargo ? mapCargoKeys(cargo, (key) => held.released.at(key - 1) || key) : cargo;
}
export function releasedMaterial(map: PhysicalField, material: MaterialLayer): MaterialLayer {
  const cargo = releaseCargoCustody(map, material.cargo);
  return cargo === material.cargo ? material : { ...material, cargo };
}
