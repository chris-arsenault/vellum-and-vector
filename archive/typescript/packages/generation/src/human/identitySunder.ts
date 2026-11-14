import { humanLayers } from "@atlas/domain";
import type { GenerationState } from "../process";
import { defineCommand, runOperation } from "../processOperation";
import type { PhysicalField } from "../world/field";
import { reachedBy } from "./hinterlands";
import { leadingOf, type Leading } from "./identityReads";
import { km2 } from "./landWork";
import { renameTradition } from "./layerOperations";
import { foundTradition, knownTraditions } from "./traditions";

/**
 * A people cut off from the heart of its tongue or custom begins a daughter of it. The heart
 * is where most hold the tradition; whoever leads with it farther off than a tradition
 * survives, by the going, is cut off. Each separate cut-off country that holds enough people
 * to matter becomes one daughter, and everyone there who held the parent holds the daughter:
 * nobody is persuaded, the tradition has simply become something else there.
 */
export interface Sundering {
  state: GenerationState;
  map: PhysicalField;
  step: (from: number, to: number) => number;
  era: string;
}
/** Travel, as a share of the map scale's reference length, beyond which a tradition splits. */
const sundering = 0.2;
/** The least share of a tradition's people a cut-off country must hold to begin a daughter. */
const daughterShare = 0.05;

const count = (map: PhysicalField, cell: number) =>
  map[humanLayers.population].get(cell) * km2(map, cell);
/** The people on some cells, and the cell among them with the most. */
function gathering(map: PhysicalField, cells: readonly number[]) {
  let total = 0,
    centre = -1;
  for (const cell of cells) {
    total += count(map, cell);
    if (centre < 0 || count(map, cell) > count(map, centre)) centre = cell;
  }
  return { people: total, centre };
}
/** The given cells as separate countries: cells joined to one another through neighbours. */
function countries(map: PhysicalField, cells: readonly number[]) {
  const waiting = new Set(cells),
    found: number[][] = [];
  for (const start of cells) {
    if (!waiting.delete(start)) continue;
    const country = [start];
    for (let at = 0; at < country.length; at++)
      for (let edge = 0; edge < map.mesh.degree(country[at]); edge++) {
        const next = map.mesh.neighbor(country[at], edge);
        if (next >= 0 && waiting.delete(next)) country.push(next);
      }
    found.push(country);
  }
  return found;
}
/** The cut-off countries of one tradition that hold enough of its people to matter. */
function sundered(map: PhysicalField, step: Sundering["step"], leading: Leading, code: number) {
  const holders: number[] = [];
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (leading.code[cell] === code) holders.push(cell);
  const whole = gathering(map, holders);
  if (whole.centre < 0) return [];
  const within = reachedBy(map, [whole.centre], step, map.scale.length(sundering));
  return countries(
    map,
    holders.filter((cell) => within[cell] < 0)
  )
    .map((cells) => ({ cells, ...gathering(map, cells) }))
    .filter((country) => country.people >= daughterShare * whole.people);
}
export const sunderIdentities = defineCommand(
  "human.identity.sunder",
  "event",
  ({ state, map, step, era }: Sundering) => {
    for (const field of ["tongue", "custom"] as const) {
      const leading = leadingOf(map, field);
      // Only the traditions known when the era ends can split in it.
      for (const tradition of [...knownTraditions(state)]) {
        if (tradition.kind !== field || tradition.ended) continue;
        const becomes = new Int32Array(map.mesh.count).fill(-1);
        for (const country of sundered(map, step, leading, tradition.code)) {
          const daughter = foundTradition(state, {
            kind: field,
            key: `${tradition.entity}:${era}:${country.centre}`,
            origin: {
              x: map.mesh.origin[0] + map.mesh.x(country.centre),
              y: map.mesh.origin[1] + map.mesh.y(country.centre),
            },
            era,
            parent: tradition.code,
            tongue: field === "tongue" ? tradition.code : undefined,
          });
          for (const cell of country.cells) becomes[cell] = daughter;
        }
        runOperation(map, renameTradition, {
          map,
          tradition: field,
          from: tradition.code,
          to: { get: (cell) => becomes[cell] },
        });
      }
    }
  },
  []
);
