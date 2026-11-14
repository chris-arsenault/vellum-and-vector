import type { PhysicalField } from "../world/field";
import { humanLayersOf } from "./humanLayers";
import type { IdentityColumn, IdentityTraditions } from "./identityColumn";

/**
 * What the identity column says about a cell, read without changing it: for one tradition,
 * the code most of the cell's people hold and how many hold each. Regions, territories and
 * names are read through these.
 */
export type TraditionField = keyof IdentityTraditions;
export const traditionFields: readonly TraditionField[] = [
  "tongue",
  "faith",
  "custom",
  "allegiance",
];

/** People per square kilometre holding each code of a tradition in a column. */
export function held(column: IdentityColumn, field: TraditionField) {
  // hpc-exempt: at most one entry per layer of a cell's column.
  const people = new Map<number, number>();
  for (const layer of column)
    if (layer[field] > 0) people.set(layer[field], (people.get(layer[field]) ?? 0) + layer.people);
  return people;
}
/** The code of a tradition most of a column's people hold, and how many hold it; 0 for none. */
export function leading(
  column: IdentityColumn,
  field: TraditionField
): [code: number, people: number] {
  let code = 0,
    most = 0;
  for (const [candidate, people] of held(column, field))
    if (people > most || (people === most && candidate < code)) [code, most] = [candidate, people];
  return [code, most];
}
export interface Leading {
  /** Per cell: the code most of its people hold, or 0. */
  readonly code: Int32Array;
  /** Per cell: the people per square kilometre who hold it. */
  readonly people: Float64Array;
}
/** Every cell's leading code of one tradition. */
export function leadingOf(map: PhysicalField, field: TraditionField): Leading {
  const layers = humanLayersOf(map),
    code = new Int32Array(map.mesh.count),
    people = new Float64Array(map.mesh.count);
  for (let cell = 0; cell < map.mesh.count; cell++)
    [code[cell], people[cell]] = leading(layers.column(cell), field);
  return { code, people };
}
/** Every cell's leading code of every tradition, from one reading of each column. */
export function leadingAll(map: PhysicalField): Record<TraditionField, Leading> {
  const layers = humanLayersOf(map),
    count = map.mesh.count,
    all = Object.fromEntries(
      traditionFields.map((field) => [
        field,
        { code: new Int32Array(count), people: new Float64Array(count) },
      ])
    ) as Record<TraditionField, Leading>;
  for (let cell = 0; cell < count; cell++) {
    const column = layers.column(cell);
    if (!column.length) continue;
    for (const field of traditionFields)
      [all[field].code[cell], all[field].people[cell]] = leading(column, field);
  }
  return all;
}
