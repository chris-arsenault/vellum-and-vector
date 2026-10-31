import type {
  Band,
  DomainSnapshot,
  RegularGrid,
  FeatureWorkspace,
  FeatureReader,
  NetworkWorkspace,
  NetworkReader,
  ContourWorkspace,
} from "@atlas/domain";
import { CellList, resolutionCells } from "@atlas/domain";

export interface RefinementInput {
  areaId: string;
  quality: string;
  seed: number;
  domains: string[];
}

/** Present geography only. World physical fields and historical execution state do not belong here. */
export interface RefinementState {
  domain: DomainSnapshot;
  surface: RegularGrid;
  input: RefinementInput;
  parentSpan: number;
  inheritedHeight: Band;
  features?: FeatureWorkspace;
  sourceFeatures?: FeatureReader;
  networks?: NetworkWorkspace;
  sourceNetworks?: NetworkReader;
  contours?: ContourWorkspace;
  drainage?: { receiver: Band; order: Band; count: number };
  terrain?: { basin: Band; relief: Band };
}

export function channel(state: RefinementState, name: string, unit: string, initial = 0) {
  const grid = state.surface;
  if (!grid.channels[name]) {
    const values = grid.coverage.scratch("float64", name, grid.active.length).fill(initial);
    values.retain();
    grid.channels[name] = values;
    grid.units[name] = unit;
    (grid.quantities ??= {})[name] = unit === "category" ? "category" : "intensive";
  }
  return grid.channels[name];
}

export function* neighbors(grid: RegularGrid, i: number) {
  const x = i % grid.width,
    y = Math.floor(i / grid.width);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= grid.width || y + dy < 0 || y + dy >= grid.height)
        continue;
      yield i + dy * grid.width + dx;
    }
}

/** Connected class components, matching place extraction on the initial mesh. */
export function regionalComponents(
  grid: RegularGrid,
  includes: (i: number) => boolean,
  visit: (members: Int32Array) => void
) {
  const seen = grid.coverage.scratch("uint8", "regional:component-seen", grid.active.length);
  for (let i = 0; i < seen.length; i++) {
    if (seen.get(i) || !grid.active.get(i) || !includes(i)) continue;
    const cells = new CellList();
    cells.push(i);
    seen.set(i, 1);
    for (let head = 0; head < cells.length; head++)
      for (const j of neighbors(grid, cells.at(head))) {
        if (seen.get(j) || !grid.active.get(j) || !includes(j)) continue;
        seen.set(j, 1);
        cells.push(j);
      }
    visit(cells.finish());
  }
  grid.coverage.release(seen);
}

/** ADR 0005's physical footprint rule on this map's regular mesh. */
export function resolvesRegionalComponent(grid: RegularGrid, members: Int32Array) {
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  for (const i of members) {
    const x = i % grid.width,
      y = Math.floor(i / grid.width);
    west = Math.min(west, x);
    east = Math.max(east, x);
    south = Math.min(south, y);
    north = Math.max(north, y);
  }
  return east - west + 1 >= resolutionCells && north - south + 1 >= resolutionCells;
}

export function spacing(grid: RegularGrid): [number, number] {
  return [
    (grid.bounds[2] - grid.bounds[0]) / (grid.width - 1),
    (grid.bounds[3] - grid.bounds[1]) / (grid.height - 1),
  ];
}

export function distance(grid: RegularGrid, i: number, j: number) {
  const [dx, dy] = spacing(grid);
  return Math.hypot(
    ((i % grid.width) - (j % grid.width)) * dx,
    (Math.floor(i / grid.width) - Math.floor(j / grid.width)) * dy
  );
}

export const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
