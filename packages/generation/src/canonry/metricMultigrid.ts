import { metricArray, metricProduct, releaseMetric, type MetricOperator } from "./metricOperator";
import { CellList, FloatList, type Band } from "@atlas/domain";
import { releaseWorking } from "./physicalNumerics";

type Level = {
  matrix: MetricOperator;
  x: Band;
  rhs: Band;
  scratch: Band;
  aggregate?: Band;
  coarse?: Level;
  exact?: (rhs: Band, x: Band) => void;
};
function aggregate(matrix: MetricOperator) {
  const n = matrix.cells.length,
    groups = metricArray(matrix.map, "groups", n, "int32").fill(-1);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (groups.get(i) >= 0) continue;
    groups.set(i, count);
    const end = matrix.offsets.get(i + 1);
    for (let at = matrix.offsets.get(i); at < end; at++) {
      const j = matrix.neighbors[at];
      if (groups.get(j) < 0) groups.set(j, count);
    }
    count++;
  }
  return { groups, count };
}
/** Accumulate aggregate `a`'s off-diagonal weights per neighbouring aggregate, scattering into
 * `row.value` and listing the touched columns in first-touch order; returns the aggregate area. */
function coarseRow(
  matrix: MetricOperator,
  groups: Band,
  heads: Int32Array,
  next: Int32Array,
  a: number,
  row: { mark: Int32Array; value: Float64Array; columns: CellList }
) {
  let area = 0;
  row.columns.clear();
  for (let i = heads[a]; i >= 0; i = next[i]) {
    area += matrix.areas.get(i);
    const end = matrix.offsets.get(i + 1);
    for (let at = matrix.offsets.get(i); at < end; at++) {
      const b = groups.get(matrix.neighbors[at]);
      if (a === b) continue;
      if (row.mark[b] !== a) {
        row.mark[b] = a;
        row.value[b] = 0;
        row.columns.push(b);
      }
      row.value[b] += matrix.weights[at];
    }
  }
  return area;
}
/** Galerkin P' A P for piecewise-constant connected aggregates. */
function coarseOperator(matrix: MetricOperator, groups: Band, count: number): MetricOperator {
  const map = matrix.map,
    n = groups.length,
    heads = new Int32Array(count).fill(-1),
    next = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const group = groups.get(i);
    next[i] = heads[group];
    heads[group] = i;
  }
  const areas = metricArray(map, "coarse-area", count),
    diagonal = metricArray(map, "coarse-diagonal", count),
    offsets = metricArray(map, "coarse-offsets", count + 1, "int32"),
    neighbors = new CellList(count * 3),
    weights = new FloatList(count * 3),
    row = {
      mark: new Int32Array(count).fill(-1),
      value: new Float64Array(count),
      columns: new CellList(),
    };
  for (let a = 0; a < count; a++) {
    const area = coarseRow(matrix, groups, heads, next, a, row);
    areas.set(a, area);
    offsets.set(a, neighbors.length);
    let sum = area;
    for (let k = 0; k < row.columns.length; k++) {
      const j = row.columns.at(k);
      neighbors.push(j);
      weights.push(row.value[j]);
      sum += row.value[j];
    }
    diagonal.set(a, sum);
  }
  offsets.set(count, neighbors.length);
  return {
    map,
    cells: new Int32Array(count),
    areas,
    diagonal,
    offsets,
    neighbors: neighbors.finish(),
    weights: weights.finish(),
  };
}
function factor(matrix: MetricOperator) {
  const n = matrix.cells.length;
  if (!matrix.weights.length)
    return (rhs: Band, x: Band) => {
      for (let i = 0; i < n; i++) x.set(i, rhs.get(i) / matrix.diagonal.get(i));
    };
  const lower = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    lower[i * n + i] = matrix.diagonal.get(i);
    const end = matrix.offsets.get(i + 1);
    for (let at = matrix.offsets.get(i); at < end; at++)
      lower[i * n + matrix.neighbors[at]] = -matrix.weights[at];
    for (let j = 0; j <= i; j++) {
      let value = lower[i * n + j];
      for (let k = 0; k < j; k++) value -= lower[i * n + k] * lower[j * n + k];
      lower[i * n + j] = i === j ? Math.sqrt(value) : value / lower[j * n + j];
    }
  }
  return (rhs: Band, x: Band) => triangularSolve(lower, rhs, x);
}
function triangularSolve(lower: Float64Array, rhs: Band, x: Band) {
  const n = rhs.length;
  for (let i = 0; i < n; i++) {
    let value = rhs.get(i);
    for (let j = 0; j < i; j++) value -= lower[i * n + j] * x.get(j);
    x.set(i, value / lower[i * n + i]);
  }
  for (let i = n - 1; i >= 0; i--) {
    let value = x.get(i);
    for (let j = i + 1; j < n; j++) value -= lower[j * n + i] * x.get(j);
    x.set(i, value / lower[i * n + i]);
  }
}
function hierarchy(matrix: MetricOperator): Level {
  const n = matrix.cells.length,
    map = matrix.map;
  const level: Level = {
    matrix,
    x: metricArray(map, "solution", n),
    rhs: metricArray(map, "rhs", n),
    scratch: metricArray(map, "scratch", n),
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
      level.x.add(
        i,
        ((2 / 3) * (level.rhs.get(i) - level.scratch.get(i))) / level.matrix.diagonal.get(i)
      );
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
  for (let i = 0; i < groups.length; i++)
    coarse.rhs.add(groups.get(i), level.rhs.get(i) - level.scratch.get(i));
  cycle(coarse);
  for (let i = 0; i < groups.length; i++) level.x.add(i, coarse.x.get(groups.get(i)));
  smooth(level);
}
/** A symmetric aggregation V-cycle conditions CG; the fine physical equation is unchanged. */
export function prepareMultigrid(matrix: MetricOperator) {
  const root = hierarchy(matrix);
  const apply = (residual: Band) => {
    root.rhs.copyFrom(residual);
    cycle(root);
    return root.x;
  };
  return Object.assign(apply, { close: () => closeLevel(root) });
}
function closeLevel(level: Level) {
  releaseWorking(
    level.matrix.map,
    level.x,
    level.rhs,
    level.scratch,
    ...(level.aggregate ? [level.aggregate] : [])
  );
  if (level.coarse) {
    closeLevel(level.coarse);
    releaseMetric(level.coarse.matrix);
  }
}
