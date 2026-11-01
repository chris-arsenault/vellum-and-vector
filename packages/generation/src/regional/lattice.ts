import { CellList, content, halo } from "@atlas/domain";
import type { PhysicalMesh } from "../canonry/mesh";
import { meshDeltaX } from "../canonry/mesh";
import type { RegionalState } from "./state";

/** World position of a cell's centre. */
export function positionOf(mesh: PhysicalMesh, i: number) {
  return { x: mesh.origin[0] + mesh.x(i), y: mesh.origin[1] + mesh.y(i), z: 0 };
}
/** The cell under a world position; a position beyond the lattice takes its nearest edge cell. */
export function cellAt(mesh: PhysicalMesh, x: number, y: number) {
  const [w, s, e, n] = mesh.bounds,
    lx = Math.max(w, Math.min(e, mesh.deltaX(x - mesh.origin[0]))),
    ly = Math.max(s, Math.min(n, y - mesh.origin[1]));
  return mesh.cellAt(lx, ly);
}
/** The sample span of this map's own cells (m). */
export function regionalSpan(state: RegionalState) {
  return state.domain.scope.resolution ?? state.physical.map.mesh.spacing;
}
export const isContent = (mesh: PhysicalMesh, i: number) => mesh.membership(i) === content;
export const isHalo = (mesh: PhysicalMesh, i: number) => mesh.membership(i) === halo;

/** A content cell on the frame edge: it touches the inherited exterior or the lattice edge. */
export function frameEdge(mesh: PhysicalMesh, i: number) {
  if (!isContent(mesh, i)) return false;
  if (mesh.boundary(i)) return true;
  for (let edge = 0; edge < mesh.degree(i); edge++) {
    const j = mesh.neighbor(i, edge);
    if (j >= 0 && isHalo(mesh, j)) return true;
  }
  return false;
}
/** Neighbours of a cell written into `out`; returns how many there are. */
export function neighborsOf(mesh: PhysicalMesh, i: number, out: Int32Array) {
  let m = 0;
  for (let edge = 0; edge < mesh.degree(i); edge++) {
    const j = mesh.neighbor(i, edge);
    if (j >= 0) out[m++] = j;
  }
  return m;
}
export function* neighbors(mesh: PhysicalMesh, i: number) {
  for (let edge = 0; edge < mesh.degree(i); edge++) {
    const j = mesh.neighbor(i, edge);
    if (j >= 0) yield j;
  }
}
/** Centre-to-centre distance between two cells (m), across a periodic seam where there is one. */
export function distance(mesh: PhysicalMesh, i: number, j: number) {
  return Math.hypot(meshDeltaX(mesh, mesh.x(j) - mesh.x(i)), mesh.y(j) - mesh.y(i));
}
/** The step from i to j as a vector (m). */
export function stepVector(mesh: PhysicalMesh, i: number, j: number) {
  return { dx: meshDeltaX(mesh, mesh.x(j) - mesh.x(i)), dy: mesh.y(j) - mesh.y(i) };
}
export function forEachContent(mesh: PhysicalMesh, visit: (i: number) => void) {
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) visit(i);
}

/** Connected components of content cells that `includes` admits. */
export function components(
  mesh: PhysicalMesh,
  includes: (i: number) => boolean,
  visit: (members: Int32Array) => void
) {
  const seen = new Uint8Array(mesh.count),
    admits = (i: number) => !seen[i] && isContent(mesh, i) && includes(i);
  for (let start = 0; start < mesh.count; start++)
    if (admits(start)) visit(connected(mesh, start, admits, seen));
}
/** The connected cells `admits` allows from `start`, marking them seen. */
function connected(
  mesh: PhysicalMesh,
  start: number,
  admits: (i: number) => boolean,
  seen: Uint8Array
) {
  const cells = new CellList();
  cells.push(start);
  seen[start] = 1;
  for (let head = 0; head < cells.length; head++) {
    const i = cells.at(head);
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0 || !admits(j)) continue;
      seen[j] = 1;
      cells.push(j);
    }
  }
  return cells.finish();
}
/** ADR 0005's physical footprint rule: the component spans the resolution in both axes. */
export function resolvesComponent(
  mesh: PhysicalMesh,
  members: Int32Array,
  span: number,
  cells = 3
) {
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  for (const i of members) {
    west = Math.min(west, mesh.x(i));
    east = Math.max(east, mesh.x(i));
    south = Math.min(south, mesh.y(i));
    north = Math.max(north, mesh.y(i));
  }
  return east - west >= (cells - 1) * span && north - south >= (cells - 1) * span;
}

