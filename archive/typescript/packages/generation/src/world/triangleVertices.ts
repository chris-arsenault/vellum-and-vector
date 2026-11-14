import { triangleAddress, triangleIndex, type PhysicalMesh } from "./mesh";

export interface TriangleVertex {
  position: [number, number];
  members: number[];
}
/** Insert into a sorted fan of at most six members, skipping absent cells and repeats. */
function addMember(members: number[], cell: number) {
  if (cell < 0) return;
  let at = members.length;
  while (at > 0 && members[at - 1] > cell) at--;
  if (at > 0 && members[at - 1] === cell) return;
  members.splice(at, 0, cell);
}
/** Six incident lattice triangles, derived locally instead of indexing every world vertex. */
export function triangleVertex(mesh: PhysicalMesh, cell: number, corner: number): TriangleVertex {
  const [u, v, inverted] = triangleAddress(mesh, cell),
    sign = inverted ? -1 : 1;
  const x = 3 * (u + v) + (inverted ? 4 : 2) + (corner === 0 ? -2 * sign : sign);
  const y = -u + v + (corner === 0 ? 0 : corner === 1 ? -1 : 1);
  const a = (x / 3 - y) / 2,
    b = (x / 3 + y) / 2;
  const members: number[] = [];
  addMember(members, triangleIndex(mesh, a, b, false));
  addMember(members, triangleIndex(mesh, a - 1, b, false));
  addMember(members, triangleIndex(mesh, a, b - 1, false));
  addMember(members, triangleIndex(mesh, a - 1, b - 1, true));
  addMember(members, triangleIndex(mesh, a, b - 1, true));
  addMember(members, triangleIndex(mesh, a - 1, b, true));
  return {
    members,
    position: [
      (x * mesh.spacing) / 2 + mesh.latticeOffset[0] + mesh.origin[0],
      (y * Math.sqrt(3) * (mesh.periodic?.poles?.spacingY ?? mesh.spacing)) / 2 +
        mesh.latticeOffset[1] +
        mesh.origin[1],
    ],
  };
}

/** Sampler-owned topology only: each triangle corner has at most six incident cells. */
export function triangleVertexMembership(mesh: PhysicalMesh) {
  const degree = new Uint8Array(mesh.count * 3),
    cells = new Int32Array(mesh.count * 3 * 6);
  return (cell: number, corner: number): ArrayLike<number> => {
    const row = cell * 3 + corner,
      offset = row * 6;
    if (degree[row] === 0) {
      const members = triangleVertex(mesh, cell, corner).members;
      cells.set(members, offset);
      // Zero means unvisited; an empty clipped neighborhood is still a cached result.
      degree[row] = members.length + 1;
    }
    return cells.subarray(offset, offset + degree[row] - 1);
  };
}
