import {
  MapScale,
  humanLayerIds,
  identityColumn,
  identitySlots,
  type Band,
  type HumanBandName,
  type HumanLayerId,
} from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { IdentityColumn, IdentityLayer } from "./identityColumn";
import { areaLayers, fullStandingPerBuiltKm2, layerCatalogue, layerRoles } from "./layerCatalogue";

/** Every human band's values, as the map holds them or as a copy taken of them. */
export type HumanValues = Record<HumanBandName, Pick<Band, "get">>;
export const unit = (value: number) => (value > 0 ? Math.min(1, value) : 0);
/** A usable amount: a number above nothing. Anything else, NaN included, is nothing. */
export const positive = (value: number) => (value > 0 && Number.isFinite(value) ? value : 0);
const noLayer: IdentityLayer = {
  people: 0,
  hardness: 0,
  age: 0,
  tongue: 0,
  faith: 0,
  custom: 0,
  allegiance: 0,
  craft: 0,
};

/**
 * One map's human bands and how a cell's values are read from them. Part of the layers'
 * owner: the changes in the owner's other files are made through this and nowhere else.
 */
export class LayerBands {
  readonly of: Record<HumanLayerId, Band>;
  private readonly area: Band[];
  constructor(readonly map: PhysicalField) {
    this.of = Object.fromEntries(
      humanLayerIds.map((id) => [id, map[layerCatalogue[id].band]])
    ) as Record<HumanLayerId, Band>;
    this.area = areaLayers.map((id) => this.of[id]);
  }
  get count() {
    return this.map.mesh.count;
  }
  /** The share of a cell's area no layer has taken. */
  freeArea(cell: number) {
    let taken = 0;
    for (const band of this.area) taken += band.get(cell);
    return Math.max(0, 1 - taken);
  }
  /** How far a cell's built place stands, against a place at its fullest (0 to 1). */
  standing(cell: number) {
    const built = this.of[layerRoles.built].get(cell);
    return built > 0
      ? unit(this.of[layerRoles.works].get(cell) / (built * fullStandingPerBuiltKm2))
      : 0;
  }
  /** The people living on a cell, per square kilometre. */
  people(cell: number) {
    return this.of[layerRoles.people].get(cell);
  }
  /** A cell's identity column, newest layer first. */
  column(cell: number, from: HumanValues = this.map): IdentityColumn {
    const column: IdentityColumn = [],
      { people, hardness, age, traditions } = identityColumn;
    for (let slot = 0; slot < identitySlots; slot++) {
      const held = from[people[slot]].get(cell);
      if (held <= 0) continue;
      column.push({
        people: held,
        hardness: from[hardness[slot]].get(cell),
        age: from[age[slot]].get(cell),
        tongue: from[traditions.Tongue[slot]].get(cell),
        faith: from[traditions.Faith[slot]].get(cell),
        custom: from[traditions.Custom[slot]].get(cell),
        allegiance: from[traditions.Allegiance[slot]].get(cell),
        craft: from[traditions.Craft[slot]].get(cell),
      });
    }
    return column;
  }
  writeColumn(cell: number, column: IdentityColumn) {
    const { people, hardness, age, traditions } = identityColumn;
    for (let slot = 0; slot < identitySlots; slot++) {
      const layer = column[slot] ?? noLayer;
      this.map[people[slot]].set(cell, layer.people);
      this.map[hardness[slot]].set(cell, layer.hardness);
      this.map[age[slot]].set(cell, layer.age);
      this.map[traditions.Tongue[slot]].set(cell, layer.tongue);
      this.map[traditions.Faith[slot]].set(cell, layer.faith);
      this.map[traditions.Custom[slot]].set(cell, layer.custom);
      this.map[traditions.Allegiance[slot]].set(cell, layer.allegiance);
      this.map[traditions.Craft[slot]].set(cell, layer.craft);
    }
  }
  /** Every layer of a cell's column keeps this share of its people. */
  thinColumn(cell: number, kept: number) {
    for (const band of identityColumn.people)
      this.map[band].set(cell, this.map[band].get(cell) * unit(kept));
  }
  /** What a cell can take of a kind: area kinds only into the cell's free area. */
  room(kind: HumanLayerId, cell: number) {
    return layerCatalogue[kind].measure === "area" ? this.freeArea(cell) : Infinity;
  }
  /** Whether a cell is ground a layer can be moved onto. */
  ground(cell: number) {
    return cell >= 0 && cell < this.count && this.map.mesh.area(cell) > 0;
  }
  /** What a cell's value of any layer becomes on another cell: both are per area of ground. */
  across(from: number, to: number) {
    return this.map.mesh.area(from) / this.map.mesh.area(to);
  }
  km2(cell: number) {
    return MapScale.areaUnits(this.map.mesh.area(cell), "m2", "km2");
  }
}
