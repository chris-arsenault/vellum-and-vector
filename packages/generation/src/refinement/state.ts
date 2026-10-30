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
