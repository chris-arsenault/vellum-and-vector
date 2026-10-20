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
import type { GenerationState } from "../process";
import { triangleSampler, triangleFans, triangleBoundary } from "./triangleSampling";
import { physicalSampler } from "./physicalMetric";

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

export function oceanFootprint(state: GenerationState) {
  const map = state.physical!.map,
    mesh = map.mesh,
    height = physicalSampler(mesh, map.Elevation),
    at = (x: number, y: number) =>
      map.EffectiveSeaLevel - height(x - mesh.origin[0], y - mesh.origin[1]);
  const shape = mesh.topology
    ? fieldContour(mesh.topology, at, undefined, 0)
    : linearFieldContour(
        triangleFans(
          mesh,
          Array.from({ length: mesh.count }, (_, i) => i),
          (i) => map.EffectiveSeaLevel - map.Elevation[i]
        ),
        at,
        0,
        triangleBoundary(mesh, (i) => map.EffectiveSeaLevel - map.Elevation[i])
      );
  return shape && spatial.intersection(shape, state.domain.scope.footprint);
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
  if (mesh.topology || members.some((i) => mesh.boundary[i]))
    return geographicContour(state, members, valueAt);
  return linearFieldContour(
    triangleFans(mesh, members, includes),
    valueAt,
    0.5,
    triangleBoundary(mesh, includes, members)
  );
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
