import { regionBoundaryLines, spatial } from "@atlas/domain";
import type { Geometry, Position } from "geojson";
import type { AtlasFeature, Raster } from "./types";
import { drawnOcean } from "./drawnWater";

export type DrawingGeography = ReadonlyMap<string, Geometry | null>;
const politicalLayers = new Set(["sovereignty", "control", "claims", "administration"]);
const cache = new WeakMap<AtlasFeature[], { base: Raster[]; shapes: DrawingGeography }>();
const noBase: Raster[] = [];
const key = (p: Position) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

/** One derived geometry serves washes, outlines, labels and native feature hit-testing. */
export function drawingGeography(features: AtlasFeature[], base = noBase): DrawingGeography {
  const previous = cache.get(features);
  if (previous?.base === base) return previous.shapes;
  const shapes = new Map(features.map((f) => [f.id, f.geometry as Geometry | null]));
  for (const layer of politicalLayers)
    softenSharedCorners(
      features.filter((f) => f.layerId === layer && f.geometry.type.includes("Polygon")),
      shapes
    );
  const water = [
    ...drawingOceans(features, base),
    ...features.filter((f) => f.kind === "lake").map((f) => f.geometry),
  ].filter((g): g is Geometry => !!g);
  if (water.length) {
    const dry = spatial.differenceFrom(spatial.unionAll(water));
    for (const f of features) if (landPolygon(f)) shapes.set(f.id, dry(shapes.get(f.id)!));
  }
  cache.set(features, { base, shapes });
  return shapes;
}
export function drawingOceans(features: AtlasFeature[], base: Raster[]): Geometry[] {
  return base.length
    ? base.map(drawnOcean).filter((g): g is Geometry => !!g)
    : features.filter((f) => f.kind === "ocean").map((f) => f.geometry);
}
function landPolygon(f: AtlasFeature) {
  return (
    f.geometry.type.includes("Polygon") &&
    (politicalLayers.has(f.layerId) || f.layerId === "ecology")
  );
}
interface Node {
  p: Position;
  adjacent: Set<string>;
  owners: Set<AtlasFeature>;
}
/** Move each shared corner once. Junctions, coast edges and authored borders stay fixed. */
function softenSharedCorners(features: AtlasFeature[], shapes: Map<string, Geometry | null>) {
  if (features.length < 2) return;
  const lines = features.flatMap((f) => regionBoundaryLines(f.geometry));
  const noded = spatial.nodeLines({
    type: "MultiLineString",
    coordinates: lines.map((l) => l.coordinates),
  });
  const nodes = new Map<string, Node>();
  const node = (p: Position) => {
    const id = key(p);
    if (!nodes.has(id)) nodes.set(id, { p, adjacent: new Set(), owners: new Set() });
    return nodes.get(id)!;
  };
  for (const line of regionBoundaryLines(noded))
    for (let i = 1; i < line.coordinates.length; i++) {
      const a = line.coordinates[i - 1],
        b = line.coordinates[i];
      node(a).adjacent.add(key(b));
      node(b).adjacent.add(key(a));
    }
  for (const f of features)
    for (const line of regionBoundaryLines(f.geometry))
      for (const p of line.coordinates) node(p).owners.add(f);
  relaxCorners(nodes, features);
  for (const f of features) shapes.set(f.id, replaceCorners(f.geometry, nodes));
}
// A few local passes round the ownership-cell stairs, without independently buffering countries.
const borderRelaxationPasses = 3;
function relaxCorners(nodes: Map<string, Node>, features: AtlasFeature[]) {
  const fixed = new Set<string>();
  for (let pass = 0; pass < borderRelaxationPasses; pass++) {
    const next = new Map<string, Position>();
    for (const [id, n] of nodes) {
      if (fixed.has(id) || n.adjacent.size !== 2 || n.owners.size < 2) continue;
      if ([...n.owners].some((f) => f.state !== "generated" || f.protected)) continue;
      const [a, b] = [...n.adjacent].map((k) => nodes.get(k)!.p);
      next.set(id, relaxedCorner(n.p, a, b));
    }
    const previous = new Map([...nodes].map(([id, n]) => [id, n.p]));
    for (const [id, p] of next) nodes.get(id)!.p = p;
    retainValidRings(nodes, features, next, previous, fixed);
  }
}
function relaxedCorner(p: Position, a: Position, b: Position): Position {
  const dx = (a[0] - 2 * p[0] + b[0]) / 4,
    dy = (a[1] - 2 * p[1] + b[1]) / 4;
  const shortest = Math.min(
    Math.hypot(a[0] - p[0], a[1] - p[1]),
    Math.hypot(b[0] - p[0], b[1] - p[1])
  );
  const fraction = Math.min(1, shortest / 2 / Math.max(1e-9, Math.hypot(dx, dy)));
  return [p[0] + dx * fraction, p[1] + dy * fraction];
}
/** Reject movements on a collapsing ring together, including the neighbour's copy of its edge. */
function retainValidRings(
  nodes: Map<string, Node>,
  features: AtlasFeature[],
  moved: Map<string, Position>,
  previous: Map<string, Position>,
  fixed: Set<string>
) {
  while (moved.size) {
    const invalid = features.filter((f) => !validRingGeometry(replaceCorners(f.geometry, nodes)));
    if (!invalid.length) return;
    const coordinates = invalid.flatMap((f) =>
      regionBoundaryLines(f.geometry).flatMap((line) => line.coordinates)
    );
    for (const p of coordinates) {
      const id = key(p);
      if (!moved.delete(id)) continue;
      nodes.get(id)!.p = previous.get(id)!;
      fixed.add(id);
    }
  }
}
function validRingGeometry(shape: Geometry) {
  try {
    spatial.canonical(shape);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "invalid_geometry")
      return false;
    throw error;
  }
}
function replaceCorners(shape: Geometry, nodes: Map<string, Node>): Geometry {
  if (shape.type === "Polygon")
    return {
      ...shape,
      coordinates: shape.coordinates.map((ring) => ring.map((p) => nodes.get(key(p))!.p)),
    };
  if (shape.type === "MultiPolygon")
    return {
      ...shape,
      coordinates: shape.coordinates.map((polygon) =>
        polygon.map((ring) => ring.map((p) => nodes.get(key(p))!.p))
      ),
    };
  return shape;
}
