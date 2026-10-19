import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { nearestTriangle } from "./mesh";

it("aligns a small world with the existing physical lattice without shrinking its halo", () => {
  for (const samples of [16384, 65536, 262144]) {
    const mesh = createWorldMesh([0, 0, 1000, 1000], samples, 100_000),
      expectedSpacing = Math.sqrt(201_000 ** 2 / (samples * ((3 * Math.sqrt(3)) / 4)));
    expect(mesh.contentCount).toBeGreaterThan(0);
    expect(mesh.spacing).toBe(expectedSpacing);
    expect(mesh.workRadius).toBe(Math.hypot(100_500, 100_500));
    expect(mesh.areas.slice(0, mesh.contentCount).reduce((sum, area) => sum + area, 0)).toBeCloseTo(
      1_000_000,
      6
    );
    const center = nearestTriangle(mesh, 0, 0);
    expect(center).toBeGreaterThanOrEqual(0);
    expect(center).toBeLessThan(mesh.contentCount);
    for (let i = 0; i < mesh.contentCount; i++)
      expect(nearestTriangle(mesh, mesh.x[i], mesh.y[i])).toBe(i);
  }
});

it("supports a narrow extent without increasing its sample density", () => {
  const mesh = createWorldMesh([0, 0, 100, 1_000_000], 16384, 100_000);
  expect(mesh.contentCount).toBeGreaterThan(0);
  expect(mesh.spacing).toBeGreaterThan(100);
  expect(mesh.areas.slice(0, mesh.contentCount).reduce((sum, area) => sum + area, 0)).toBeCloseTo(
    100_000_000,
    4
  );
  for (const y of [-500_000, 0, 500_000]) {
    const i = nearestTriangle(mesh, 0, y);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(mesh.x[i], mesh.y[i] - y)).toBeLessThan(mesh.spacing);
  }
});

it("can align an unsampled irregular footprint at a supplied covered point", () => {
  const covers = (x: number, y: number) =>
    (x >= 0 && x <= 1 && y >= 0 && y <= 1) || (x >= 999 && x <= 1000 && y >= 999 && y <= 1000);
  const mesh = createWorldMesh([0, 0, 1000, 1000], 16384, 100_000, covers, 2, [0.5, 0.5]);
  expect(mesh.contentCount).toBeGreaterThan(0);
  const i = nearestTriangle(mesh, -499.5, -499.5);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(i).toBeLessThan(mesh.contentCount);
  expect(mesh.x[i] + mesh.origin[0]).toBeCloseTo(0.5, 8);
  expect(mesh.y[i] + mesh.origin[1]).toBeCloseTo(0.5, 8);
  expect(mesh.areas.slice(0, mesh.contentCount).reduce((sum, area) => sum + area, 0)).toBe(2);
});

it("preserves the existing lattice when the footprint already contains samples", () => {
  const original = createWorldMesh([0, 0, 100_000, 100_000], 1024, 100_000);
  const supplied = createWorldMesh(
    [0, 0, 100_000, 100_000],
    1024,
    100_000,
    () => true,
    10_000_000_000,
    [0, 0]
  );
  expect(supplied.latticeOffset).toEqual([0, 0]);
  expect(supplied.x).toEqual(original.x);
  expect(supplied.y).toEqual(original.y);
  expect(supplied.contentCount).toBe(original.contentCount);
});
