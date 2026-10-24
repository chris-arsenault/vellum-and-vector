import {
  adaptivePointSampler,
  contourSupport,
  createGrid,
  fieldContour,
  rectangle,
  type Bounds,
  linearFieldContour,
  spatial,
} from "@atlas/domain";
import type { Geometry, Position } from "geojson";
import type { GenerationState } from "../process";
import {
  triangleSampler,
  triangleFans,
  triangleBoundary,
  triangleSupport,
} from "./triangleSampling";
import { physicalSampler } from "./physicalMetric";
import type { PhysicalMesh } from "./mesh";

/** Polygon overlays can also return isolated boundary lines; these are not surface area. */
export function areaGeometry(shape: Geometry | null): Geometry | null {
  if (!shape || shape.type === "Polygon" || shape.type === "MultiPolygon") return shape;
  if (shape.type !== "GeometryCollection") return null;
  const polygons = shape.geometries.map(areaGeometry).filter((g): g is Geometry => Boolean(g));
  return polygons.length ? spatial.unionAll(polygons) : null;
}

export function lakeFootprint(
  state: GenerationState,
  members: number[],
  body: number,
  level: number
) {
  const map = state.physical!.map,
    mesh = map.mesh,
    floor = physicalSampler(mesh, map.Elevation),
    connected = membershipSampler(state, (i) => Number(map.WaterBodyIds[i] === body)),
    wet = (x: number, y: number) => level - floor(x - mesh.origin[0], y - mesh.origin[1]);
  if (mesh.topology)
    return geographicContour(
      state,
      members,
      (x, y) => Math.min(wet(x, y), (connected(x, y) - 0.1) * 1e6),
      0
    );
  const footprint = linearFieldContour(
    triangleFans(mesh, members, (i) => level - map.Elevation[i]),
    wet,
    0,
    triangleBoundary(mesh, (i) => level - map.Elevation[i], members)
  );
  const membership = linearFieldContour(
    triangleFans(mesh, members, (i) => Number(map.WaterBodyIds[i] === body)),
    connected,
    0.1,
    triangleBoundary(mesh, (i) => Number(map.WaterBodyIds[i] === body), members)
  );
  return footprint && membership && spatial.intersection(footprint, membership);
}

/** Only ocean-connected cells are sea; enclosed basins below sea level stay dry, as in generation. */
export function oceanFootprint(state: GenerationState) {
  const map = state.physical!.map,
    mesh = map.mesh,
    depths = Float64Array.from(map.Elevation, (elevation, i) => {
      const depth = map.EffectiveSeaLevel - elevation;
      return map.WaterKindCodes[i] === 1 ? depth : -Math.abs(depth);
    }),
    depth = physicalSampler(mesh, depths),
    at = (x: number, y: number) => depth(x - mesh.origin[0], y - mesh.origin[1]);
  const shape = mesh.topology
    ? fieldContour(mesh.topology, at, undefined, 0)
    : linearFieldContour(
        triangleFans(
          mesh,
          Array.from({ length: mesh.count }, (_, i) => i),
          (i) => depths[i]
        ),
        at,
        0,
        triangleBoundary(mesh, (i) => depths[i])
      );
  return areaGeometry(shape && spatial.intersection(shape, state.domain.scope.footprint));
}

export function membershipSampler(state: GenerationState, includes: (cell: number) => number) {
  const mesh = state.physical!.map.mesh;
  if (mesh.topology)
    return adaptivePointSampler(mesh.topology, (leaf) => includes(mesh.leafToCell[leaf]));
  const sample = triangleSampler(mesh, includes);
  return (x: number, y: number) => sample(x - mesh.origin[0], y - mesh.origin[1]);
}
/** Trace the physical field locally, including its complete interpolation support. */
export function membershipContour(
  state: GenerationState,
  members: number[],
  includes: (cell: number) => number
) {
  const mesh = state.physical!.map.mesh,
    valueAt = membershipSampler(state, includes);
  if (
    mesh.topology ||
    mesh.periodic ||
    [...triangleSupport(mesh, members)].some((i) => mesh.boundary[i])
  )
    return geographicContour(state, members, valueAt);
  return linearFieldContour(triangleFans(mesh, members, includes), valueAt);
}
/**
 * Trace where several per-cell quantities, each interpolated on its own, combine above zero.
 * Combining at every interpolation sample keeps each quantity's own zero crossings, so a
 * term shared with another outline, such as the sea's depth, crosses where that one does.
 */
