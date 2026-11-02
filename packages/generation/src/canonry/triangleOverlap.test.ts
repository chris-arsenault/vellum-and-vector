import { expect, it } from "vitest";
import { triangleOverlap } from "./triangleOverlap";
import { createWorldMesh } from "./worldMesh";

it("covers the source cell alone when nothing moved, and partitions a moved cell over its targets", () => {
  const mesh = createWorldMesh([0, 0, 8000, 8000], 64, 0),
    cells = Array.from({ length: mesh.count }, (_, i) => i),
    // A cell well inside the frame.
    source = cells.reduce((a, b) =>
      Math.hypot(mesh.x(b) - 300, mesh.y(b) - 200) < Math.hypot(mesh.x(a) - 300, mesh.y(a) - 200)
        ? b
        : a
    );
  const still = triangleOverlap(mesh, source, mesh.x(source), mesh.y(source))!;
  expect(still.length).toBe(1);
  expect(still[0][0]).toBe(source);
  expect(still[0][1]).toBeCloseTo(1, 9);
  // Moved by a fraction of a cell in both directions, the cell's area lands on several
  // neighbours and the fractions still account for all of it.
  const dx = mesh.spacing * 0.4,
    dy = mesh.spacing * 0.3,
    moved = triangleOverlap(mesh, source, mesh.x(source) + dx, mesh.y(source) + dy)!;
  expect(moved.length).toBeGreaterThan(1);
  expect(moved.reduce((sum, [, share]) => sum + share, 0)).toBeCloseTo(1, 6);
  for (const [cell, share] of moved) {
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThanOrEqual(1 + 1e-9);
    expect(
      Math.hypot(mesh.x(cell) - mesh.x(source) - dx, mesh.y(cell) - mesh.y(source) - dy)
    ).toBeLessThan(mesh.spacing * 2.5);
  }
});
