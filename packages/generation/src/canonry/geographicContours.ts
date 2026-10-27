import {
  adaptivePointSampler,
  contourSupport,
  createGrid,
  fieldContour,
  rectangle,
  type Bounds,
  linearFieldContour,
  spatial,
  type NumericalAllocator,
} from "@atlas/domain";
import type { Geometry, Position } from "geojson";
import type { GenerationState } from "../process";
import {
  triangleSampler,
  triangleFans,
  triangleBoundary,
  triangleSupport,
  triangleCellFans,
} from "./triangleSampling";
import { physicalSampler } from "./physicalMetric";
import type { PhysicalMesh } from "./mesh";
import { workingValues, releaseWorking } from "./physicalNumerics";
import { meshWindowCells } from "./meshWindow";

/** Polygon overlays can also return isolated boundary lines; these are not surface area. */
export function areaGeometry(shape: Geometry | null): Geometry | null {
  if (!shape || shape.type === "Polygon" || shape.type === "MultiPolygon") return shape;
  if (shape.type !== "GeometryCollection") return null;
  const polygons = shape.geometries.map(areaGeometry).filter((g): g is Geometry => Boolean(g));
  return polygons.length ? spatial.unionAll(polygons) : null;
}

export function lakeFootprint(
  state: GenerationState,
  members: Iterable<number>,
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
    triangleFans(mesh, members, (i) => level - map.Elevation[i], state.numerical),
    wet,
    0,
    triangleBoundary(mesh, (i) => level - map.Elevation[i], members, state.numerical),
    state.contours
  );
  const membership = linearFieldContour(
    triangleFans(mesh, members, (i) => Number(map.WaterBodyIds[i] === body), state.numerical),
    connected,
    0.1,
    triangleBoundary(mesh, (i) => Number(map.WaterBodyIds[i] === body), members, state.numerical),
    state.contours
  );
  return footprint && membership && spatial.intersection(footprint, membership);
}

/** Only ocean-connected cells are sea; enclosed basins below sea level stay dry, as in generation. */
export function oceanFootprint(state: GenerationState) {
  const map = state.physical!.map,
    mesh = map.mesh,
    depths = workingValues(map, "float64", "ocean-contour-depth", (i) => {
      const depth = map.EffectiveSeaLevel - map.Elevation[i];
      return map.WaterKindCodes[i] === 1 ? depth : -Math.abs(depth);
    }),
    depth = physicalSampler(mesh, depths),
    at = (x: number, y: number) => depth(x - mesh.origin[0], y - mesh.origin[1]);
  const shape = mesh.topology
    ? fieldContour(mesh.topology, at, undefined, 0, undefined, state.contours)
    : linearFieldContour(
        triangleFans(mesh, undefined, (i) => depths[i]),
        at,
        0,
        triangleBoundary(mesh, (i) => depths[i]),
        state.contours
      );
  releaseWorking(map, depths);
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
  members: Iterable<number>,
  includes: (cell: number) => number
) {
  const mesh = state.physical!.map.mesh,
    valueAt = membershipSampler(state, includes);
  if (mesh.topology || supportTouchesBoundary(mesh, members, state.numerical))
    return geographicContour(state, members, valueAt);
  return linearFieldContour(
    triangleFans(mesh, members, includes, state.numerical),
    valueAt,
    undefined,
    undefined,
    state.contours
  );
}
/**
 * Trace where several per-cell quantities, each interpolated on its own, combine above zero.
 * Combining at every interpolation sample keeps each quantity's own zero crossings, so a
 * term shared with another outline, such as the sea's depth, crosses where that one does.
 */
