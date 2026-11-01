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
import type { RegionalCharacter } from "./character";
import type { CapturedCourse } from "./courses";
import type { Contributions } from "./media";

export interface RegionalInput {
  areaId: string;
  quality: string;
  seed: number;
  domains: string[];
}

/** A settlement's realized local situation: the site it took, or the terrace shaped for it. */
export interface Support {
  featureId: string;
  cell: number;
  kind: "site" | "terrace";
  /** Terrace level (m), footprint radius in cells and the fixed form; absent for a found site. */
  level?: number;
  radius?: number;
  footprint?: { cell: number; height: number }[];
}

/** A village proposed in round two, supported or rejected in round three. */
export interface ProposedPlace {
  cell: number;
  population: number;
  siteKind: string;
  siteReason: string;
  accepted: boolean;
}

/** Terrain working structures, initialized once and evolved through the rounds. */
export interface TerrainWork {
  base: Float64Array;
  sea: Uint8Array;
  inlet: Uint8Array;
  inflow: Float64Array;
  basin: Uint8Array;
  /** Total uplift intent (m) over the whole schedule. */
  uplift: Float64Array;
  /** Material organization of erodibility (grain bands, course imprint), before cover. */
  banding: Float64Array;
  /** Known summits with the cell they currently stand on. */
  peaks: { featureId: string; cell: number; prominence: number }[];
}

/** The drainage graph of the present surface: a working structure other processes read. */
export interface DrainageWork {
  receiver: Band;
  order: Band;
  count: number;
}

/**
 * Present geography only, plus the working structures of the coupled rounds. World physical
 * fields and historical execution state do not belong here.
 */
export interface RegionalState {
  domain: DomainSnapshot;
  surface: RegularGrid;
  input: RegionalInput;
  parentSpan: number;
  inheritedHeight: Band;
  features?: FeatureWorkspace;
  sourceFeatures?: FeatureReader;
  networks?: NetworkWorkspace;
  sourceNetworks?: NetworkReader;
  contours?: ContourWorkspace;
  /** Captured present media before this map's own development; shared channels derive from them. */
  natural: Record<string, Band>;
  /** Tracked changes the processes apply to shared media. */
  contributions: Contributions;
  /** The round being evaluated: 0 before the schedule, 1..3 inside it, 4 at the final refresh. */
  round: number;
  character?: RegionalCharacter;
  courses?: CapturedCourse[];
  terrain?: TerrainWork;
  /** Captured lake basins and river discharge entering across the frame edge (m³/s). */
  captured?: { basin: Band; inflow: Band };
  drainage?: DrainageWork;
  supports: Support[];
  proposed: ProposedPlace[];
  /** Site classes of the developed terrain, read in round two and kept for round three. */
  sites?: (import("../societySites").SiteOpportunity | null)[];
  /** Products of an earlier refinement of this map, removed before the schedule. */
  removedProducts?: Set<string>;
  magic?: import("./magic/index").MagicWork;
  /** Ice-carved hollows excavated in round one. */
  cirques?: number;
}

export function channel(state: RegionalState, name: string, unit: string, initial = 0) {
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

/**
 * The captured value of a present channel, copied the first time it is asked for, so a
 * process that derives the shared channel can start from the same place every round.
 */
export function naturalChannel(state: RegionalState, name: string, unit: string, initial = 0) {
  if (!state.natural[name])
    state.natural[name] = state.surface.coverage.copyBand(channel(state, name, unit, initial));
  return state.natural[name];
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

/** The grid cell under a canonical position, wrapped into a seam chart and clamped to the frame. */
export function cellAt(state: RegionalState, x: number, y: number) {
  const g = state.surface,
    width = g.periodicWidth;
  if (width && (x < g.bounds[0] || x > g.bounds[2]))
    x += Math.round(((g.bounds[0] + g.bounds[2]) / 2 - x) / width) * width;
  const col = Math.round(((x - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * (g.width - 1)),
    row = Math.round(((y - g.bounds[1]) / (g.bounds[3] - g.bounds[1])) * (g.height - 1));
  return (
    Math.max(0, Math.min(g.height - 1, row)) * g.width + Math.max(0, Math.min(g.width - 1, col))
  );
}

/** Whether a canonical position falls inside this map's chart. */
export function insideFrame(state: RegionalState, x: number, y: number) {
  const g = state.surface,
    width = g.periodicWidth;
  if (width && (x < g.bounds[0] || x > g.bounds[2]))
    x += Math.round(((g.bounds[0] + g.bounds[2]) / 2 - x) / width) * width;
  return x >= g.bounds[0] && x <= g.bounds[2] && y >= g.bounds[1] && y <= g.bounds[3];
}

export function onFrameEdge(grid: RegularGrid, i: number) {
  const x = i % grid.width,
    y = Math.floor(i / grid.width);
  return x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1;
}

export const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
