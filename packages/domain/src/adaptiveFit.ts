import { adaptiveCell, type AdaptiveTopology } from "./adaptiveTopology";
import { ByteCache } from "./byteCache";

const adaptiveStencilCacheBytes = 4 * 1024 * 1024;
const adaptiveFitCacheBytes = 256 * 1024;
export type AdaptiveSamples = ArrayLike<number> | ((index: number) => number);
export const adaptiveSample = (values: AdaptiveSamples, i: number) =>
  typeof values === "function" ? values(i) : values[i];

function factor(matrix: number[][]) {
  const n = matrix.length,
    rows = matrix.map((row) => row.slice()),
    swaps = new Int8Array(n);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    swaps[column] = pivot;
    [rows[pivot], rows[column]] = [rows[column], rows[pivot]];
    const diagonal = rows[column][column];
    for (let row = column + 1; row < n; row++) {
      rows[row][column] /= diagonal;
      for (let k = column + 1; k < n; k++) rows[row][k] -= rows[row][column] * rows[column][k];
    }
  }
  return { rows, swaps };
}
function solve(prepared: ReturnType<typeof factor>, rhs: number[]) {
  if (!prepared) return new Array<number>(5).fill(0);
  const { rows, swaps } = prepared,
    n = rows.length;
  for (let i = 0; i < n; i++) [rhs[i], rhs[swaps[i]]] = [rhs[swaps[i]], rhs[i]];
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) rhs[i] -= rows[i][j] * rhs[j];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) rhs[i] -= rows[i][j] * rhs[j];
    rhs[i] /= rows[i][i];
  }
  for (let i = n; i < 5; i++) rhs[i] = 0;
  return rhs;
}
function prepareFits(t: AdaptiveTopology) {
  const cache = new ByteCache<number, ReturnType<typeof stencil>>(adaptiveStencilCacheBytes);
  function stencil(i: number) {
    const box = adaptiveCell(t, i),
      width = box[2] - box[0],
      height = box[3] - box[1];
    const cells = new Set<number>([i]);
    for (let ring = 0; ring < 2; ring++)
      for (const cell of [...cells])
        for (let at = t.offsets[cell]; at < t.offsets[cell + 1]; at++) cells.add(t.neighbors[at]);
    const matrix = Array.from({ length: 5 }, () => new Array<number>(5).fill(0)),
      neighbors = [...cells].filter((j) => j !== i),
      weights = new Float64Array(neighbors.length * 5);
    let at = 0;
    for (const j of neighbors) {
      const other = adaptiveCell(t, j);
      const x = (other[0] + other[2] - box[0] - box[2]) / 2 / width,
        y = (other[1] + other[3] - box[1] - box[3]) / 2 / height;
      const row = [x, y, x * x, x * y, y * y],
        w = 1 / (x * x + y * y);
      for (let a = 0; a < 5; a++) {
        weights[at++] = w * row[a];
        for (let b = 0; b < 5; b++) matrix[a][b] += w * row[a] * row[b];
      }
    }
    const prepared = factor(matrix) ?? factor(matrix.slice(0, 2).map((row) => row.slice(0, 2)));
    return { neighbors: Int32Array.from(neighbors), weights, prepared, width, height };
  }
  return (i: number) => {
    const previous = cache.get(i);
    if (previous) return previous;
    const result = stencil(i);
    cache.set(i, result, result.weights.byteLength + result.neighbors.byteLength + 1024);
    return result;
  };
}
// Geometry is immutable after assembly. A new refinement gets a new preparation;
// retaining a channel evaluator never retains any other channel's values.
const preparations = new WeakMap<AdaptiveTopology, ReturnType<typeof prepareFits>>();
/** Local curvature is needed to reconstruct smooth terrain without cell-centre humps. */
export function adaptiveFits(t: AdaptiveTopology, values: AdaptiveSamples) {
  if (!preparations.has(t)) preparations.set(t, prepareFits(t));
  const geometry = preparations.get(t)!,
    cache = new ByteCache<number, number[]>(adaptiveFitCacheBytes);
  return (i: number) => {
    const previous = cache.get(i);
    if (previous) return previous;
    const { neighbors, weights, prepared, width, height } = geometry(i),
      rhs = new Array<number>(5).fill(0),
      center = adaptiveSample(values, i);
    for (let j = 0; j < neighbors.length; j++) {
      const delta = adaptiveSample(values, neighbors[j]) - center;
      for (let a = 0; a < 5; a++) rhs[a] += weights[j * 5 + a] * delta;
    }
    const fitted = solve(prepared, rhs);
    const result = [
      fitted[0] / width,
      fitted[1] / height,
      fitted[2] / width ** 2,
      fitted[3] / (width * height),
      fitted[4] / height ** 2,
    ];
    cache.set(i, result, 128);
    return result;
  };
}
