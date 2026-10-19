import type { AdaptiveTopology } from "./adaptiveTopology";

type Tree = Pick<AdaptiveTopology, "leaves" | "boxes">;
type Side = { cell: number; start: number; end: number };
type Line = { negative: Side[]; positive: Side[] };
type Link = { target: number; length: number; nx: number; ny: number };

function add(lines: Map<number, Line>, coordinate: number, positive: boolean, side: Side) {
  let line = lines.get(coordinate);
  if (!line) {
    line = { negative: [], positive: [] };
    lines.set(coordinate, line);
  }
  (positive ? line.positive : line.negative).push(side);
}
function connectLines(lines: Map<number, Line>, links: Link[][], vertical: boolean) {
  for (const line of lines.values()) {
    const a = line.negative.sort((p, q) => p.start - q.start);
    const b = line.positive.sort((p, q) => p.start - q.start);
    let i = 0,
      j = 0;
    while (i < a.length && j < b.length) {
      const length = Math.min(a[i].end, b[j].end) - Math.max(a[i].start, b[j].start);
      if (length > 0) {
        const nx = Number(vertical),
          ny = Number(!vertical);
        links[a[i].cell].push({ target: b[j].cell, length, nx, ny });
        links[b[j].cell].push({ target: a[i].cell, length, nx: -nx, ny: -ny });
      }
      const endA = a[i].end,
        endB = b[j].end;
      if (endA <= endB) i++;
      if (endB <= endA) j++;
    }
  }
}
function collectFaces(tree: Tree, links: Link[][]) {
  const vertical = new Map<number, Line>(),
    horizontal = new Map<number, Line>();
  for (let i = 0; i < tree.leaves.length; i++) {
    const at = tree.leaves[i] * 4;
    const [x0, y0, x1, y1] = tree.boxes.subarray(at, at + 4);
    add(vertical, x0, true, { cell: i, start: y0, end: y1 });
    add(vertical, x1, false, { cell: i, start: y0, end: y1 });
    add(horizontal, y0, true, { cell: i, start: x0, end: x1 });
    add(horizontal, y1, false, { cell: i, start: x0, end: x1 });
  }
  connectLines(vertical, links, true);
  connectLines(horizontal, links, false);
}
export function adaptiveFaces(tree: Tree) {
  const links: Link[][] = Array.from(tree.leaves, () => []);
  collectFaces(tree, links);
  const offsets = new Int32Array(links.length + 1);
  links.forEach((items, i) => {
    offsets[i + 1] = offsets[i] + items.length;
  });
  const count = offsets.at(-1)!;
  const neighbors = new Int32Array(count),
    faceLengths = new Float64Array(count);
  const distances = new Float64Array(count);
  const directionX = new Float64Array(count),
    directionY = new Float64Array(count);
  const normalX = new Int8Array(count),
    normalY = new Int8Array(count);
  for (let i = 0; i < links.length; i++) {
    const at = tree.leaves[i] * 4;
    for (const [edge, link] of links[i].entries()) {
      const to = tree.leaves[link.target] * 4,
        slot = offsets[i] + edge;
      const dx = (tree.boxes[to] + tree.boxes[to + 2] - tree.boxes[at] - tree.boxes[at + 2]) / 2;
      const dy =
        (tree.boxes[to + 1] + tree.boxes[to + 3] - tree.boxes[at + 1] - tree.boxes[at + 3]) / 2;
      neighbors[slot] = link.target;
      faceLengths[slot] = link.length;
      distances[slot] = Math.hypot(dx, dy);
      directionX[slot] = dx / distances[slot];
      directionY[slot] = dy / distances[slot];
      normalX[slot] = link.nx;
      normalY[slot] = link.ny;
    }
  }
  return { offsets, neighbors, faceLengths, distances, directionX, directionY, normalX, normalY };
}
