import { expect, it } from "vitest";
import { createAdaptiveWorldLattice, createWorldLattice, forEachCell, nodata } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { nearestTriangle, triangleIdentity } from "./mesh";
import type { PhysicalMesh } from "./mesh";

/** The arithmetic lattice reproduces the stored world mesh cell for cell. */
function compare(mesh: PhysicalMesh, lattice: ReturnType<typeof createWorldLattice>) {
  expect(lattice.contentCount).toBe(mesh.contentCount);
  let live = 0;
  forEachCell(lattice, () => live++);
  expect(live).toBe(mesh.count);
  for (let i = 0; i < mesh.count; i += 7) {
    const cell = lattice.addressCell(mesh.coordU[i], mesh.coordV[i], !!mesh.coordInverted[i]);
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(lattice.membership(cell)).not.toBe(nodata);
    expect(lattice.membership(cell) === 1).toBe(i < mesh.contentCount);
    expect(lattice.x(cell)).toBeCloseTo(mesh.x[i], 6);
    expect(lattice.y(cell)).toBeCloseTo(mesh.y[i], 6);
    expect(lattice.area(cell)).toBeCloseTo(mesh.areas[i], 6);
    expect(lattice.contentArea(cell)).toBeCloseTo(mesh.contentAreas[i], 6);
    expect(lattice.boundary(cell)).toBe(!!mesh.boundary[i]);
    expect(lattice.identity(cell)).toBe(triangleIdentity(mesh, i));
    expect(lattice.cellAt(mesh.x[i], mesh.y[i])).toBe(cell);
    expect(nearestTriangle(mesh, lattice.x(cell), lattice.y(cell))).toBe(i);
    for (let edge = 0; edge < 3; edge++) {
      const j = mesh.neighbors[i * 3 + edge],
        k = lattice.neighbor(cell, edge);
      if (j < 0) {
        expect(k).toBe(-1);
        expect(lattice.faceLength(cell, edge)).toBeCloseTo(mesh.faceLength[i * 3 + edge], 6);
        continue;
      }
      expect(k).toBe(lattice.addressCell(mesh.coordU[j], mesh.coordV[j], !!mesh.coordInverted[j]));
      expect(lattice.edgeLength(cell, edge)).toBeCloseTo(mesh.edgeLength[i * 3 + edge], 6);
      expect(lattice.edgeX(cell, edge)).toBeCloseTo(mesh.edgeX[i * 3 + edge], 5);
      expect(lattice.edgeY(cell, edge)).toBeCloseTo(mesh.edgeY[i * 3 + edge], 5);
      expect(lattice.faceLength(cell, edge)).toBeCloseTo(mesh.faceLength[i * 3 + edge], 6);
      expect(lattice.faceDistance(cell, edge)).toBeCloseTo(mesh.faceDistance[i * 3 + edge], 6);
    }
  }
}
it("matches the open world mesh", () => {
  const bounds: [number, number, number, number] = [-1_500_000, -1_000_000, 1_500_000, 1_000_000],
    covers = (x: number, y: number) => Math.hypot(x / 1_500_000, y / 1_000_000) <= 1.2;
  const mesh = createWorldMesh(bounds, 4000, 100_000, covers, 5e12, [0, 0]),
    lattice = createWorldLattice(bounds, 4000, 100_000, { covers, area: 5e12, anchor: [0, 0] });
  compare(mesh, lattice);
});
it("matches the wrapped world mesh with open and closed poles", () => {
  const bounds: [number, number, number, number] = [0, 0, 4_000_000, 2_000_000];
  for (const closePoles of [false, true]) {
    const mesh = createWorldMesh(
        bounds,
        3000,
        100_000,
        undefined,
        undefined,
        undefined,
        true,
        closePoles
      ),
      lattice = createWorldLattice(bounds, 3000, 100_000, { wrapX: true, closePoles });
    compare(mesh, lattice);
    expect(lattice.periodic).toEqual(mesh.periodic);
  }
});
it("matches the adaptive region mesh including its seam", () => {
  const bounds: [number, number, number, number] = [-100_000, -50_000, 100_000, 50_000],
    sampling = {
      maximumSize: 12_500,
      minimumSize: 3125,
      refine: ([x, y]: number[]) => x < 0 && y < 0,
    };
  for (const wrapX of [false, true]) {
    const mesh = createAdaptiveWorldMesh(bounds, sampling, 10_000, undefined, wrapX),
      lattice = createAdaptiveWorldLattice(bounds, sampling, 10_000, undefined, wrapX);
    expect(lattice.count).toBe(mesh.count);
    expect(lattice.contentCount).toBe(mesh.contentCount);
    expect(lattice.stride).toBe(mesh.stride);
    for (let i = 0; i < mesh.count; i += 3) {
      expect(lattice.x(i)).toBe(mesh.x[i]);
      expect(lattice.y(i)).toBe(mesh.y[i]);
      expect(lattice.area(i)).toBe(mesh.areas[i]);
      expect(lattice.boundary(i)).toBe(!!mesh.boundary[i]);
      expect(lattice.degree(i)).toBe(mesh.degree[i]);
      for (let edge = 0; edge < mesh.degree[i]; edge++) {
        const at = i * mesh.stride + edge;
        expect(lattice.neighbor(i, edge)).toBe(mesh.neighbors[at]);
        expect(lattice.edgeLength(i, edge)).toBe(mesh.edgeLength[at]);
        expect(lattice.faceLength(i, edge)).toBe(mesh.faceLength[at]);
      }
      expect(lattice.cellAt(mesh.x[i], mesh.y[i])).toBe(
        nearestTriangle(mesh, mesh.x[i], mesh.y[i])
      );
    }
  }
});
