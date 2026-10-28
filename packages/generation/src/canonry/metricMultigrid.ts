import { metricArray, metricProduct, releaseMetric, type MetricOperator } from "./metricOperator";
import { CellList, type Band } from "@atlas/domain";
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
  const n = matrix.count,
    groups = metricArray(matrix.map, "groups", n, "int32").fill(-1);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (groups.get(i) >= 0) continue;
    groups.set(i, count);
    const end = matrix.offsets.get(i + 1);
    for (let at = matrix.offsets.get(i); at < end; at++) {
      const j = matrix.neighbors.get(at);
      if (groups.get(j) < 0) groups.set(j, count);
    }
    count++;
  }
  return { groups, count };
}
/** Fine rows of each aggregate as linked lists, and a scatter row over the aggregates. */
interface Gather {
  heads: Band;
  next: Band;
  mark: Band;
  value: Band;
  columns: CellList;
}
/** Accumulate aggregate `a`'s off-diagonal weights per neighbouring aggregate, scattering into
 * `row.value` and listing the touched columns in first-touch order; returns the aggregate area. */
function coarseRow(matrix: MetricOperator, groups: Band, a: number, row: Gather) {
  let area = 0;
  row.columns.clear();
  for (let i = row.heads.get(a); i >= 0; i = row.next.get(i)) {
    area += matrix.areas.get(i);
    const end = matrix.offsets.get(i + 1);
    for (let at = matrix.offsets.get(i); at < end; at++) {
      const b = groups.get(matrix.neighbors.get(at));
      if (a === b) continue;
      if (row.mark.get(b) !== a) {
        row.mark.set(b, a);
        row.value.set(b, 0);
        row.columns.push(b);
      }
      row.value.add(b, matrix.weights.get(at));
    }
  }
  return area;
}
function gather(matrix: MetricOperator, groups: Band, count: number): Gather {
  const map = matrix.map,
    n = groups.length,
    heads = metricArray(map, "coarse-heads", count, "int32").fill(-1),
    next = metricArray(map, "coarse-next", n, "int32");
  for (let i = n - 1; i >= 0; i--) {
    const group = groups.get(i);
    next.set(i, heads.get(group));
    heads.set(group, i);
  }
  return {
    heads,
    next,
    mark: metricArray(map, "coarse-mark", count, "int32").fill(-1),
    value: metricArray(map, "coarse-value", count),
    columns: new CellList(),
  };
}
/** Galerkin P' A P for piecewise-constant connected aggregates. */
function coarseOperator(matrix: MetricOperator, groups: Band, count: number): MetricOperator {
  const map = matrix.map,
    row = gather(matrix, groups, count),
    offsets = metricArray(map, "coarse-offsets", count + 1, "int32");
  // Count each row's columns first so the face arrays are allocated at their exact length.
  let faces = 0;
  for (let a = 0; a < count; a++) {
    offsets.set(a, faces);
    coarseRow(matrix, groups, a, row);
    faces += row.columns.length;
  }
  offsets.set(count, faces);
  row.mark.fill(-1);
  const areas = metricArray(map, "coarse-area", count),
    diagonal = metricArray(map, "coarse-diagonal", count),
    neighbors = metricArray(map, "coarse-neighbors", faces, "int32"),
    weights = metricArray(map, "coarse-weights", faces);
  for (let a = 0; a < count; a++) {
    const area = coarseRow(matrix, groups, a, row);
    let at = offsets.get(a),
      sum = area;
    areas.set(a, area);
    for (let k = 0; k < row.columns.length; k++) {
      const j = row.columns.at(k),
        weight = row.value.get(j);
      neighbors.set(at, j);
      weights.set(at++, weight);
      sum += weight;
    }
    diagonal.set(a, sum);
  }
  releaseWorking(map, row.heads, row.next, row.mark, row.value);
  return { map, count, areas, diagonal, offsets, neighbors, weights };
}
function factor(matrix: MetricOperator) {
  const n = matrix.count;
  if (!matrix.weights.length)
    return (rhs: Band, x: Band) => {
      for (let i = 0; i < n; i++) x.set(i, rhs.get(i) / matrix.diagonal.get(i));
    };
  // The coarsest level holds at most 32 rows; its dense factor is a fixed small block.
  const lower = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    lower[i * n + i] = matrix.diagonal.get(i);
    const end = matrix.offsets.get(i + 1);
    for (let at = matrix.offsets.get(i); at < end; at++)
      lower[i * n + matrix.neighbors.get(at)] = -matrix.weights.get(at);
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
  const n = matrix.count,
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
