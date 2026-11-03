import { CellList, content, halo, type Band } from "@atlas/domain";
import type { PhysicalMesh } from "../canonry/mesh";
import { meshDeltaX } from "../canonry/mesh";
import { prepareMetricSmoother } from "../canonry/metricSmoothing";
import { releaseWorking, workingValues } from "../canonry/physicalNumerics";
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
/**
 * Low-pass the content cells alone at standard deviation `sigma` (m) with the world's own
 * screened-diffusion smoother: nothing crosses the frame edge, each connected part keeps its
 * total, and the cost does not grow with the length. The screening length is σ/√2, which
 * gives the kernel the Gaussian's second moment. Halo cells keep their values. A smoother is
 * built once per length and reused until `releaseBlurs`.
 */
export function blurContent(state: RegionalState, values: Float64Array, sigma: number) {
  if (sigma <= 0) return;
  const map = state.physical.map,
    mesh = map.mesh,
    input = workingValues(map, "float64", "regional:blur-input", (i) => values[i]),
    smoothed = smootherFor(state, sigma / Math.SQRT2)(input);
  for (let i = 0; i < values.length; i++) if (isContent(mesh, i)) values[i] = smoothed.get(i);
  releaseWorking(map, input, smoothed);
}
type Smoother = ReturnType<typeof prepareMetricSmoother>;
const blurs = new WeakMap<RegionalState, { active: Band; lengths: Map<number, Smoother> }>();
function smootherFor(state: RegionalState, length: number) {
  const map = state.physical.map;
  let held = blurs.get(state);
  if (!held) {
    const active = workingValues(map, "uint8", "regional:blur-active", (i) =>
      Number(isContent(map.mesh, i))
    );
    held = { active, lengths: new Map() };
    blurs.set(state, held);
  }
  let smooth = held.lengths.get(length);
  if (!smooth) {
    smooth = prepareMetricSmoother(map, length, held.active);
    held.lengths.set(length, smooth);
  }
  return smooth;
}
/** Close the smoothers `blurContent` built; the next blur builds afresh. */
export function releaseBlurs(state: RegionalState) {
  const held = blurs.get(state);
  if (!held) return;
  for (const smooth of held.lengths.values()) smooth.close();
  releaseWorking(state.physical.map, held.active);
  blurs.delete(state);
}
/** Room for a cell's neighbourhood: the cells sharing a vertex with a triangle, three faces
 * and nine around its corners. */
export const neighborhoodCapacity = 12;
/**
 * The cells around a cell in twelve directions: every cell sharing a vertex with it, the
 * three face neighbours at one centroid spacing, six at √3 spacings and three opposite its
 * corners at two, so descent and travel are not ruled along the lattice's three axes. Never
 * a cell straight across a gap: every member touches the cell. Written into `out`; returns
 * how many there are.
 */
export function neighborhood(mesh: PhysicalMesh, i: number, out: Int32Array) {
  // The vertex ring lies within two centroid spacings; every member is reached through
  // members, so the walk never leaves the ring.
  const reach = 2 * mesh.spacing * (1 + 1e-6);
  let m = neighborsOf(mesh, i, out);
  for (let k = 0; k < m && m < out.length; k++)
    for (let edge = 0; edge < mesh.degree(out[k]); edge++) {
      const c = mesh.neighbor(out[k], edge);
      if (c < 0 || c === i || m >= out.length || distance(mesh, i, c) > reach) continue;
      if (!out.subarray(0, m).includes(c)) out[m++] = c;
    }
  return m;
}
