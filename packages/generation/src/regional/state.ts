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

/** A settlement's broad situation, read from the captured geography at its position. */
export type Situation = "coast" | "river" | "lake" | "inland";

/**
 * An established place that takes part in the processes: its footprint caps hillslope
 * relief so a usable site develops around it, and a river seat draws a channel to itself.
 * The cell follows the seat when the developed ground moves it.
 */
export interface Seat {
  featureId: string;
  cell: number;
  situation: Situation;
  /** Footprint radius in cells and the hillslope gradient its ground is held to. */
  radius: number;
  gradient: number;
  /** An established seat has substantial influence; a proposed village only a local one. */
  strength: "established" | "proposed";
}

/** A village proposed in round two, supported or rejected in round three. */
export interface ProposedPlace {
  cell: number;
  population: number;
  siteKind: string;
  siteReason: string;
  accepted: boolean;
}

/**
 * The established geography this map develops from: evidence with identity and situation,
 * whose coordinates and surroundings develop (spec 5.3).
 */
export interface Evidence {
  courses: CapturedCourse[];
  /** Captured standing water: its cells and surface level. */
  lakes: { cells: Int32Array; level: number }[];
  /** Inherited significant summits, read from their captured positions. */
  summits: { featureId: string; cell: number; prominence: number }[];
  seats: Seat[];
  /** Captured rivers entering across the frame edge, with the discharge they bring (m³/s). */
  entries: { cell: number; discharge: number }[];
}

/**
 * The drainage network grown once in round one: a tree over the land cells rooted at the
 * established waters. Every later structure (relief, ice, places, ways) is derived from it.
 */
export interface NetworkWork {
  /** Downstream cell per land cell, -1 at a root or in the sea. */
  receiver: Int32Array;
  /** Cells in order of increasing travel cost from the roots: roots first, heads last. */
  order: Int32Array;
  count: number;
  /** Geodesic cost from the roots: the potential the network descends. */
  cost: Float64Array;
  /** Upstream area (m²) including the country an entering river drains beyond the frame. */
  area: Float64Array;
  /** Reference discharge (m³/s) gathered down the tree, for channel qualification. */
  flow: Float64Array;
  /** Discharge entering across the frame edge at this cell (m³/s). */
  inflow: Float64Array;
  /** Whether the cell carries a channel at this map's scale. */
  channel: Uint8Array;
  /** Water surface level each cell's tributaries rise from (datum, edge base, lake level). */
  level: Float64Array;
  /** Connected sea on the captured base. */
  sea: Uint8Array;
  /** The smoothed captured base: the macro character the developed relief is calibrated to. */
  base: Float64Array;
  /** Captured lake index per cell, or -1. */
  lake: Int32Array;
  /** Closed depressions the parent holds (desert basins, pans) kept as sinks. */
  sink: Uint8Array;
}

/** Relief derived from the network in the latest round, with the fields the derivation produced. */
export interface ReliefWork {
  /** Local amplification of the network's increments that fits the captured macro relief. */
  amplification: Float64Array;
  /** Cells allowed to lie below their receiver: lakes, sinks, ice-carved hollows. */
  basin: Uint8Array;
  /** Ice flux (reference units) that carved the surface, present or relict. */
  iceFlux: Float64Array;
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
  evidence?: Evidence;
  /** The captured courses, kept where the extraction reads them. */
  courses?: CapturedCourse[];
  network?: NetworkWork;
  relief?: ReliefWork;
  drainage?: DrainageWork;
  proposed: ProposedPlace[];
  /** Site classes of the developed terrain, read in round two and kept for round three. */
  sites?: (import("../societySites").SiteOpportunity | null)[];
  /** Products of an earlier refinement of this map, removed before the schedule. */
  removedProducts?: Set<string>;
  magic?: import("./magic/index").MagicWork;
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

/** The eight neighbours written into `out`; returns how many there are. */
export function gridNeighbors(width: number, height: number, i: number, out: Int32Array) {
  const x = i % width,
    y = Math.floor(i / width);
  let m = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      out[m++] = i + dy * width + dx;
    }
  return m;
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

/** Separable Gaussian blur in place, with the kernel renormalized at the frame edges. */
export function gaussianBlur(
  values: Float64Array,
  width: number,
  height: number,
  sx: number,
  sy: number
) {
  const pass = (sigma: number, length: number, stride: number, lines: number, step: number) => {
    if (sigma < 0.5) return;
    const radius = Math.ceil(sigma * 3),
      kernel = Float64Array.from({ length: radius * 2 + 1 }, (_, k) =>
        Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma))
      ),
      line = new Float64Array(length);
    for (let l = 0; l < lines; l++) {
      const start = l * step;
      for (let k = 0; k < length; k++) line[k] = values[start + k * stride];
      for (let k = 0; k < length; k++) {
        let sum = 0,
          weight = 0;
        for (let o = -radius; o <= radius; o++) {
          const at = k + o;
          if (at < 0 || at >= length) continue;
          sum += kernel[o + radius] * line[at];
          weight += kernel[o + radius];
        }
        values[start + k * stride] = sum / weight;
      }
    }
  };
  pass(sx, width, 1, height, width);
  pass(sy, height, width, width, 1);
}
