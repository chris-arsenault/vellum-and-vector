/** Alignment and equal-gap guides while a selection is dragged; view help only. */
export type Box = [number, number, number, number];
export interface Guide {
  axis: "x" | "y";
  /** The guide's position on its axis. */
  at: number;
  from: number;
  to: number;
}
export interface Snapped {
  dx: number;
  dy: number;
  guides: Guide[];
}
const lines = (box: Box, axis: 0 | 1) => [
  box[axis],
  (box[axis] + box[axis + 2]) / 2,
  box[axis + 2],
];

/** The nudge that lines the moving box's edges or centre up with another box, per axis. */
function alignAxis(moving: Box, others: Box[], axis: 0 | 1, tolerance: number) {
  let best: { shift: number; at: number; other: Box } | null = null;
  for (const other of others)
    for (const mine of lines(moving, axis))
      for (const theirs of lines(other, axis)) {
        const shift = theirs - mine;
        if (Math.abs(shift) <= tolerance && (!best || Math.abs(shift) < Math.abs(best.shift)))
          best = { shift, at: theirs, other };
      }
  return best;
}
/** The nudge that leaves equal gaps to the nearest boxes on either side along one axis. */
function equalGap(moving: Box, others: Box[], axis: 0 | 1, tolerance: number) {
  const across = axis === 0 ? 1 : 0;
  const overlaps = (other: Box) =>
    other[across] < moving[across + 2] && other[across + 2] > moving[across];
  const beside = others.filter(overlaps);
  const before = beside
    .filter((other) => other[axis + 2] <= moving[axis])
    .sort((a, b) => b[axis + 2] - a[axis + 2])[0];
  const after = beside
    .filter((other) => other[axis] >= moving[axis + 2])
    .sort((a, b) => a[axis] - b[axis])[0];
  if (!before || !after) return null;
  const gapBefore = moving[axis] - before[axis + 2];
  const gapAfter = after[axis] - moving[axis + 2];
  const shift = (gapAfter - gapBefore) / 2;
  return Math.abs(shift) <= tolerance ? { shift, before, after } : null;
}
function guideFor(axis: 0 | 1, at: number, a: Box, b: Box): Guide {
  const across = axis === 0 ? 1 : 0;
  return {
    axis: axis === 0 ? "x" : "y",
    at,
    from: Math.min(a[across], b[across]),
    to: Math.max(a[across + 2], b[across + 2]),
  };
}
function snapAxis(moving: Box, others: Box[], axis: 0 | 1, tolerance: number) {
  const aligned = alignAxis(moving, others, axis, tolerance);
  if (aligned)
    return { shift: aligned.shift, guides: [guideFor(axis, aligned.at, moving, aligned.other)] };
  const gap = equalGap(moving, others, axis, tolerance);
  if (!gap) return { shift: 0, guides: [] };
  const middle = (moving[axis] + moving[axis + 2]) / 2 + gap.shift;
  return { shift: gap.shift, guides: [guideFor(axis, middle, gap.before, gap.after)] };
}
/** Snap a dragged box to the boxes around it; `tolerance` is in map units. */
export function snapToGuides(moving: Box, others: Box[], tolerance: number): Snapped {
  const x = snapAxis(moving, others, 0, tolerance);
  const y = snapAxis(moving, others, 1, tolerance);
  return { dx: x.shift, dy: y.shift, guides: [...x.guides, ...y.guides] };
}