/**
 * Smooth a per-cell quantity to a Gaussian of standard deviation `sigma` (m) by explicit
 * finite-volume diffusion on the lattice: each pass moves half a cell's value to its face
 * neighbours in proportion to the face conductance, so the reach is in metres on any
 * lattice and the cost is linear in the cell count. The number of passes follows from the
 * variance a pass adds at this map's cell span.
 */
export function smoothOverLength(
  state: RegionalState,
  values: Float64Array,
  sigma: number,
  within?: Uint8Array
) {
  if (sigma <= 0) return;
  const { offsets, neighbors, weights, rate, step } = adjacency(state),
    passes = Math.min(1000, Math.max(1, Math.ceil((4 * sigma * sigma) / (step * step)))),
    n = values.length,
    previous = new Float64Array(n);
  for (let pass = 0; pass < passes; pass++) {
    previous.set(values);
    for (let i = 0; i < n; i++) {
      if (rate[i] <= 0 || (within && !within[i])) continue;
      let flux = 0;
      for (let at = offsets[i]; at < offsets[i + 1]; at++) {
        const j = neighbors[at];
        // Nothing crosses the mask's edge: the blur is of the marked cells alone.
        if (!within || within[j]) flux += weights[at] * (previous[j] - previous[i]);
      }
      values[i] = previous[i] + rate[i] * flux;
    }
  }
}
/** The frame's content cells as a mask. */
export function contentMask(state: RegionalState) {
  const mesh = state.physical.map.mesh,
    mask = new Uint8Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) mask[i] = Number(isContent(mesh, i));
  return mask;
}
/**
 * Compact adjacency with face conductances (face length over centre distance) and each
 * cell's diffusion rate for one pass, built once per run. A pass is explicit finite-volume
 * diffusion by one step of the finest cell (its time step over the cell's area), so a large
 * exterior cell changes slowly and a fine cell beside it is not swamped by a value whose
 * centre lies kilometres away: the smoothing is geometric, not a count of cells.
 */
export interface Adjacency {
  offsets: Int32Array;
  neighbors: Int32Array;
  weights: Float64Array;
  rate: Float64Array;
  step: number;
}
const adjacencies = new WeakMap<PhysicalMesh, Adjacency>();
export function adjacency(state: RegionalState): Adjacency {
  const mesh = state.physical.map.mesh,
    kept = adjacencies.get(mesh);
  if (kept) return kept;
  const n = mesh.count,
    offsets = new Int32Array(n + 1),
    total = new Float64Array(n);
  let slots = 0,
    step = Infinity;
  for (let i = 0; i < n; i++) {
    offsets[i] = slots;
    if (isContent(mesh, i)) step = Math.min(step, mesh.cellWidth(i), mesh.cellHeight(i));
    for (let edge = 0; edge < mesh.degree(i); edge++) if (mesh.neighbor(i, edge) >= 0) slots++;
  }
  offsets[n] = slots;
  const neighbors = new Int32Array(slots),
    weights = new Float64Array(slots),
    rate = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    total[i] = conductances(mesh, i, offsets[i], neighbors, weights);
    // Half the stable step on the finest cell; never past the stability limit on any cell.
    if (total[i] > 0) rate[i] = Math.min((step * step) / (8 * mesh.area(i)), 1 / total[i]);
  }
  const built = { offsets, neighbors, weights, rate, step };
  adjacencies.set(mesh, built);
  return built;
}
/** Write a cell's neighbours and face conductances from `at`; returns their total. */
function conductances(
  mesh: PhysicalMesh,
  i: number,
  at: number,
  neighbors: Int32Array,
  weights: Float64Array
) {
  let total = 0;
  for (let edge = 0; edge < mesh.degree(i); edge++) {
    const j = mesh.neighbor(i, edge);
    if (j < 0) continue;
    const length = mesh.edgeLength(i, edge),
      w = length > 0 ? mesh.faceLength(i, edge) / length : 0;
    neighbors[at] = j;
    weights[at] = w;
    total += w;
    at++;
  }
  return total;
}
/** Room for a cell's neighbourhood: faces, corners and knight's steps. */
export function neighborhoodCapacity(mesh: PhysicalMesh) {
  return mesh.stride * 5;
}
/**
 * The cells around a cell in sixteen directions: its face neighbours, the cells that share
 * only a corner with it (their boxes touch), and the cells a knight's step away (two cells
 * along one axis and one along the other), so descent and travel are not ruled along the
 * lattice's eight directions. Never a cell straight across a gap: the world's river paths
 * run between cells that touch or nearly touch, not over a cell between them. Written into
 * `out`; returns how many there are.
 */
