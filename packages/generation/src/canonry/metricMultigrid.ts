import { metricArray, metricProduct, releaseMetric, type MetricOperator } from "./metricOperator";
import { CellList, FloatList, type NumericalVector } from "@atlas/domain";

type Level = {
  matrix: MetricOperator;
  x: NumericalVector;
  rhs: NumericalVector;
  scratch: NumericalVector;
  aggregate?: NumericalVector;
  coarse?: Level;
  exact?: (rhs: NumericalVector, x: NumericalVector) => void;
};
function aggregate(matrix: MetricOperator) {
  const groups = metricArray("groups", matrix.areas.length, "int32", matrix.numerical).fill(-1);
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
function coarseOperator(
  matrix: MetricOperator,
  groups: NumericalVector,
  count: number
): MetricOperator {
  const numerical = matrix.numerical,
    heads = metricArray("heads", count, "int32", numerical).fill(-1),
    next = metricArray("next", groups.length, "int32", numerical);
  for (let i = groups.length - 1; i >= 0; i--) {
    next[i] = heads[groups[i]];
    heads[groups[i]] = i;
  }
  const areas = metricArray("coarse-area", count, "float64", numerical),
    diagonal = metricArray("coarse-diagonal", count, "float64", numerical),
    offsets = metricArray("coarse-offsets", count + 1, "int32", numerical),
    neighbors = new CellList(count * 3),
    weights = new FloatList(count * 3);
  for (let a = 0; a < count; a++) {
    const row = new Map<number, number>();
    for (let i = heads[a]; i >= 0; i = next[i]) {
      areas[a] += matrix.areas[i];
      for (let at = matrix.offsets[i]; at < matrix.offsets[i + 1]; at++) {
        const b = groups[matrix.neighbors[at]];
        if (a !== b) row.set(b, (row.get(b) ?? 0) + matrix.weights[at]);
      }
    }
    offsets[a] = neighbors.length;
    diagonal[a] = areas[a];
    for (const [j, value] of row) {
      neighbors.push(j);
      weights.push(value);
      diagonal[a] += value;
    }
  }
  offsets[count] = neighbors.length;
  numerical?.releaseUnused([heads, next], []);
  return {
    numerical,
    cells: metricArray("coarse-cells", count, "int32", numerical),
    areas,
    diagonal,
    offsets,
    neighbors: neighbors.finish(),
    weights: weights.finish(),
  };
}
function factor(matrix: MetricOperator) {
  const n = matrix.areas.length;
  if (!matrix.weights.length)
    return (rhs: NumericalVector, x: NumericalVector) => {
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
  return (rhs: NumericalVector, x: NumericalVector) => triangularSolve(lower, rhs, x);
}
function triangularSolve(lower: Float64Array, rhs: NumericalVector, x: NumericalVector) {
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
    x: metricArray("solution", n, "float64", matrix.numerical),
    rhs: metricArray("rhs", n, "float64", matrix.numerical),
    scratch: metricArray("scratch", n, "float64", matrix.numerical),
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
  const apply = (residual: NumericalVector) => {
    root.rhs.set(residual);
    cycle(root);
    return root.x;
  };
  return Object.assign(apply, { close: () => closeLevel(root) });
}
function closeLevel(level: Level) {
  level.matrix.numerical?.releaseUnused(
    [level.x, level.rhs, level.scratch, ...(level.aggregate ? [level.aggregate] : [])],
    []
  );
  if (level.coarse) {
    closeLevel(level.coarse);
    releaseMetric(level.coarse.matrix);
  }
}
