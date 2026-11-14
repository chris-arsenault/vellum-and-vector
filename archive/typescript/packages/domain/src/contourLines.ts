import { spatial } from "./spatial";
import {
  MemoryContourEdges,
  type ContourEdges,
  type ContourEdge,
  type ContourPoint,
  type ContourWorkspace,
} from "./contourWorkspace";

const key = (point: ContourPoint) => point.join(":");
export function withContourEdges<T>(
  workspace: ContourWorkspace | undefined,
  work: (edges: ContourEdges) => T
): T {
  const edges = workspace?.open() ?? new MemoryContourEdges();
  try {
    return work(edges);
  } finally {
    edges.close();
  }
}
export function addContourEdge(edges: ContourEdges, a: ContourPoint, b: ContourPoint) {
  const rounded = (point: ContourPoint) =>
    point.map((value) => Math.round(value / spatial.precision) * spatial.precision) as ContourPoint;
  const first = rounded(a),
    last = rounded(b);
  if (key(first) !== key(last)) edges.add(first, last);
}
const contourLinePoints = 2048;
/** Split a connected walk into bounded lines; their shared endpoints preserve its topology. */
export function* contourLines(edges: ContourEdges): Generator<ContourPoint[]> {
  for (;;) {
    const first = edges.first();
    if (!first) return;
    yield* connectedLines(first, edges);
  }
}
function* connectedLines(start: ContourEdge, edges: ContourEdges): Generator<ContourPoint[]> {
  let line = [start.a],
    count = 1,
    edge = start;
  for (;;) {
    edges.consume(edge.id);
    line.push(edge.b);
    count++;
    if (key(edge.b) === key(start.a)) {
      if (count >= 4) yield line;
      return;
    }
    if (line.length === contourLinePoints) {
      yield line;
      line = [edge.b];
    }
    const next = edges.outgoing(edge.b);
    if (!next.length) throw new Error(`A field contour did not close at ${key(edge.b)}.`);
    next.sort((a, b) => turn(edge, b) - turn(edge, a));
    edge = next[0];
  }
}
function turn(incoming: ContourEdge, outgoing: ContourEdge) {
  const x = incoming.b[0] - incoming.a[0],
    y = incoming.b[1] - incoming.a[1];
  const u = outgoing.b[0] - outgoing.a[0],
    v = outgoing.b[1] - outgoing.a[1];
  return Math.atan2(x * v - y * u, x * u + y * v);
}
