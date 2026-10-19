import { adaptiveCell, type AdaptiveTopology } from "./adaptiveTopology";
export type AdaptiveSamples = ArrayLike<number> | ((index: number) => number);
export const adaptiveSample = (values: AdaptiveSamples, i: number) =>
  typeof values === "function" ? values(i) : values[i];

function solve(matrix: number[][], rhs: number[]) {
  const rows = matrix.map((row, i) => [...row, rhs[i]]),
    n = rhs.length;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[pivot], rows[column]] = [rows[column], rows[pivot]];
    const diagonal = rows[column][column];
    for (let k = column; k <= n; k++) rows[column][k] /= diagonal;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let k = column; k <= n; k++) rows[row][k] -= factor * rows[column][k];
    }
  }
  return rows.map((row) => row[n]);
}
function coefficients(matrix: number[][], rhs: number[]) {
  return (
    solve(matrix, rhs) ?? [
      ...(solve(
        matrix.slice(0, 2).map((row) => row.slice(0, 2)),
        rhs.slice(0, 2)
      ) ?? [0, 0]),
      0,
      0,
      0,
    ]
  );
}
/** Local curvature is needed to reconstruct smooth terrain without cell-centre humps. */
export function adaptiveFits(t: AdaptiveTopology, values: AdaptiveSamples) {
  const cache = new Map<number, number[]>();
  return (i: number) => {
    const previous = cache.get(i);
    if (previous) return previous;
    const box = adaptiveCell(t, i),
      width = box[2] - box[0],
      height = box[3] - box[1];
    const cells = new Set<number>([i]);
    for (let ring = 0; ring < 2; ring++)
      for (const cell of [...cells])
        for (let at = t.offsets[cell]; at < t.offsets[cell + 1]; at++) cells.add(t.neighbors[at]);
    const matrix = Array.from({ length: 5 }, () => new Array<number>(5).fill(0)),
      rhs = new Array<number>(5).fill(0);
    for (const j of cells) {
      if (j === i) continue;
      const other = adaptiveCell(t, j);
      const x = (other[0] + other[2] - box[0] - box[2]) / 2 / width,
        y = (other[1] + other[3] - box[1] - box[3]) / 2 / height;
      const row = [x, y, x * x, x * y, y * y],
        w = 1 / (x * x + y * y),
        delta = adaptiveSample(values, j) - adaptiveSample(values, i);
      for (let a = 0; a < 5; a++) {
        rhs[a] += w * row[a] * delta;
        for (let b = 0; b < 5; b++) matrix[a][b] += w * row[a] * row[b];
      }
    }
    const fitted = coefficients(matrix, rhs);
    const result = [
      fitted[0] / width,
      fitted[1] / height,
      fitted[2] / width ** 2,
      fitted[3] / (width * height),
      fitted[4] / height ** 2,
    ];
    cache.set(i, result);
    return result;
  };
}