export function neighborhood(mesh: PhysicalMesh, i: number, out: Int32Array) {
  const faces = neighborsOf(mesh, i, out);
  let m = faces;
  const add = (c: number) => {
    if (c < 0 || c === i || m >= out.length) return;
    for (let n = 0; n < m; n++) if (out[n] === c) return;
    out[m++] = c;
  };
  for (let k = 0; k < faces; k++)
    for (let edge = 0; edge < mesh.degree(out[k]); edge++) {
      const c = mesh.neighbor(out[k], edge);
      if (c >= 0 && touches(mesh, i, c)) add(c);
    }
  const ring = m;
  for (let k = 0; k < ring; k++)
    for (let edge = 0; edge < mesh.degree(out[k]); edge++) {
      const c = mesh.neighbor(out[k], edge);
      if (c >= 0 && knightsStep(mesh, i, c)) add(c);
    }
  return m;
}
/** Two cells two steps apart along one axis and one along the other, by their sizes. */
function knightsStep(mesh: PhysicalMesh, i: number, c: number) {
  const dx = Math.abs(mesh.x(c) - mesh.x(i)),
    dy = Math.abs(mesh.y(c) - mesh.y(i)),
    w = (mesh.cellWidth(i) + mesh.cellWidth(c)) / 2,
    h = (mesh.cellHeight(i) + mesh.cellHeight(c)) / 2,
    near = (d: number, s: number) => Math.abs(d - s) <= s * 0.25;
  return (near(dx, 2 * w) && near(dy, h)) || (near(dx, w) && near(dy, 2 * h));
}
/**
 * The frame's content cells as a dense grid (they are the lattice's finest leaves over the
 * frame, so their centres lie on one spacing): the cell at each column and row, or -1.
 */
interface ContentGrid {
  cols: number;
  rows: number;
  cells: Int32Array;
  stepX: number;
  stepY: number;
}
const contentGrids = new WeakMap<PhysicalMesh, ContentGrid>();
function contentGrid(state: RegionalState): ContentGrid {
  const mesh = state.physical.map.mesh,
    kept = contentGrids.get(mesh);
  if (kept) return kept;
  // The dense grid is at the finest content spacing on each axis (cells need not be square);
  // a coarser content cell (a frame refined unevenly) owns every fine position it covers.
  let stepX = Infinity,
    stepY = Infinity,
    west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    stepX = Math.min(stepX, mesh.cellWidth(i));
    stepY = Math.min(stepY, mesh.cellHeight(i));
    west = Math.min(west, mesh.x(i) - mesh.cellWidth(i) / 2);
    east = Math.max(east, mesh.x(i) + mesh.cellWidth(i) / 2);
    south = Math.min(south, mesh.y(i) - mesh.cellHeight(i) / 2);
    north = Math.max(north, mesh.y(i) + mesh.cellHeight(i) / 2);
  }
  const cols = Math.round((east - west) / stepX),
    rows = Math.round((north - south) / stepY),
    cells = new Int32Array(cols * rows).fill(-1);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const c0 = Math.round((mesh.x(i) - mesh.cellWidth(i) / 2 - west) / stepX),
      r0 = Math.round((mesh.y(i) - mesh.cellHeight(i) / 2 - south) / stepY),
      across = Math.max(1, Math.round(mesh.cellWidth(i) / stepX)),
      up = Math.max(1, Math.round(mesh.cellHeight(i) / stepY));
    for (let r = r0; r < r0 + up; r++)
      for (let c = c0; c < c0 + across; c++) cells[r * cols + c] = i;
  }
  const built = { cols, rows, cells, stepX, stepY };
  contentGrids.set(mesh, built);
  return built;
}
/**
 * Gaussian blur of the content cells alone, over the content grid, one axis at a time: the
 * blur of a frame-sized length in a few taps per cell instead of hundreds of diffusion
 * passes. Nothing crosses the frame edge; the weights renormalize over the cells present.
 */
