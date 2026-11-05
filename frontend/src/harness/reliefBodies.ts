/**
 * Connected bodies of one rock: what a cell's rock actually forms on the map. A typical cell's body
 * is weighted by cells, because the plain average is swamped by lone cells. Long bodies running with
 * the belts are what banding looks like, which is why shape is read as well as size.
 */

/** The ground bodies are found on, for any map that can say which cells touch. */
export interface BodyGround {
  count: number;
  cellKm2: number;
  included(i: number): boolean;
  around(i: number): readonly number[];
  x(i: number): number;
  y(i: number): number;
  deltaX(difference: number): number;
  /** The way the belt runs at a cell, if it has one. */
  strike?(i: number): number[] | null;
}
/** Smaller bodies have too few cells for their shape to mean anything. */
const shapedFrom = 10;
const smallBelow = 5,
  largeFrom = 20;
/** How many of a body's cells need a belt before its direction against the belt is read. */
const beltCellsFrom = 5;
const fixed = (value: number, places: number) => Number(value.toFixed(places));

function collectBodies(ground: BodyGround, label: (i: number) => number | string) {
  const seen = new Uint8Array(ground.count),
    bodies: number[][] = [];
  for (let start = 0; start < ground.count; start++) {
    if (seen[start] || !ground.included(start)) continue;
    const rock = label(start),
      stack = [start],
      cells: number[] = [];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      for (const j of ground.around(i))
        if (!seen[j] && ground.included(j) && label(j) === rock) {
          seen[j] = 1;
          stack.push(j);
        }
    }
    bodies.push(cells);
  }
  return bodies;
}
/** A body's long axis and how much longer it is than it is wide. */
function bodyShape(ground: BodyGround, cells: readonly number[]) {
  const xs = cells.map((i) => ground.deltaX(ground.x(i) - ground.x(cells[0]))),
    ys = cells.map((i) => ground.y(i)),
    mx = xs.reduce((sum, v) => sum + v, 0) / cells.length,
    my = ys.reduce((sum, v) => sum + v, 0) / cells.length;
  let xx = 0,
    yy = 0,
    xy = 0;
  cells.forEach((_, n) => {
    xx += (xs[n] - mx) ** 2;
    yy += (ys[n] - my) ** 2;
    xy += (xs[n] - mx) * (ys[n] - my);
  });
  const spread = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
  return {
    elongation: Math.sqrt((xx + yy + spread) / Math.max(1, xx + yy - spread)),
    axis: 0.5 * Math.atan2(2 * xy, xx - yy),
  };
}
/** How closely a body's long axis runs with its belts: 1 runs with them, about 0.64 is chance. */
function withTheBelt(ground: BodyGround, cells: readonly number[], axis: number) {
  let total = 0,
    belted = 0;
  for (const i of cells) {
    const belt = ground.strike?.(i);
    if (!belt) continue;
    total += Math.abs(belt[0] * Math.cos(axis) + belt[1] * Math.sin(axis));
    belted++;
  }
  return belted >= beltCellsFrom ? total / belted : null;
}
/** Long bodies' shapes, each counted by its cells. */
function shapes(ground: BodyGround, bodies: readonly number[][]) {
  let elongation = 0,
    shaped = 0,
    alignment = 0,
    aligned = 0;
  for (const cells of bodies) {
    if (cells.length < shapedFrom) continue;
    const shape = bodyShape(ground, cells),
      belt = withTheBelt(ground, cells, shape.axis);
    elongation += shape.elongation * cells.length;
    shaped += cells.length;
    if (belt !== null) {
      alignment += belt * cells.length;
      aligned += cells.length;
    }
  }
  return {
    elongation: shaped ? fixed(elongation / shaped, 2) : null,
    withTheBelt: aligned ? fixed(alignment / aligned, 2) : null,
  };
}
export function rockBodies(ground: BodyGround, label: (i: number) => number | string) {
  const bodies = collectBodies(ground, label),
    sizes = bodies.map((cells) => cells.length),
    cells = sizes.reduce((sum, size) => sum + size, 0),
    typical = sizes.reduce((sum, size) => sum + size * size, 0) / Math.max(1, cells),
    share = (keep: (size: number) => boolean) =>
      fixed(sizes.filter(keep).reduce((sum, size) => sum + size, 0) / Math.max(1, cells), 3);
  return {
    bodies: sizes.length,
    typicalBodyCells: Math.round(typical),
    typicalBodyKm2: Math.round(typical * ground.cellKm2),
    largestCells: Math.max(0, ...sizes),
    lone: share((size) => size === 1),
    small: share((size) => size < smallBelow),
    large: share((size) => size >= largeFrom),
    ...shapes(ground, bodies),
  };
}
