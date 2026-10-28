// Canonry PhysicalGeographyGrid.cs and MicrotriangleCoord.cs, commit 0f62584c.
import {
  AdaptiveLattice,
  TriangularLattice,
  createCenteredLattice,
  edgeTo,
  type Lattice,
} from "@atlas/domain";

/** The physical mesh is a lattice: arithmetic on the world's triangular raster, stored
 * adjacency on a region's adaptive leaves. */
export type PhysicalMesh = Lattice;
export { AdaptiveLattice, TriangularLattice };

/** Cell of a lattice address on the triangular lattice, -1 off it or on adaptive meshes. */
export function triangleIndex(mesh: PhysicalMesh, u: number, v: number, inverted: boolean) {
  return mesh instanceof TriangularLattice ? mesh.addressCell(u, v, inverted) : -1;
}
/** The lattice address of a triangular cell; adaptive cells have none. */
export function triangleAddress(mesh: PhysicalMesh, cell: number): [number, number, boolean] {
  return mesh instanceof TriangularLattice ? mesh.address(cell) : [0, 0, false];
}
/** The unit-spacing reference disk for process tests. */
export function createMesh(contentCount: number, padding: number): PhysicalMesh {
  return createCenteredLattice(contentCount, padding);
}
export function triangleIdentity(mesh: PhysicalMesh, i: number): number {
  return mesh.identity(i);
}
export function nearestTriangle(mesh: PhysicalMesh, x: number, y: number): number {
  return mesh.cellAt(x, y);
}
/** Short east/west displacement within a periodic metre chart. */
export function meshDeltaX(mesh: PhysicalMesh, dx: number): number {
  return mesh.deltaX(dx);
}
/** Canonical local easting; numerical padding remains ordinary on open meshes. */
export function meshPointX(mesh: PhysicalMesh, x: number): number {
  return mesh.pointX(x);
}
/** Closed latitude edges reflect overflow locally; longitude always remains cylindrical. */
export function meshPoint(mesh: PhysicalMesh, x: number, y: number): [number, number] {
  return mesh.point(x, y);
}
/** Short segment in the cylindrical chart, including repeated longitude images. */
export function meshLineDelta(mesh: PhysicalMesh, a: [number, number], b: [number, number]) {
  return [mesh.deltaX(b[0] - a[0]), b[1] - a[1]];
}
export function edgeLeadingTo(mesh: PhysicalMesh, i: number, target: number): number {
  return edgeTo(mesh, i, target);
}
