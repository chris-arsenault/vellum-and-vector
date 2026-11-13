import { fieldInterpolator, sweepBudget, type Grid } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { columnNames, inheritColumn, waterColumnChannels } from "./column";

/** The water owner imports the package; generic scalar inheritance cannot split it. */
export function inheritWaterColumn(
  map: PhysicalField,
  surface: Grid,
  parent: ReadonlyMap<string, Grid>
) {
  const readers = waterColumnChannels.map((part) => {
    const source = parent.get(part.name) ?? surface;
    return source.channels[part.name]
      ? fieldInterpolator(
          source,
          part.name,
          part.quantity === "category",
          undefined,
          sweepBudget(source)
        )
      : null;
  });
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const position = {
      x: map.mesh.x(cell) + map.mesh.origin[0],
      y: map.mesh.y(cell) + map.mesh.origin[1],
      z: 0,
    };
    inheritColumn(map, cell, (part) => {
      const at = columnNames.indexOf(part),
        reader = readers[at];
      const value = reader ? reader(position) : map[part].get(cell),
        bounds = waterColumnChannels[at];
      return Math.max(bounds.minimum ?? -Infinity, Math.min(bounds.maximum ?? Infinity, value));
    });
  }
}
