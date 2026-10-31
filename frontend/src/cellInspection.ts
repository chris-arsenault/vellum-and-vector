import {
  adaptiveLeafAt,
  fieldPosition,
  gridCellBounds,
  gridPosition,
  spatial,
  type Bounds,
  type GridSurface,
  type Position,
} from "@atlas/domain";

export interface CellValue {
  channel: string;
  value: number;
  unit: string;
  quantity: string;
  fieldId: string;
  resourceId: string;
  input: boolean;
}
export interface InspectedCell {
  gridId: string;
  index: number;
  column: number | null;
  row: number | null;
  bounds: Bounds;
  center: Position;
  measure: number;
  active: boolean;
  values: CellValue[];
}
export interface CellInspection {
  areaId: string;
  position: Position;
  cells: InspectedCell[];
}

/** Read the owning stored sample; never interpolate its value or average a polygon. */
export function inspectStoredCell(
  grid: GridSurface,
  position: Position,
  channel: string
): InspectedCell | null {
  const p = fieldPosition(grid, position);
  if (!coveredCell(grid, p)) return null;
  for (const overlay of (grid.overlays ?? []).slice().reverse()) {
    if (!overlay.channels.includes(channel)) continue;
    const cell = inspectStoredCell(overlay.grid, p, channel);
    if (cell) return cell;
  }
  const index = storedIndex(grid, p);
  if (index < 0) return null;
  return {
    gridId: grid.id,
    index,
    column: grid.topology ? null : index % grid.width,
    row: grid.topology ? null : Math.floor(index / grid.width),
    bounds: gridCellBounds(grid, index),
    center: gridPosition(grid, index),
    measure: grid.measures.get(index),
    active: Boolean(grid.active.get(index)),
    values: [storedValue(grid, channel, index)],
  };
}

function coveredCell(grid: GridSurface, p: Position) {
  const covered = spatial.pointCoverage(grid.scope.footprint),
    width = grid.periodicWidth ?? 0;
  return [0, -width, width].some((shift) => covered({ ...p, x: p.x + shift }));
}

function storedValue(grid: GridSurface, channel: string, index: number): CellValue {
  return {
    channel,
    value: grid.channels[channel].get(index),
    unit: grid.units[channel],
    quantity: grid.quantities?.[channel] ?? "intensive",
    fieldId: "",
    resourceId: "",
    input: false,
  };
}

function storedIndex(grid: GridSurface, p: Position) {
  const [w, s, e, n] = grid.bounds;
  if (p.x < w || p.x > e || p.y < s || p.y > n) return -1;
  if (grid.topology) return adaptiveLeafAt(grid.topology, p.x, p.y);
  const column = Math.round(((p.x - w) / (e - w)) * (grid.width - 1)),
    row = Math.round(((p.y - s) / (n - s)) * (grid.height - 1));
  return row * grid.width + column;
}
