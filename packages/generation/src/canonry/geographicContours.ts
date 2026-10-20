import {
  adaptivePointSampler,
  contourSupport,
  createGrid,
  fieldContour,
  rectangle,
  type Bounds,
  linearFieldContour,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { triangleSampler, triangleFans } from "./triangleSampling";

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
  return linearFieldContour(triangleFans(mesh, members, includes), valueAt);
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
