import type { Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { mergeMaterial, type MaterialLayer } from "./rockColumn";
import { materialProperties, type MaterialProperty } from "./rockLayerFields";

import { loadFields, seaLoadFields } from "./groundLoadFields";
import { groundStorage } from "./groundStorage";
export {
  loadIntegerFields,
  loadScalarFields,
  seaLoadIntegerFields,
  seaLoadScalarFields,
} from "./groundLoadFields";
const integerProperty = (property: MaterialProperty) =>
  property === "kind" || property === "secondaryKind" || property === "mixed";

/** Disaggregated material in cubic metres; its depth field is volume until it lands on ground. */
export class MaterialLoad {
  private readonly bands: readonly Band[];
  constructor(
    private readonly map: PhysicalField,
    key: string,
    private readonly persistent?: "ground" | "sea"
  ) {
    const fields = persistent === "sea" ? seaLoadFields : loadFields;
    this.bands = materialProperties.map((property) =>
      persistent
        ? groundStorage(map)[fields[property]]
        : workingArray(map, integerProperty(property) ? "int32" : "float64", `${key}:${property}`)
    );
  }
  amount(cell: number) {
    return this.bands[1].get(cell);
  }
  /** Independent scalar snapshot; subsequent routing cannot change an earlier receipt. */
  get(cell: number): MaterialLayer {
    const value = (property: MaterialProperty) =>
      this.bands[materialProperties.indexOf(property)].get(cell);
    return {
      kind: value("kind"),
      depth: value("depth"),
      secondaryKind: value("secondaryKind"),
      secondaryShare: value("secondaryShare"),
      strength: value("strength"),
      damage: value("damage"),
      grainX: value("grainX"),
      grainY: value("grainY"),
      bedSlopeX: value("bedSlopeX"),
      bedSlopeY: value("bedSlopeY"),
      deposited: value("deposited"),
      consolidation: value("consolidation"),
      formedMin: value("formedMin"),
      formedMax: value("formedMax"),
      altered: value("altered"),
      mixed: value("mixed"),
    };
  }
  add(cell: number, material: MaterialLayer) {
    if (material.depth <= 0) return;
    const next = this.amount(cell) > 0 ? mergeMaterial(this.get(cell), material) : material;
    materialProperties.forEach((property, index) => this.bands[index].set(cell, next[property]));
    this.project(cell);
  }
  take(cell: number, volume: number): MaterialLayer {
    const held = this.get(cell),
      taken = Math.min(held.depth, Math.max(0, volume));
    this.bands[1].set(cell, held.depth - taken);
    this.project(cell);
    return { ...held, depth: taken };
  }
  clear(cell: number) {
    for (const band of this.bands) band.set(cell, 0);
    this.project(cell);
  }
  release() {
    if (!this.persistent) releaseWorking(this.map, ...this.bands);
  }
  private project(cell: number) {
    if (this.persistent !== "ground") return;
    const area = this.map.mesh.area(cell);
    groundStorage(this.map).SedimentSupply.set(
      cell,
      area > 0 ? (this.amount(cell) * 1024) / area : 0
    );
  }
}

const loads = new WeakMap<PhysicalField, MaterialLoad>();
/** Worn material persists between processes in the field's published numerical resources. */
export function loadOf(map: PhysicalField) {
  let load = loads.get(map);
  if (!load) {
    load = new MaterialLoad(map, "ground:load", "ground");
    loads.set(map, load);
  }
  return load;
}
const seaLoads = new WeakMap<PhysicalField, MaterialLoad>();
/** Offshore material remains at its receiving cell until connected marine transport moves it. */
export function seaLoadOf(map: PhysicalField) {
  let load = seaLoads.get(map);
  if (!load) {
    load = new MaterialLoad(map, "sea:load", "sea");
    seaLoads.set(map, load);
  }
  return load;
}
