import type { PhysicalMesh } from "./mesh";

interface Face {
  cell: number;
  length: number;
  dx: number;
  dy: number;
}
function edgeCells(mesh: PhysicalMesh, x: number, side: number) {
  const cells: number[] = [];
  for (let i = 0; i < mesh.count; i++)
    if (Math.abs(mesh.x[i] + (side * mesh.cellWidth[i]) / 2 - x) < 1e-6) cells.push(i);
  return cells;
}
function seamFaces(mesh: PhysicalMesh, west: number, east: number) {
  const left = edgeCells(mesh, west, -1),
    right = edgeCells(mesh, east, 1),
    faces = Array.from({ length: mesh.count }, () => [] as Face[]),
    width = east - west;
  for (const a of left)
    for (const b of right) {
      const length =
        Math.min(mesh.y[a] + mesh.cellHeight[a] / 2, mesh.y[b] + mesh.cellHeight[b] / 2) -
        Math.max(mesh.y[a] - mesh.cellHeight[a] / 2, mesh.y[b] - mesh.cellHeight[b] / 2);
      if (length <= 0) continue;
      const dx = mesh.x[b] - mesh.x[a] - width,
        dy = mesh.y[b] - mesh.y[a];
      faces[a].push({ cell: b, length, dx, dy });
      faces[b].push({ cell: a, length, dx: -dx, dy: -dy });
    }
  return faces;
}
/** Join actual control-volume faces across the cylindrical chart, retaining metre distances. */
export function joinAdaptiveSeam(mesh: PhysicalMesh) {
  const [west, south, east, north] = mesh.bounds,
    faces = seamFaces(mesh, west, east),
    oldStride = mesh.stride,
    stride = faces.reduce((n, extra, i) => Math.max(n, mesh.degree[i] + extra.length), oldStride),
    length = mesh.count * stride;
  const next = {
    neighbors: new Int32Array(length).fill(-1),
    edgeX: new Float32Array(length),
    edgeY: new Float32Array(length),
    edgeLength: new Float64Array(length),
    faceLength: new Float64Array(length),
    faceDistance: new Float64Array(length),
  };
  for (let i = 0; i < mesh.count; i++) {
    for (const key of Object.keys(next) as (keyof typeof next)[])
      next[key].set(mesh[key].subarray(i * oldStride, i * oldStride + mesh.degree[i]), i * stride);
    for (const face of faces[i]) {
      const at = i * stride + mesh.degree[i]++,
        distance = Math.hypot(face.dx, face.dy);
      next.neighbors[at] = face.cell;
      next.edgeLength[at] = distance;
      next.edgeX[at] = face.dx / distance;
      next.edgeY[at] = face.dy / distance;
      next.faceLength[at] = face.length;
      next.faceDistance[at] = Math.abs(face.dx);
    }
    mesh.boundary[i] = Number(
      Math.abs(mesh.y[i] - mesh.cellHeight[i] / 2 - south) < 1e-6 ||
        Math.abs(mesh.y[i] + mesh.cellHeight[i] / 2 - north) < 1e-6
    );
  }
  Object.assign(mesh, next, { stride, periodic: { width: east - west, columns: 0 } });
}
