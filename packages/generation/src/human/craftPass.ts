import { humanLayers } from "@atlas/domain";
import { defineCommand, runOperation } from "../processOperation";
import type { PhysicalField } from "../world/field";
import { crafts, holding, mediumAt } from "./craftCatalogue";
import { overlayIdentity } from "./layerOperations";

/**
 * How a people comes to hold a craft. Living on ground a system's medium reaches, they learn
 * to work it: over the generations it takes, the share of a cell's people who take the craft
 * up is the share of their ground the medium holds. Where two media lie on one cell its
 * people learn the stronger. Nobody learns a craft away from its medium, but whoever holds
 * one carries it wherever they go, in their identity, and their children hold it after them.
 */
/** Years over which the people of ground wholly held by a medium all come to its craft. */
const learningYears = 300;

export interface CraftEra {
  map: PhysicalField;
  years: number;
}
/** The craft each cell's ground teaches, as its number, and how much of the ground teaches it. */
function taught(map: PhysicalField) {
  const code = new Int32Array(map.mesh.count),
    medium = new Float64Array(map.mesh.count);
  for (let cell = 0; cell < code.length; cell++)
    for (const craft of crafts) {
      const here = mediumAt(map, craft, cell);
      if (here > medium[cell]) [code[cell], medium[cell]] = [craft.code, here];
    }
  return { code, medium };
}
export const learnCrafts = defineCommand(
  "human.crafts.learn",
  "elapsed",
  ({ map, years }: CraftEra) => {
    const { code, medium } = taught(map),
      people = map[humanLayers.population],
      learning = -Math.expm1(-years / learningYears),
      // Those the ground can still teach: its share of the cell's people, less those who
      // already hold the craft it teaches.
      unlearned = (cell: number) =>
        Math.max(0, medium[cell] - holding(map, crafts[code[cell] - 1], cell));
    runOperation(map, overlayIdentity, {
      map,
      traditions: { craft: { get: (cell) => code[cell] } },
      people: {
        get: (cell) => (code[cell] ? people.get(cell) * unlearned(cell) * learning : 0),
      },
      hardness: 0,
    });
  },
  []
);
