import type { PhysicalField } from "../world/field";
import { GroundInventory } from "./groundInventory";
import { cargoIdentity } from "./groundCargoIdentity";
import { units } from "../world/math";

/** Carbon density of porous detritus, kg/m³; sediment and burial keep it in the same parcel. */
export const organicDensity = 150;
export const organicCargoKey = (map: PhysicalField) => cargoIdentity(map, "organic:carbon");
// hpc-exempt: one inventory handle per map; its cargo lives in canonical Ground material.
const stores = new WeakMap<PhysicalField, GroundInventory>();
/** Decomposition releases accessible transported carbon and nutrients into the receiving soil. */
export function recycleOrganicMaterial(
  map: PhysicalField,
  cell: number,
  years: number,
  stillness: number
) {
  let store = stores.get(map);
  if (!store) stores.set(map, (store = new GroundInventory(map, "organic:carbon")));
  const fraction = -Math.expm1((-years * (1 - 0.9 * stillness)) / 300),
    carbon =
      store.release(
        cell,
        units(map.SoilDepth.get(cell) + map.scale.length(2.5e-8)),
        () => fraction
      ) / map.mesh.area(cell);
  map.SoilCarbon.add(cell, carbon);
  map.MineralNutrients.add(cell, carbon * 0.02);
}