export function combinedContour(
  state: GenerationState,
  members: Iterable<number>,
  terms: ((cell: number) => number)[],
  combine: (values: number[]) => number
) {
  const mesh = state.physical!.map.mesh,
    samplers = terms.map((term) => membershipSampler(state, term)),
    valueAt = (x: number, y: number) => combine(samplers.map((sample) => sample(x, y)));
  if (mesh.topology || supportTouchesBoundary(mesh, members, state.numerical))
    return geographicContour(state, members, valueAt, 0);
  return linearFieldContour(
    combinedFans(mesh, members, terms, combine, state.numerical),
    valueAt,
    0,
    undefined,
    state.contours
  );
}
function supportTouchesBoundary(
  mesh: PhysicalMesh,
  members: Iterable<number>,
  numerical?: NumericalAllocator
) {
  const support = triangleSupport(mesh, members, numerical);
  try {
    for (const cell of support) if (touchesChartBoundary(mesh, cell)) return true;
    return false;
  } finally {
    support.close();
  }
}
function touchesChartBoundary(mesh: PhysicalMesh, cell: number) {
  if (mesh.boundary[cell]) return true;
  if (!mesh.periodic) return false;
  const y = mesh.y[cell] + mesh.origin[1];
  if (y - mesh.cellHeight[cell] <= mesh.bounds[1] || y + mesh.cellHeight[cell] >= mesh.bounds[3])
    return true;
  for (let edge = 0; edge < mesh.degree[cell]; edge++) {
    const neighbor = mesh.neighbors[cell * mesh.stride + edge];
    if (neighbor >= 0 && Math.abs(mesh.x[neighbor] - mesh.x[cell]) > 2 * mesh.spacing) return true;
  }
  return false;
}
function* combinedFans(
  mesh: PhysicalMesh,
  members: Iterable<number>,
  terms: ((cell: number) => number)[],
  combine: (values: number[]) => number,
  numerical?: NumericalAllocator
) {
  const support = triangleSupport(mesh, members, numerical);
  const fans = terms.map((term) => triangleCellFans(mesh, support, term));
  try {
    for (;;) {
      const triangles = fans.map((fan) => fan.next());
      if (triangles[0].done) return;
      yield triangles[0].value.map(([x, y], corner): [number, number, number] => [
        x,
        y,
        combine(triangles.map((triangle) => triangle.value![corner][2])),
      ]);
    }
  } finally {
    for (const fan of fans) fan.return();
    support.close();
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
  const mesh = state.physical!.map.mesh;
  const keep = (ring: Position[]) => {
    const hole: Geometry = { type: "Polygon", coordinates: [ring] };
    if (spatial.area(hole) >= maximum) return true;
    const covers = spatial.pointCoverage(hole);
    for (const cell of meshWindowCells(mesh, spatial.bounds(hole)))
      if (
        blocks(cell) &&
        covers({ x: mesh.x[cell] + mesh.origin[0], y: mesh.y[cell] + mesh.origin[1], z: 0 })
      )
        return true;
    return false;
  };
  const filled = polygons.map(([outer, ...holes]) => [outer, ...holes.filter(keep)]);
  return shape.type === "Polygon"
    ? { type: "Polygon", coordinates: filled[0] }
    : spatial.unionAll(filled.map((coordinates) => ({ type: "Polygon", coordinates })));
}
export function geographicContour(
  state: GenerationState,
  members: Iterable<number>,
  valueAt: (x: number, y: number) => number,
  level = 0.5
) {
  const mesh = state.physical!.map.mesh;
  if (mesh.topology)
    return fieldContour(
      mesh.topology,
      valueAt,
      contourSupport(mesh.topology, memberLeaves(mesh, members), state.numerical),
      level,
      undefined,
      state.contours
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
      Math.ceil((bounds[3] - bounds[1]) / spacing) + 1,
      bounds,
      state.numerical
    );
  try {
    return fieldContour(grid, valueAt, undefined, level, undefined, state.contours);
  } finally {
    releaseWorking(state.physical!.map, grid.active, grid.measures);
  }
}
function* memberLeaves(mesh: PhysicalMesh, members: Iterable<number>) {
  for (const i of members) yield mesh.cellToLeaf[i];
}
