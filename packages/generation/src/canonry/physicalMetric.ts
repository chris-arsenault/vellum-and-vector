import type { PhysicalMesh } from "./mesh";
import { adaptivePointSampler, Band, type Coverage } from "@atlas/domain";
import { triangleSampler } from "./triangleSampling";
import { meshDeltaX, edgeLeadingTo } from "./mesh";

export function physicalDistance(mesh: PhysicalMesh, i: number, j: number) {
  const edge = mesh.periodic?.poles ? edgeLeadingTo(mesh, i, j) : -1;
  return edge >= 0
    ? mesh.edgeLength(i, edge)
    : Math.hypot(meshDeltaX(mesh, mesh.x(j) - mesh.x(i)), mesh.y(j) - mesh.y(i));
}

export function physicalFace(mesh: PhysicalMesh, i: number, edge: number) {
  const j = mesh.neighbor(i, edge);
  let x = mesh.x(i) + meshDeltaX(mesh, mesh.x(j) - mesh.x(i)) / 2,
    y = (mesh.y(i) + mesh.y(j)) / 2;
  const nx = mesh.edgeX(i, edge),
    ny = mesh.edgeY(i, edge);
  if (mesh.periodic?.poles) {
    x = mesh.x(i) + (nx * mesh.edgeLength(i, edge)) / 2;
    y = mesh.y(i) + (ny * mesh.edgeLength(i, edge)) / 2;
  }
  if (mesh.topology) return adaptiveFace(mesh, i, edge);
  return { x, y, nx, ny, length: mesh.faceLength(i, edge) };
}
function adaptiveFace(mesh: PhysicalMesh, i: number, edge: number) {
  const topology = mesh.topology!,
    j = mesh.neighbor(i, edge),
    leaf = mesh.cellToLeaf(i),
    start = topology.offsets.get(leaf),
    local = edge < topology.offsets.get(leaf + 1) - start,
    nx = local ? topology.normalX.get(start + edge) : Math.sign(mesh.edgeX(i, edge)),
    ny = local ? topology.normalY.get(start + edge) : 0,
    otherX = mesh.x(j) + (local ? 0 : nx * mesh.periodic!.width),
    x =
      (Math.max(mesh.x(i) - mesh.cellWidth(i) / 2, otherX - mesh.cellWidth(j) / 2) +
        Math.min(mesh.x(i) + mesh.cellWidth(i) / 2, otherX + mesh.cellWidth(j) / 2)) /
      2,
    y =
      (Math.max(mesh.y(i) - mesh.cellHeight(i) / 2, mesh.y(j) - mesh.cellHeight(j) / 2) +
        Math.min(mesh.y(i) + mesh.cellHeight(i) / 2, mesh.y(j) + mesh.cellHeight(j) / 2)) /
      2;
  return { x, y, nx, ny, length: mesh.faceLength(i, edge) };
}

/** Least-squares gradient in world metres; split faces contribute their actual support. */
export function physicalGradients(
  mesh: PhysicalMesh,
  values: (i: number) => number,
  coverage: Coverage
) {
  const x = coverage.scratch("float64", "gradient:x"),
    y = coverage.scratch("float64", "gradient:y");
  for (let i = 0; i < mesh.count; i++) {
    let xx = 0,
      xy = 0,
      yy = 0,
      vx = 0,
      vy = 0;
    const value = values(i);
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0) continue;
      const length = mesh.edgeLength(i, edge),
        dx = mesh.periodic?.poles
          ? mesh.edgeX(i, edge) * length
          : meshDeltaX(mesh, mesh.x(j) - mesh.x(i)),
        dy = mesh.periodic?.poles ? mesh.edgeY(i, edge) * length : mesh.y(j) - mesh.y(i);
      const weight = mesh.faceLength(i, edge) / length ** 2;
      const delta = values(j) - value;
      xx += weight * dx * dx;
      xy += weight * dx * dy;
      yy += weight * dy * dy;
      vx += weight * dx * delta;
      vy += weight * dy * delta;
    }
    const determinant = xx * yy - xy * xy;
    if (determinant <= 0) continue;
    x.set(i, (vx * yy - vy * xy) / determinant);
    y.set(i, (vy * xx - vx * xy) / determinant);
  }
  return { x, y };
}

/** Distance spent inside a control volume along a physical transport heading. */
export function cellTravel(mesh: PhysicalMesh, i: number, dx: number, dy: number) {
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.sqrt(mesh.area(i));
  return Math.min(
    dx === 0 ? Infinity : (mesh.cellWidth(i) * length) / Math.abs(dx),
    dy === 0 ? Infinity : (mesh.cellHeight(i) * length) / Math.abs(dy)
  );
}
/** A point sampler over cell values given as a band, an array or a reader. */
export function physicalSampler(
  mesh: PhysicalMesh,
  values: Band | ArrayLike<number> | ((i: number) => number)
) {
  const read =
    typeof values === "function"
      ? values
      : values instanceof Band
        ? (i: number) => values.get(i)
        : (i: number) => values[i];
  if (!mesh.topology) return triangleSampler(mesh, read);
  const at = adaptivePointSampler(mesh.topology, (leaf) => read(mesh.leafToCell(leaf)));
  return (x: number, y: number) => at(x + mesh.origin[0], y + mesh.origin[1]);
}
