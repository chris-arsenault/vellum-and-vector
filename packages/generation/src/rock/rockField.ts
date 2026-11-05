import type { PhysicalField } from "../canonry/field";
import { hardestRock, rockCatalogue, softestRock, type RockKindId } from "./rockCatalogue";

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
