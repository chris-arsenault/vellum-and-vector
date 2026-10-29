import type { Geometry, Polygon } from "geojson";
import {
  polygonParts,
  requireThat,
  type Bounds,
  type Position,
  type WorkspaceScope,
} from "@atlas/domain";
import { BoundaryTiles, type BoundaryGraph } from "./boundaryTiles";
import {
  boundarySegments,
  edgeKey,
  rayCrossing,
  segmentLine,
  type BoundarySegment,
} from "./boundarySegments";
import { leftOf, reverse, walkFace } from "./faceWalk";
import type { GeometryKernel } from "./geometryKernel";

/**
 * Where a face may be selected. `boundary` is linework the walk adds to the indexed sources;
 * closed exclusions (sibling regions) need none, since clipping the walked face by them gives
 * the face their linework would have bounded.
 */
export interface RegionMask {
  boundary: Geometry[];
  covers(position: Position): boolean;
  clip(shape: Geometry): Geometry | null;
}
/** A mask of one available shape whose whole boundary joins the walk. */
export function shapeMask(kernel: GeometryKernel, shape: Geometry, precision: number): RegionMask {
  return {
    boundary: [shape],
    covers: ({ x, y }) => kernel.relation(shape, point(x, y), precision, "covers"),
    clip: (face) => kernel.overlay(face, shape, precision, "intersection"),
  };
}
function point(x: number, y: number): Geometry {
  return { type: "Point", coordinates: [x, y] };
}
function coordinates(edges: BoundarySegment[], precision: number): Geometry {
  const unique = new Map(edges.map((s) => [edgeKey(s, precision), s]));
  return { type: "MultiLineString", coordinates: [...unique.values()].map(segmentLine) };
}
function midpoint(s: BoundarySegment) {
  return { x: (s.ax + s.bx) / 2, y: (s.ay + s.by) / 2 };
}
function onSegment(edge: BoundarySegment, x: number, y: number, precision: number) {
  const dx = edge.bx - edge.ax,
    dy = edge.by - edge.ay;
  const t = Math.max(
    0,
    Math.min(1, ((x - edge.ax) * dx + (y - edge.ay) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(x - edge.ax - t * dx, y - edge.ay - t * dy) <= precision * 2;
}
function clockwiseStart(graph: BoundaryGraph, raw: BoundarySegment) {
  const left = raw.ax < raw.bx ? { x: raw.ax, y: raw.ay } : { x: raw.bx, y: raw.by };
  return graph
    .outgoing(left.x, left.y)
    .sort((a, b) => Math.atan2(b.by - b.ay, b.bx - b.ax) - Math.atan2(a.by - a.ay, a.bx - a.ax))[0];
}
function unvisited(
  graph: BoundaryGraph,
  raw: BoundarySegment,
  visited: Set<string>,
  precision: number
) {
  const p = midpoint(raw);
  const edge = graph.at(p.x, p.y).find((s) => onSegment(s, p.x, p.y, precision));
  return edge && !visited.has(edgeKey(edge, precision));
}
function* seamProbes(shape: Geometry, bounds: Bounds, precision: number) {
  const offset = precision * 8;
  for (const edge of boundarySegments(shape)) {
    if (Math.abs(edge.ax - edge.bx) > precision || edge.ay === edge.by) continue;
    const left = Math.abs(edge.ax - bounds[0]) <= precision;
    const right = Math.abs(edge.ax - bounds[2]) <= precision;
    if (!left && !right) continue;
    yield { x: left ? bounds[2] - offset : bounds[0] + offset, y: (edge.ay + edge.by) / 2, z: 0 };
  }
}
/** A selected face is traced; unrelated faces are not constructed or polygonized. */
export class RegionFaces {
  constructor(private tiles: BoundaryTiles) {}
  private start(scope: WorkspaceScope, graph: BoundaryGraph, x: number, y: number) {
    const source = this.tiles.nearest(scope, x, y);
    const hits = [...graph.dynamic, ...(source ? [source] : [])].flatMap((s) => {
      const hit = rayCrossing(s, x, y);
      return hit === null ? [] : [hit];
    });
    if (!hits.length) return null;
    const near = hits.reduce((a, b) => Math.min(a, b), Infinity);
    return (
      graph
        .at(near, y)
        .flatMap((s) => {
          const hit = rayCrossing(s, x, y);
          return hit === null ? [] : [{ edge: s, hit }];
        })
        .sort((a, b) => a.hit - b.hit)[0]?.edge ?? null
    );
  }
  at(
    scope: WorkspaceScope,
    mask: RegionMask,
    cuts: Geometry[],
    position: Position,
    precision: number,
    periodicBounds: Bounds | null = null
  ): Geometry | null {
    const first = this.planarAt(scope, mask, cuts, position, precision);
    if (!first || !periodicBounds) return first;
    const visited = new Set<string>(),
      queue: Geometry[] = [first];
    let result = first;
    for (const shape of queue) {
      const key = JSON.stringify(this.tiles.kernel.canonical(shape, precision));
      if (visited.has(key)) continue;
      visited.add(key);
      for (const probe of seamProbes(shape, periodicBounds, precision)) {
        const neighbor = this.planarAt(scope, mask, cuts, probe, precision);
        if (!neighbor) continue;
        const nextKey = JSON.stringify(this.tiles.kernel.canonical(neighbor, precision));
        if (visited.has(nextKey)) continue;
        queue.push(neighbor);
        result = this.tiles.kernel.overlay(result, neighbor, precision, "union")!;
      }
    }
    return result;
  }
  private planarAt(
    scope: WorkspaceScope,
    mask: RegionMask,
    cuts: Geometry[],
    position: Position,
    precision: number
  ) {
    if (!mask.covers(position)) return null;
    const graph = this.tiles.graph(scope, [...mask.boundary, ...cuts], precision),
      kernel = this.tiles.kernel;
    const probe = point(position.x, position.y);
    let cursor = position.x,
      outer: Polygon | null = null;
    const visited = new Set<string>();
    const encounteredHoles: Polygon[] = [];
    for (;;) {
      const start = this.start(scope, graph, cursor, position.y);
      if (!start) return null;
      const oriented = leftOf(start, position.x, position.y) >= 0 ? start : reverse(start);
      const walk = walkFace(graph, oriented, precision);
      for (const key of walk.keys) visited.add(key);
      if (walk.signedArea > 0) {
        const candidates = polygonParts(
          kernel.polygonize(coordinates(walk.edges, precision), precision)
        );
        outer =
          candidates.find((shape) => kernel.relation(shape, probe, precision, "covers")) ?? null;
        if (outer) break;
      }
      if (walk.signedArea < 0)
        encounteredHoles.push(
          ...polygonParts(kernel.polygonize(coordinates(walk.edges, precision), precision))
        );
      const next =
        walk.edges.reduce((maximum, s) => Math.max(maximum, s.ax, s.bx), -Infinity) + precision * 2;
      requireThat(
        next > cursor,
        "boundary_progress",
        "Boundary query could not advance to an enclosing edge."
      );
      cursor = next;
    }
    const holes = this.holes(scope, graph, outer, visited, precision, encounteredHoles);
    const shape: Polygon = {
      type: "Polygon",
      coordinates: [...outer.coordinates, ...holes.map((p) => p.coordinates[0])],
    };
    return this.select(mask, shape, probe, precision);
  }
  /** Exclusions without linework can split the face; the selection is the piece at the probe. */
  private select(mask: RegionMask, face: Geometry, probe: Geometry, precision: number) {
    const clipped = mask.clip(face);
    if (!clipped) return null;
    const parts = polygonParts(clipped);
    return parts.length === 1
      ? clipped
      : (parts.find((part) => this.tiles.kernel.relation(part, probe, precision, "covers")) ??
          null);
  }
  private *candidates(scope: WorkspaceScope, graph: BoundaryGraph, bounds: Bounds) {
    const local = graph.dynamic.slice().sort((a, b) => Math.min(a.ax, a.bx) - Math.min(b.ax, b.bx));
    let at = 0;
    for (const s of this.tiles.inside(scope, bounds)) {
      while (at < local.length && Math.min(local[at].ax, local[at].bx) <= Math.min(s.ax, s.bx))
        yield local[at++];
      yield s;
    }
    while (at < local.length) yield local[at++];
  }
  private holes(
    scope: WorkspaceScope,
    graph: BoundaryGraph,
    outer: Polygon,
    visited: Set<string>,
    precision: number,
    initial: Polygon[]
  ) {
    const kernel = this.tiles.kernel,
      holes: Polygon[] = [...initial];
    const bounds = kernel.encode(outer, precision).bounds;
    const outerTest = kernel.preparePoints(outer, precision, "contains");
    const holeTests = holes.map((shape) => kernel.preparePoints(shape, precision, "covers"));
    try {
      for (const raw of this.candidates(scope, graph, bounds)) {
        const p = midpoint(raw);
        if (!outerTest.test(p.x, p.y) || holeTests.some((test) => test.test(p.x, p.y))) continue;
        if (!unvisited(graph, raw, visited, precision)) continue;
        const start = clockwiseStart(graph, raw);
        if (!start) continue;
        const walk = walkFace(graph, start, precision);
        for (const key of walk.keys) visited.add(key);
        if (walk.signedArea < 0)
          for (const shape of polygonParts(
            kernel.polygonize(coordinates(walk.edges, precision), precision)
          )) {
            holes.push(shape);
            holeTests.push(kernel.preparePoints(shape, precision, "covers"));
          }
      }
      return holes;
    } finally {
      outerTest.close();
      for (const test of holeTests) test.close();
    }
  }
}
