import { triangleAddress, triangleIndex, type PhysicalMesh } from "./mesh";

export interface TriangleVertex {
  position: [number, number];
  members: number[];
}
/** Six incident lattice triangles, derived locally instead of indexing every world vertex. */
export function triangleVertex(mesh: PhysicalMesh, cell: number, corner: number): TriangleVertex {
  const [u, v, inverted] = triangleAddress(mesh, cell),
    sign = inverted ? -1 : 1;
  const x = 3 * (u + v) + (inverted ? 4 : 2) + (corner === 0 ? -2 * sign : sign);
  const y = -u + v + (corner === 0 ? 0 : corner === 1 ? -1 : 1);
  const a = (x / 3 - y) / 2,
    b = (x / 3 + y) / 2;
  const candidates = [
    [a, b, false],
    [a - 1, b, false],
    [a, b - 1, false],
    [a - 1, b - 1, true],
    [a, b - 1, true],
    [a - 1, b, true],
  ] as const;
  const members = [
    ...new Set(
      candidates.flatMap(([u, v, inverted]) => {
        const index = triangleIndex(mesh, u, v, inverted);
        return index < 0 ? [] : [index];
      })
    ),
    // hpc-exempt: at most six fan members.
  ].sort((left, right) => left - right);
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
