import { expect, it, vi } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { advectGeologicalTrace, geologicalPointMotion } from "./geologicalPointMotion";
import { unwrapCoordinates } from "@atlas/domain";

const mesh = createWorldMesh([-100, -100, 100, 100], 64, 0);
it("integrates constant local motion and leaves stationary points without repeated sampling", () => {
  expect(geologicalPointMotion(mesh, () => [1000, -500], 20)(0, 0)).toEqual([20, -10]);
  const stationary = vi.fn((): [number, number] => [0, 0]);
  expect(geologicalPointMotion(mesh, stationary, 1000)(10, 20)).toEqual([10, 20]);
  expect(stationary).toHaveBeenCalledOnce();
  const slow = vi.fn((x: number): [number, number] => [x > 50 ? 100000 : 1, 0]);
  expect(geologicalPointMotion(mesh, slow, 10)(0, 0)[0]).toBeCloseTo(0.01);
  expect(slow).toHaveBeenCalledTimes(2);
});
it("reduces a step when its midpoint enters faster flow", () => {
  const local = createWorldMesh([-16, -16, 16, 16], 64, 0),
    moved = geologicalPointMotion(local, (x) => [x < 1 ? 1000 : 4000, 0], 2)(0, 0);
  expect(moved[0]).toBeGreaterThan(4);
  expect(moved[0]).toBeLessThan(6);
  expect(moved[1]).toBe(0);
});
it("resolves long reaches while removing detail compressed below the field resolution", () => {
  const source: [number, number][] = Array.from({ length: 41 }, (_, i) => [
      i * 4 - 80,
      i % 2 ? 8 : 0,
    ]),
    moved = advectGeologicalTrace(mesh, source, (x, y) => [x * 0.01, y * 0.01]);
  expect(moved[0][0]).toBeCloseTo(-0.8);
  expect(moved.at(-1)![0]).toBeCloseTo(0.8);
  expect(moved.length).toBeLessThan(source.length / 2);
});
it("keeps meaningful bends and samples the shortest periodic chart", () => {
  const bent = advectGeologicalTrace(
    mesh,
    [
      [-80, 0],
      [0, 40],
      [80, 0],
    ],
    (x, y) => [x, y]
  );
  expect(bent).toContainEqual([0, 40]);
  const periodic = createWorldMesh(
      [-100, -100, 100, 100],
      64,
      0,
      undefined,
      undefined,
      undefined,
      true
    ),
    visited: number[] = [],
    seam = advectGeologicalTrace(
      periodic,
      [
        [95, 0],
        [-95, 0],
      ],
      (x, y) => {
        visited.push(x);
        return [x, y];
      }
    );
  expect(seam[0]).toEqual([95, 0]);
  expect(seam.at(-1)).toEqual([-95, 0]);
  expect(visited.every((x) => Math.abs(x) >= 95)).toBe(true);
});
it("retains the long cylindrical reach after storing wrapped stations", () => {
  const periodic = createWorldMesh(
      [-100, -100, 100, 100],
      64,
      0,
      undefined,
      undefined,
      undefined,
      true
    ),
    moved = advectGeologicalTrace(
      periodic,
      [
        [-90, 0],
        [0, 0],
        [90, 0],
      ],
      (x, y) => [x, y]
    ),
    continuous = unwrapCoordinates(moved, 200);
  expect(continuous.at(-1)![0] - continuous[0][0]).toBeCloseTo(180);
  expect(continuous.some(([x]) => Math.abs(x) < 30)).toBe(true);
  for (let i = 1; i < moved.length; i++)
    expect(Math.abs(periodic.deltaX(moved[i][0] - moved[i - 1][0]))).toBeLessThan(100);
});
it("reflects local point motion at a closed latitude edge", () => {
  const polar = createWorldMesh(
      [-100, -100, 100, 100],
      64,
      0,
      undefined,
      undefined,
      undefined,
      true,
      true
    ),
    moved = geologicalPointMotion(polar, () => [0, 1000], 2)(10, 99);
  expect(moved[0]).toBeCloseTo(10);
  expect(moved[1]).toBeCloseTo(99);
});
