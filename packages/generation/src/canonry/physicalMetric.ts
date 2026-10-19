import type { PhysicalMesh } from "./mesh";
import { adaptivePointSampler } from "@atlas/domain";
import { nearestTriangle } from "./mesh";

export const physicalDistance = (mesh: PhysicalMesh, i: number, j: number) =>
  Math.hypot(mesh.x[j] - mesh.x[i], mesh.y[j] - mesh.y[i]);

export function physicalFace(mesh: PhysicalMesh, i: number, edge: number) {
  const at = i * mesh.stride + edge,
    j = mesh.neighbors[at];
  let x = (mesh.x[i] + mesh.x[j]) / 2,
    y = (mesh.y[i] + mesh.y[j]) / 2;
  let nx = mesh.edgeX[at],
    ny = mesh.edgeY[at];
  if (mesh.topology) {
    const leaf = mesh.cellToLeaf[i],
      source = mesh.topology.offsets[leaf] + edge;
    nx = mesh.topology.normalX[source];
    ny = mesh.topology.normalY[source];
    x =
      (Math.max(mesh.x[i] - mesh.cellWidth[i] / 2, mesh.x[j] - mesh.cellWidth[j] / 2) +
        Math.min(mesh.x[i] + mesh.cellWidth[i] / 2, mesh.x[j] + mesh.cellWidth[j] / 2)) /
      2;
    y =
      (Math.max(mesh.y[i] - mesh.cellHeight[i] / 2, mesh.y[j] - mesh.cellHeight[j] / 2) +
        Math.min(mesh.y[i] + mesh.cellHeight[i] / 2, mesh.y[j] + mesh.cellHeight[j] / 2)) /
      2;
  }
  return { x, y, nx, ny, length: mesh.faceLength[at] };
}

/** Least-squares gradient in world metres; split faces contribute their actual support. */
export function physicalGradients(mesh: PhysicalMesh, values: ArrayLike<number>) {
  const x = new Float64Array(mesh.count),
    y = new Float64Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) {
    let xx = 0,
      xy = 0,
      yy = 0,
      vx = 0,
      vy = 0;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const at = i * mesh.stride + edge,
        j = mesh.neighbors[at];
      if (j < 0) continue;
      const dx = mesh.x[j] - mesh.x[i],
        dy = mesh.y[j] - mesh.y[i];
      const weight = mesh.faceLength[at] / mesh.edgeLength[at] ** 2;
      const delta = values[j] - values[i];
      xx += weight * dx * dx;
      xy += weight * dx * dy;
      yy += weight * dy * dy;
      vx += weight * dx * delta;
      vy += weight * dy * delta;
    }
    const determinant = xx * yy - xy * xy;
    if (determinant <= 0) continue;
    x[i] = (vx * yy - vy * xy) / determinant;
    y[i] = (vy * xx - vx * xy) / determinant;
  }
  return { x, y };
}

/** Distance spent inside a control volume along a physical transport heading. */
export function cellTravel(mesh: PhysicalMesh, i: number, dx: number, dy: number) {
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.sqrt(mesh.areas[i]);
  return Math.min(
    dx === 0 ? Infinity : (mesh.cellWidth[i] * length) / Math.abs(dx),
    dy === 0 ? Infinity : (mesh.cellHeight[i] * length) / Math.abs(dy)
  );
}
export function physicalSampler(mesh: PhysicalMesh, values: ArrayLike<number>) {
  if (!mesh.topology) return (x: number, y: number) => values[nearestTriangle(mesh, x, y)];
  const at = adaptivePointSampler(
    mesh.topology,
    Float64Array.from(mesh.leafToCell, (cell) => values[cell])
  );
  return (x: number, y: number) => at(x + mesh.origin[0], y + mesh.origin[1]);
}
