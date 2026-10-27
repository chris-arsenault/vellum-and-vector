import { DomainError, requireThat } from "@atlas/domain";
import { edgeKey, pointKey, type BoundarySegment } from "./boundarySegments";
import type { BoundaryGraph } from "./boundaryTiles";

export function leftOf(edge: BoundarySegment, x: number, y: number) {
  return (edge.bx - edge.ax) * (y - edge.ay) - (edge.by - edge.ay) * (x - edge.ax);
}
export function reverse(edge: BoundarySegment): BoundarySegment {
  return { ax: edge.bx, ay: edge.by, bx: edge.ax, by: edge.ay };
}
function directedKey(s: BoundarySegment, precision: number) {
  return `${pointKey(s.ax, s.ay, precision)}>${pointKey(s.bx, s.by, precision)}`;
}
function nextEdge(graph: BoundaryGraph, current: BoundarySegment, precision: number) {
  const outgoing = graph.outgoing(current.bx, current.by);
  requireThat(
    outgoing.length,
    "boundary_connection",
    "Geographic boundary lost a connected endpoint."
  );
  if (outgoing.length === 1) return outgoing[0];
  const back = pointKey(current.ax, current.ay, precision);
  const angle = Math.atan2(current.ay - current.by, current.ax - current.bx);
  return outgoing
    .filter((s) => pointKey(s.bx, s.by, precision) !== back)
    .sort((a, b) => {
      const turn = (s: BoundarySegment) =>
        (angle - Math.atan2(s.by - s.ay, s.bx - s.ax) + Math.PI * 2) % (Math.PI * 2);
      return turn(a) - turn(b);
    })[0];
}
/** Follow the face on the left. Tile boundaries contribute connections, never enclosure. */
export function walkFace(graph: BoundaryGraph, start: BoundarySegment, precision: number) {
  const visited = new Set<string>(),
    edges: BoundarySegment[] = [];
  let current = start,
    signedArea = 0;
  for (;;) {
    const key = directedKey(current, precision);
    if (visited.has(key)) {
      if (key !== directedKey(start, precision))
        throw new DomainError("boundary_cycle", "Boundary traversal entered a different cycle.", {
          start,
          repeated: current,
          recent: edges.slice(-4),
          outgoing: graph.outgoing(current.ax, current.ay),
        });
      break;
    }
    visited.add(key);
    edges.push(current);
    // Translate around the first vertex to retain area precision far from the world origin.
    signedArea +=
      ((current.ax - start.ax) * (current.by - start.ay) -
        (current.bx - start.ax) * (current.ay - start.ay)) /
      2;
    current = nextEdge(graph, current, precision);
  }
  return { signedArea, edges, keys: new Set(edges.map((s) => edgeKey(s, precision))) };
}
