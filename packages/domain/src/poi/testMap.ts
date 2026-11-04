import type { PoiChannel, PoiMap, PoiPlace } from "./poiTypes";

/**
 * A square-grid map for catalogue unit tests: `width` by `height` cells `span` metres apart,
 * channels given as functions of column and row; cells absent from `water` are land.
 */
export function gridMap(
  width: number,
  height: number,
  span: number,
  channels: Partial<Record<PoiChannel, (column: number, row: number) => number>>,
  places: PoiPlace[] = []
): PoiMap {
  const column = (cell: number) => cell % width,
    row = (cell: number) => Math.floor(cell / width);
  return {
    cellCount: width * height,
    cellSpan: span,
    position: (cell) => ({ x: column(cell) * span, y: row(cell) * span }),
    area: () => span * span,
    neighbours(cell) {
      const c = column(cell),
        r = row(cell),
        result: number[] = [];
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (c + dc >= 0 && c + dc < width && r + dr >= 0 && r + dr < height)
          result.push(cell + dc + dr * width);
      return result;
    },
    has: (channel) => channel === "water" || channel in channels,
    read(channel, cell) {
      if (channel === "water" && !channels.water) return 0;
      const value = channels[channel];
      return value ? value(column(cell), row(cell)) : NaN;
    },
    places,
  };
}
/** The cell at a column and row of a grid map. */
export const cellAt = (width: number, column: number, row: number) => row * width + column;
/** A cone of the given height over a base, peaking at (c, r) and falling to zero at `radius` cells. */
export const cone =
  (c: number, r: number, rise: number, radius: number) => (column: number, row: number) =>
    rise * Math.max(0, 1 - Math.hypot(column - c, row - r) / radius);