export function blurContent(state: RegionalState, values: Float64Array, sigma: number) {
  if (sigma <= 0) return;
  const grid = contentGrid(state),
    dense = new Float64Array(grid.cols * grid.rows),
    present = new Uint8Array(grid.cols * grid.rows);
  for (let n = 0; n < grid.cells.length; n++) {
    const i = grid.cells[n];
    if (i < 0) continue;
    dense[n] = values[i];
    present[n] = 1;
  }
  blurAxis(dense, present, grid.cols, grid.rows, gaussianKernel(sigma, grid.stepX), 1);
  blurAxis(dense, present, grid.cols, grid.rows, gaussianKernel(sigma, grid.stepY), grid.cols);
  // A cell takes the mean over the positions it owns (one, for a finest cell).
  const sum = new Float64Array(values.length),
    owned = new Int32Array(values.length);
  for (let n = 0; n < grid.cells.length; n++) {
    const i = grid.cells[n];
    if (i < 0) continue;
    sum[i] += dense[n];
    owned[i]++;
  }
  for (let i = 0; i < values.length; i++) if (owned[i]) values[i] = sum[i] / owned[i];
}
/** Half a Gaussian kernel (centre tap first) at the axis's step, out to three sigma. */
function gaussianKernel(sigma: number, step: number) {
  const radius = Math.max(1, Math.ceil((3 * sigma) / step)),
    kernel = new Float64Array(radius + 1);
  for (let k = 0; k <= radius; k++) kernel[k] = Math.exp(-((k * step) ** 2) / (2 * sigma * sigma));
  return kernel;
}
/** One separable pass along the axis whose neighbouring index differs by `stride`. */
function blurAxis(
  dense: Float64Array,
  present: Uint8Array,
  cols: number,
  rows: number,
  kernel: Float64Array,
  stride: number
) {
  const length = stride === 1 ? cols : rows,
    lines = stride === 1 ? rows : cols,
    lineStride = stride === 1 ? cols : 1,
    out = new Float64Array(dense.length);
  for (let line = 0; line < lines; line++)
    for (let p = 0; p < length; p++) {
      const at = line * lineStride + p * stride;
      if (present[at]) out[at] = tap(dense, present, kernel, at, p, length, stride);
    }
  dense.set(out);
}
/** The renormalized kernel sum around position `p` of a line whose cell `at` is present. */
function tap(
  dense: Float64Array,
  present: Uint8Array,
  kernel: Float64Array,
  at: number,
  p: number,
  length: number,
  stride: number
) {
  const radius = kernel.length - 1,
    low = Math.max(-radius, -p),
    high = Math.min(radius, length - 1 - p);
  let sum = 0,
    weight = 0;
  for (let k = low; k <= high; k++) {
    const n = at + k * stride;
    if (!present[n]) continue;
    const w = kernel[Math.abs(k)];
    sum += w * dense[n];
    weight += w;
  }
  return weight > 0 ? sum / weight : dense[at];
}
/** Two cells whose boxes share at least a corner point. */
function touches(mesh: PhysicalMesh, i: number, c: number) {
  const slack = 1e-6;
  return (
    Math.abs(mesh.x(c) - mesh.x(i)) <=
      ((mesh.cellWidth(i) + mesh.cellWidth(c)) / 2) * (1 + slack) &&
    Math.abs(mesh.y(c) - mesh.y(i)) <= ((mesh.cellHeight(i) + mesh.cellHeight(c)) / 2) * (1 + slack)
  );
}