export function combinedContour(
  state: GenerationState,
  members: number[],
  terms: ((cell: number) => number)[],
  combine: (values: number[]) => number
) {
  const mesh = state.physical!.map.mesh,
    samplers = terms.map((term) => membershipSampler(state, term)),
    valueAt = (x: number, y: number) => combine(samplers.map((sample) => sample(x, y)));
  if (
    mesh.topology ||
    mesh.periodic ||
    [...triangleSupport(mesh, members)].some((i) => mesh.boundary[i])
  )
    return geographicContour(state, members, valueAt, 0);
  return linearFieldContour(combinedFans(mesh, members, terms, combine), valueAt, 0);
}
function* combinedFans(
  mesh: PhysicalMesh,
  members: number[],
  terms: ((cell: number) => number)[],
  combine: (values: number[]) => number
) {
  const fans = terms.map((term) => triangleFans(mesh, members, term));
  for (;;) {
    const triangles = fans.map((fan) => fan.next());
    if (triangles[0].done) return;
    yield triangles[0].value.map(([x, y], corner): [number, number, number] => [
      x,
      y,
      combine(triangles.map((triangle) => triangle.value![corner][2])),
    ]);
  }
}
/**
 * Close interior rings smaller than `maximum` square metres that hold no `blocks` cell, such as
 * water or another region's members, so a feature absorbs the small gaps it encloses.
 */
export function fillSmallHoles(
  state: GenerationState,
  shape: Geometry,
  maximum: number,
  blocks: (cell: number) => boolean
): Geometry {
  const polygons =
    shape.type === "Polygon"
      ? [shape.coordinates]
      : shape.type === "MultiPolygon"
        ? shape.coordinates
        : null;
  if (!polygons) return shape;
  const mesh = state.physical!.map.mesh,
    blocked: [number, number][] = [];
  for (let i = 0; i < mesh.count; i++)
    if (blocks(i)) blocked.push([mesh.x[i] + mesh.origin[0], mesh.y[i] + mesh.origin[1]]);
  const keep = (ring: Position[]) => {
    const hole: Geometry = { type: "Polygon", coordinates: [ring] };
    if (spatial.area(hole) >= maximum) return true;
    const [x0, y0, x1, y1] = spatial.bounds(hole),
      covers = spatial.pointCoverage(hole);
    return blocked.some(
      ([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && covers({ x, y, z: 0 })
    );
  };
  const filled = polygons.map(([outer, ...holes]) => [outer, ...holes.filter(keep)]);
  return shape.type === "Polygon"
    ? { type: "Polygon", coordinates: filled[0] }
    : spatial.unionAll(filled.map((coordinates) => ({ type: "Polygon", coordinates })));
}
export function geographicContour(
  state: GenerationState,
  members: number[],
  valueAt: (x: number, y: number) => number,
  level = 0.5
) {
  const mesh = state.physical!.map.mesh;
  if (mesh.topology)
    return fieldContour(
      mesh.topology,
      valueAt,
      contourSupport(
        mesh.topology,
        members.map((i) => mesh.cellToLeaf[i])
      ),
      level
    );
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const i of members) {
    bounds[0] = Math.min(bounds[0], mesh.x[i] + mesh.origin[0]);
    bounds[1] = Math.min(bounds[1], mesh.y[i] + mesh.origin[1]);
    bounds[2] = Math.max(bounds[2], mesh.x[i] + mesh.origin[0]);
    bounds[3] = Math.max(bounds[3], mesh.y[i] + mesh.origin[1]);
  }
  for (let axis = 0; axis < 4; axis++) bounds[axis] += (axis < 2 ? -2 : 2) * mesh.spacing;
  const scope = { ...state.surface.scope, footprint: rectangle(bounds) },
    spacing = mesh.spacing / 2,
    grid = createGrid(
      "contour",
      scope,
      Math.ceil((bounds[2] - bounds[0]) / spacing) + 1,
      Math.ceil((bounds[3] - bounds[1]) / spacing) + 1
    );
  return fieldContour(grid, valueAt, undefined, level);
}
