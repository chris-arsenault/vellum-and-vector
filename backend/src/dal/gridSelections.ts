import {
  createGrid,
  putChannel,
  requireThat,
  spatial,
  rectangle,
  type Bounds,
  type Grid,
  type SpatialScope,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { Sql } from "./database";
import { gridMetadata, readGridWindow, type GridWindow } from "./gridReader";

function axisWindow(
  min: number,
  max: number,
  start: number,
  step: number,
  size: number
): [number, number] {
  const lo = Math.max(0, Math.min(size - 2, Math.floor((min - start) / step))),
    hi = Math.min(size - 1, Math.max(lo + 1, Math.ceil((max - start) / step)));
  return [lo, hi];
}
function readableExtent(footprint: Geometry, dx: number, dy: number, haloCells: number) {
  if (haloCells === 0) return footprint;
  const core = spatial.bounds(footprint);
  return rectangle([
    core[0] - dx * haloCells,
    core[1] - dy * haloCells,
    core[2] + dx * haloCells,
    core[3] + dy * haloCells,
  ]);
}
export async function readGridSelection(
  sql: Sql,
  world: string,
  id: string,
  source: SpatialScope,
  footprint: Geometry,
  channels: string[],
  haloCells = 0
): Promise<Grid> {
  const metadata = await gridMetadata(sql, world, id);
  requireThat(
    source.worldId === world &&
      (metadata.space_id === null || source.spaceId === metadata.space_id) &&
      (metadata.crs_id === null || source.crsId === metadata.crs_id) &&
      (metadata.time_context === null || source.time === metadata.time_context),
    "grid_scope_mismatch",
    "The selected grid must match its declared world, space, CRS and time."
  );
  const [x0, y0, x1, y1] = metadata.bounds;
  const dx = (x1 - x0) / (metadata.width - 1),
    dy = (y1 - y0) / (metadata.height - 1);
  const readable = readableExtent(footprint, dx, dy, haloCells);
  const clipped = spatial.intersection(source.footprint, readable);
  requireThat(
    clipped && spatial.area(clipped) > 0,
    "outside_field",
    "The selected footprint has no numerical field coverage."
  );
  const bounds = spatial.bounds(clipped);
  const [a, b] = axisWindow(bounds[0], bounds[2], x0, dx, metadata.width),
    [c, d] = axisWindow(bounds[1], bounds[3], y0, dy, metadata.height);
  const window: GridWindow = { x: a, y: c, width: b - a + 1, height: d - c + 1 };
  const selected = await readGridWindow(sql, world, id, channels, window),
    sampleBounds: Bounds = [x0 + a * dx, y0 + c * dy, x0 + b * dx, y0 + d * dy];
  const result = createGrid(
    id,
    { ...source, footprint: clipped },
    window.width,
    window.height,
    sampleBounds
  );
  for (const name of channels)
    putChannel(result, name, selected.units[name], Float64Array.from(selected.channels[name]));
  return result;
}
