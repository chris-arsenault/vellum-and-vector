import type { PhysicalMesh } from "./mesh";

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
}
