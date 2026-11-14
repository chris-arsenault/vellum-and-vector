import { fieldInterpolator, sweepBudget, type Grid } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { inheritColumn, waterColumnChannels } from "./column";
import { inheritWaterYear, waterYearChannels } from "./yearResources";

export const waterStateChannels = [...waterColumnChannels, ...waterYearChannels];

/** The water owner imports the package; generic scalar inheritance cannot split it. */
export function inheritWaterState(
  map: PhysicalField,
  surface: Grid,
  parent: ReadonlyMap<string, Grid>
) {
  // hpc-exempt: function-valued resource interpolators keyed by channel names, not per-cell numerical state.
  const readers = new Map(
    waterStateChannels.map((part) => {
      const source = parent.get(part.name) ?? surface;
      const read = source.channels[part.name]
        ? fieldInterpolator(
            source,
            part.name,
            part.quantity === "category",
            undefined,
            sweepBudget(source)
          )
        : null;
      return [part.name, { read, bounds: part }] as const;
    })
  );
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const position = {
      x: map.mesh.x(cell) + map.mesh.origin[0],
      y: map.mesh.y(cell) + map.mesh.origin[1],
      z: 0,
    };
    const value = (part: (typeof waterStateChannels)[number]["name"]) => {
      const { read, bounds } = readers.get(part)!;
      const value = read ? read(position) : map[part].get(cell);
      return Math.max(bounds.minimum ?? -Infinity, Math.min(bounds.maximum ?? Infinity, value));
    };
    inheritColumn(map, cell, value);
    inheritWaterYear(map, cell, value);
  }
}
