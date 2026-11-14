import { MapScale } from "@atlas/domain";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { humanLayersOf } from "./humanLayers";
import { held } from "./identityReads";

/**
 * The seven crafts: what a people who know how to work a magic system can do with it. A craft
 * is held in the identity column like a tongue, by the system's number. It can be learned
 * only on ground the system's own medium reaches, and it is practised only there: a people
 * that carries a craft away from its medium holds it and can do nothing with it.
 */
export interface Craft {
  /** The system it works, its number in the column, and what its practitioners call it. */
  readonly system: string;
  readonly code: number;
  readonly name: string;
  /** The band in which the system's medium lies on the land, from nothing to one. */
  readonly medium: PhysicalBufferName;
}
export const crafts: readonly Craft[] = [
  { system: "fire", code: 1, name: "hearth-keeping", medium: "Quickening" },
  { system: "aurora", code: 2, name: "reading", medium: "Stillness" },
  { system: "pressure", code: 3, name: "diving", medium: "FogForcing" },
  { system: "greenwood", code: 4, name: "tending", medium: "Verdure" },
  { system: "salt", code: 5, name: "raking", medium: "Salting" },
  { system: "hallowed", code: 6, name: "the vow", medium: "Warding" },
  { system: "veil", code: 7, name: "door-keeping", medium: "Tearing" },
];
export type CraftSystem = (typeof crafts)[number]["system"];
export const craftOf = (system: string) => crafts.find((craft) => craft.system === system)!;

const unit = (value: number) => (value > 0 ? Math.min(1, value) : 0);
/** How much of a system's medium lies on a cell, from nothing to one. */
export const mediumAt = (map: PhysicalField, craft: Craft, cell: number) =>
  unit(map[craft.medium].get(cell));
/** The share of a cell's people who hold a craft. */
export function holding(map: PhysicalField, craft: Craft, cell: number) {
  const layers = humanLayersOf(map),
    // Everyone who lives there, whether or not they hold anything yet.
    everyone = layers.people(cell);
  return everyone > 0
    ? Math.min(1, (held(layers.column(cell), "craft").get(craft.code) ?? 0) / everyone)
    : 0;
}
/**
 * How far a craft is practised on a cell, from nothing to one: the share of its people who
 * hold the craft, on the share of its ground the medium reaches. This is the share of the
 * cell on which the craft sets a rule aside.
 */
export const practised = (map: PhysicalField, craft: Craft, cell: number) => {
  const medium = mediumAt(map, craft, cell);
  return medium > 0 ? medium * holding(map, craft, cell) : 0;
};
/** The depth of water divers can hold off a shore. */
const holdable = MapScale.length(0.0000125, 0.5);
/**
 * How far the sea is held off a cell of shallows, from nothing to one: the diving practised
 * on the cell or beside it, where the bed lies no deeper than divers can hold. Ground above
 * the sea and water too deep to hold are not held at all.
 */
export function seaHeldOff(map: PhysicalField, cell: number) {
  const diving = craftOf("pressure"),
    depth = map.EffectiveSeaLevel - map.Elevation.get(cell);
  if (!(depth > 0) || depth > MapScale.inUnits(map.scale.resolveMeasure(holdable), "native"))
    return 0;
  let held = practised(map, diving, cell);
  for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
    const next = map.mesh.neighbor(cell, edge);
    if (next >= 0) held = Math.max(held, practised(map, diving, next));
  }
  return held;
}
/** One line saying on how many cells each craft is practised, for a run's progress. */
export function craftsPractised(map: PhysicalField) {
  return crafts
    .map((craft) => {
      let cells = 0;
      for (let cell = 0; cell < map.mesh.count; cell++)
        if (practised(map, craft, cell) > 0.05) cells++;
      return `${craft.name} ${cells}`;
    })
    .join(", ");
}
