import { adaptiveWindowLeaves, type Bounds } from "@atlas/domain";
import { triangleAddress, triangleIndex, type PhysicalMesh } from "./mesh";

/** Exact centroid candidates in world coordinates, using the adaptive tree or lattice index. */
export function* meshWindowCells(mesh: PhysicalMesh, bounds: Bounds) {
  if (mesh.topology) {
    for (const leaf of adaptiveWindowLeaves(mesh.topology, bounds)) {
      const cell = mesh.leafToCell(leaf);
      if (cell >= 0 && inside(mesh, cell, bounds)) yield cell;
    }
    return;
  }
  yield* latticeWindowCells(mesh, bounds);
}
function* latticeWindowCells(mesh: PhysicalMesh, bounds: Bounds) {
  const { x0, x1, d0, d1 } = latticeLimits(mesh, bounds);
  for (const inverted of [false, true]) {
    const s0 = (x0 - (inverted ? 2 : 1)) / 1.5,
      s1 = (x1 - (inverted ? 2 : 1)) / 1.5;
    for (let u = Math.floor((s0 - d1) / 2) - 1; u <= Math.ceil((s1 - d0) / 2) + 1; u++) {
      const low = Math.floor(Math.max(s0 - u, d0 + u)) - 1,
        high = Math.ceil(Math.min(s1 - u, d1 + u)) + 1;
      for (let v = low; v <= high; v++) {
        const cell = canonicalCell(mesh, u, v, inverted);
        if (cell >= 0 && inside(mesh, cell, bounds)) yield cell;
      }
    }
  }
}
function latticeLimits(mesh: PhysicalMesh, bounds: Bounds) {
  const x0 = (bounds[0] - mesh.origin[0] - mesh.latticeOffset[0]) / mesh.spacing,
    x1 = (bounds[2] - mesh.origin[0] - mesh.latticeOffset[0]) / mesh.spacing,
    scaleY = (Math.sqrt(3) * (mesh.periodic?.poles?.spacingY ?? mesh.spacing)) / 2,
    d0 = (bounds[1] - mesh.origin[1] - mesh.latticeOffset[1]) / scaleY,
    d1 = (bounds[3] - mesh.origin[1] - mesh.latticeOffset[1]) / scaleY;
  return { x0, x1, d0, d1 };
}
/** The cell at an address only when it is that address, not its periodic image. */
function canonicalCell(mesh: PhysicalMesh, u: number, v: number, inverted: boolean) {
  const cell = triangleIndex(mesh, u, v, inverted);
  if (cell < 0) return -1;
  const [cu, cv, ci] = triangleAddress(mesh, cell);
  return cu === u && cv === v && ci === inverted ? cell : -1;
}
function inside(mesh: PhysicalMesh, cell: number, bounds: Bounds) {
  const x = mesh.x(cell) + mesh.origin[0],
    y = mesh.y(cell) + mesh.origin[1];
  return x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];
}
