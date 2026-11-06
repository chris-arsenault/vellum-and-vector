import type { PhysicalField } from "../canonry/field";
import { rockResistance, round } from "../canonry/math";
import { hardestRock, rockCatalogue, softestRock, type RockKindId } from "./rockCatalogue";

/** All ground starts as ordinary rock. */
export function resetRock(map: PhysicalField) {
  map.RockResistance.fill(rockCatalogue.strata.resistance);
}
/** A map says how strong the rock at a cell is, where it knows no more than that. */
export function setRockStrength(map: PhysicalField, cell: number, strength: number) {
  map.RockResistance.set(cell, rockResistance(strength));
}
/** New crust's surface is basalt. */
export function newBasaltSurface(map: PhysicalField, cell: number) {
  map.RockKindCodes.set(cell, rockCatalogue.basalt.code);
  map.RockResistance.set(cell, rockCatalogue.basalt.resistance);
}

/** Hardens or softens the rock at a cell in place, within the limits of what rock can be. */
export function alterRock(map: PhysicalField, cell: number, change: number) {
  map.RockResistance.set(cell, rockResistance(map.RockResistance.get(cell) + change));
}
/** Salt fuses the rock it lies on: harder for any scorch, and glass where the bed burnt through. */
export function fuseRock(map: PhysicalField, cell: number, hardening: number, toGlass: boolean) {
  map.RockResistance.set(
    cell,
    Math.max(0, Math.min(hardestRock, map.RockResistance.get(cell) + round(hardening)))
  );
  if (!toGlass) return;
  map.RockResistance.set(
    cell,
    Math.max(map.RockResistance.get(cell), rockCatalogue.saltGlass.resistance)
  );
  map.RockLayerKind0.set(cell, rockCatalogue.saltGlass.code);
  map.RockKindCodes.set(cell, rockCatalogue.saltGlass.code);
}

/** A process that hardens ground leaves its own rock on the surface, where it is harder than what was. */
export function hardenRock(
  map: PhysicalField,
  cell: number,
  kind: RockKindId,
  resistance: number = rockCatalogue[kind].resistance
) {
  const value = Math.max(softestRock, Math.min(hardestRock, resistance));
  if (value <= map.RockResistance.get(cell)) return;
  map.RockResistance.set(cell, value);
  map.RockKindCodes.set(cell, rockCatalogue[kind].code);
  map.RockLayerKind0.set(cell, rockCatalogue[kind].code);
}
