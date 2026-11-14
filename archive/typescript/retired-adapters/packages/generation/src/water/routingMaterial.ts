import { groundOf } from "../rock/ground";
import { compileMix } from "../rock/modes";
import type { PhysicalField } from "../world/field";
import type { PhysicalContext } from "../world/context";
import { ask } from "../coupling/answers";

/** Organization and present routing ask the same exposed beds in the direction of travel. */
const incision = compileMix({ abrasion: 0.6, plucking: 0.4 });
export const directionalResponsesFrom = (
  map: PhysicalField,
  cell: number,
  context: PhysicalContext
) => groundOf(map).faceGivesFrom(cell, incision, ask(map, "rootHold", context));

/** Initial valley placement measures work through yielding faces, without changing Ground. */
export function directionalResistance(
  map: PhysicalField,
  cell: number,
  toward: number,
  context: PhysicalContext
) {
  const response = directionalResponsesFrom(map, cell, context)(toward);
  return response > 0 ? 1 / response : Infinity;
}
