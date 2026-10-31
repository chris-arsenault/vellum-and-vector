import type { Band, Grid } from "@atlas/domain";

/** Height above the highest joining col on a path to higher ground. */
export function topographicProminence(
  coverage: Grid["coverage"],
  elevation: Band,
  adjacent: (cell: number) => Iterable<number>,
  datum: number
) {
  const count = elevation.length,
    parent = coverage.scratch("int32", "prominence:parent", count).fill(-1),
    summit = coverage.scratch("int32", "prominence:summit", count),
    rise = coverage.scratch("float64", "prominence:rise", count),
    saddle = coverage.scratch("int32", "prominence:saddle", count).fill(-1),
    above = (a: number, b: number) =>
      elevation.get(a) > elevation.get(b) || (elevation.get(a) === elevation.get(b) && a < b);
  const root = (i: number) => {
    let r = i;
    while (parent.get(r) !== r) r = parent.get(r);
    for (let next = parent.get(i); i !== r; i = next, next = parent.get(i)) parent.set(i, r);
    return r;
  };
  const join = (cell: number, j: number) => {
    const [a, b] = [root(cell), root(j)];
    if (a === b) return;
    const [high, low] = above(summit.get(a), summit.get(b)) ? [a, b] : [b, a],
      peak = summit.get(low);
    rise.set(peak, elevation.get(peak) - elevation.get(cell));
    saddle.set(peak, cell);
    parent.set(low, high);
  };
  for (const cell of coverage.order(elevation, true)) {
    if (elevation.get(cell) <= datum) break;
    parent.set(cell, cell);
    summit.set(cell, cell);
    for (const j of adjacent(cell)) if (parent.get(j) >= 0) join(cell, j);
  }
  for (let cell = 0; cell < count; cell++)
    if (parent.get(cell) === cell)
      rise.set(summit.get(cell), elevation.get(summit.get(cell)) - datum);
  coverage.release(parent);
  coverage.release(summit);
  return { rise, saddle };
}
