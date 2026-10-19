import { metricProduct, type MetricOperator } from "./metricOperator";

type Level = {
  matrix: MetricOperator;
  x: Float64Array;
  rhs: Float64Array;
  scratch: Float64Array;
  aggregate?: Int32Array;
  coarse?: Level;
  exact?: (rhs: Float64Array, x: Float64Array) => void;
};
function aggregate(matrix: MetricOperator) {
  const groups = new Int32Array(matrix.areas.length).fill(-1);
  let count = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] >= 0) continue;
    groups[i] = count;
    for (let at = matrix.offsets[i]; at < matrix.offsets[i + 1]; at++) {
      const j = matrix.neighbors[at];
      if (groups[j] < 0) groups[j] = count;
    }
    count++;
  }
  return { groups, count };
}
/** Galerkin P' A P for piecewise-constant connected aggregates. */
function coarseOperator(matrix: MetricOperator, groups: Int32Array, count: number): MetricOperator {
  const rows = Array.from({ length: count }, () => new Map<number, number>());
  const areas = new Float64Array(count),
    offsets = new Int32Array(count + 1);
  for (let i = 0; i < groups.length; i++) {
    const a = groups[i];
    areas[a] += matrix.areas[i];
    for (let at = matrix.offsets[i]; at < matrix.offsets[i + 1]; at++) {
      const b = groups[matrix.neighbors[at]];
      if (a !== b) rows[a].set(b, (rows[a].get(b) ?? 0) + matrix.weights[at]);
    }
  }
  const neighbors: number[] = [],
    weights: number[] = [],
    diagonal = areas.slice();
  rows.forEach((row, i) => {
    offsets[i] = neighbors.length;
    for (const [j, value] of row) {
      neighbors.push(j);
      weights.push(value);
      diagonal[i] += value;
    }
  });
  offsets[count] = neighbors.length;
  return {
    cells: new Int32Array(count),
    areas,
    diagonal,
    offsets,
    neighbors: Int32Array.from(neighbors),
    weights: Float64Array.from(weights),
  };
}
function factor(matrix: MetricOperator) {
  const n = matrix.areas.length;
  if (!matrix.weights.length)
    return (rhs: Float64Array, x: Float64Array) => {
      for (let i = 0; i < n; i++) x[i] = rhs[i] / matrix.diagonal[i];
    };
  const lower = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    lower[i * n + i] = matrix.diagonal[i];
    for (let at = matrix.offsets[i]; at < matrix.offsets[i + 1]; at++)
      lower[i * n + matrix.neighbors[at]] = -matrix.weights[at];
    for (let j = 0; j <= i; j++) {
      let value = lower[i * n + j];
      for (let k = 0; k < j; k++) value -= lower[i * n + k] * lower[j * n + k];
      lower[i * n + j] = i === j ? Math.sqrt(value) : value / lower[j * n + j];
    }
  }
  return (rhs: Float64Array, x: Float64Array) => triangularSolve(lower, rhs, x);
}
function triangularSolve(lower: Float64Array, rhs: Float64Array, x: Float64Array) {
  const n = rhs.length;
  for (let i = 0; i < n; i++) {
    let value = rhs[i];
    for (let j = 0; j < i; j++) value -= lower[i * n + j] * x[j];
    x[i] = value / lower[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let value = x[i];
    for (let j = i + 1; j < n; j++) value -= lower[j * n + i] * x[j];
    x[i] = value / lower[i * n + i];
  }
}
function hierarchy(matrix: MetricOperator): Level {
  const n = matrix.areas.length;
  const level: Level = {
    matrix,
    x: new Float64Array(n),
    rhs: new Float64Array(n),
    scratch: new Float64Array(n),
  };
  // This is a numerical coarse-solve block size, not a cap on physical work or CG convergence.
  if (n <= 32 || !matrix.weights.length) level.exact = factor(matrix);
  else {
    const { groups, count } = aggregate(matrix);
    level.aggregate = groups;
    level.coarse = hierarchy(coarseOperator(matrix, groups, count));
  }
  return level;
}
function smooth(level: Level) {
  for (let sweep = 0; sweep < 2; sweep++) {
    metricProduct(level.matrix, level.x, level.scratch);
    for (let i = 0; i < level.x.length; i++)
      level.x[i] += ((2 / 3) * (level.rhs[i] - level.scratch[i])) / level.matrix.diagonal[i];
  }
}
function cycle(level: Level) {
  level.x.fill(0);
  if (level.exact) {
    level.exact(level.rhs, level.x);
    return;
  }
  smooth(level);
  metricProduct(level.matrix, level.x, level.scratch);
  const coarse = level.coarse!,
    groups = level.aggregate!;
  coarse.rhs.fill(0);
  for (let i = 0; i < groups.length; i++) coarse.rhs[groups[i]] += level.rhs[i] - level.scratch[i];
  cycle(coarse);
  for (let i = 0; i < groups.length; i++) level.x[i] += coarse.x[groups[i]];
  smooth(level);
}
/** A symmetric aggregation V-cycle conditions CG; the fine physical equation is unchanged. */
export function prepareMultigrid(matrix: MetricOperator) {
  const root = hierarchy(matrix);
  return (residual: Float64Array) => {
    root.rhs.set(residual);
    cycle(root);
    return root.x;
  };
}
