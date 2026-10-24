import type { PhysicalMesh, TriangleCoord } from "./mesh";

const key = (p: TriangleCoord) => `${p.u}:${p.v}:${Number(p.inverted)}`;

export function worldLattice(
  width: number,
  height: number,
  samples: number,
  padding: number,
  wrap: boolean,
  poles: boolean
) {
  const desired = Math.sqrt(
    ((width + 2 * padding) * (height + 2 * padding)) / ((samples * 3 * Math.sqrt(3)) / 4)
  );
  const columns = Math.max(1, Math.round(width / (3 * desired)));
  const spacing = wrap ? width / (3 * columns) : desired;
  const rows = Math.max(1, Math.round(height / (Math.sqrt(3) * spacing)));
  return { columns, spacing, rows, spacingY: poles ? height / (Math.sqrt(3) * rows) : spacing };
}

export function joinWorldEdges(
  mesh: PhysicalMesh,
  lattice: ReturnType<typeof worldLattice>,
  poles: boolean
) {
  const { columns, rows, spacingY } = lattice;
  const width = mesh.bounds[2] - mesh.bounds[0];
  mesh.periodic = { width, columns, ...(poles ? { poles: { rows, spacingY } } : {}) };
  mesh.coords.forEach((p, i) => {
    for (const direction of [-1, 0, 1])
      mesh.indexes.set(
        key({ ...p, u: p.u + direction * columns, v: p.v + direction * columns }),
        i
      );
  });
}
