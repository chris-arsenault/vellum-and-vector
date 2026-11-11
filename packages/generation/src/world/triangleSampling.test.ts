import { expect, it, vi } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { physicalSampler } from "./physicalMetric";
import { nearestTriangle } from "./mesh";
import { triangleVertexMembership } from "./triangleVertices";
import {
  triangleSample,
  triangleValue,
  triangleFans,
  triangleBoundary,
  triangleVectorSampler,
} from "./triangleSampling";

const mesh = createWorldMesh([2e6, 3e6, 2.2e6, 3.1e6], 1024, 30_000);

it("reuses scalar mesh topology while reading changed terrain values", () => {
  const local = createWorldMesh([-100, -100, 100, 100], 64, 0),
    values = new Float64Array(local.count).fill(10),
    sample = physicalSampler(local, values),
    cell = local.cellAt(0, 0),
    x = local.x(cell) + local.spacing * 0.1,
    y = local.y(cell),
    address = vi.spyOn(local, "address"),
    locate = vi.spyOn(local, "cellAt");
  expect(sample(x, y)).toBe(10);
  expect(address).toHaveBeenCalledOnce();
  values.fill(-7);
  expect(sample(x, y)).toBe(-7);
  expect(address).toHaveBeenCalledOnce();
  expect(locate).toHaveBeenCalledOnce();
  address.mockRestore();
  locate.mockRestore();
});

it("captures fixed vector values once and renews them for the next sampling interval", () => {
  const xs = new Float64Array(mesh.count).fill(10),
    readX = vi.fn((i: number) => xs[i]),
    sample = triangleVectorSampler(mesh, readX, () => -5, { fixed: true });
  expect(readX).toHaveBeenCalledTimes(mesh.count);
  expect(sample(0, 0)).toEqual([10, -5]);
  xs.fill(20);
  expect(sample(1, 1)).toEqual([10, -5]);
  expect(readX).toHaveBeenCalledTimes(mesh.count);
  expect(triangleVectorSampler(mesh, readX, () => 3, { fixed: true })(1, 1)).toEqual([20, 3]);
});
it("uses a coherent cell hint for nearby samples and falls back for distant positions", () => {
  const local = createWorldMesh([-100, -100, 100, 100], 64, 0),
    cell = local.cellAt(0, 0),
    sample = triangleVectorSampler(
      local,
      (i) => local.x(i),
      (i) => local.y(i),
      { fixed: true }
    ),
    locate = vi.spyOn(local, "cellAt"),
    x = local.x(cell),
    y = local.y(cell);
  expect(sample(x, y)[0]).toBeCloseTo(x);
  expect(sample(x + local.spacing * 0.1, y)[0]).toBeCloseTo(x + local.spacing * 0.1);
  expect(locate).toHaveBeenCalledOnce();
  expect(sample(70, 0)[0]).toBeCloseTo(70);
  expect(locate.mock.calls.length).toBeGreaterThan(1);
  locate.mockRestore();
});
it("joins fixed vector samples continuously while hints cross triangle faces", () => {
  const sample = triangleVectorSampler(
    mesh,
    (i) => Math.sin(i) * 100,
    (i) => Math.cos(i) * 50,
    { fixed: true }
  );
  for (let cell = 0; cell < mesh.count; cell++) {
    if (mesh.membership(cell) !== 1) continue;
    for (let edge = 0; edge < 3; edge++) {
      const neighbor = mesh.neighbor(cell, edge),
        x = (mesh.x(cell) + mesh.x(neighbor)) / 2,
        y = (mesh.y(cell) + mesh.y(neighbor)) / 2,
        dx = (mesh.x(neighbor) - mesh.x(cell)) * 1e-8,
        dy = (mesh.y(neighbor) - mesh.y(cell)) * 1e-8,
        before = sample(x - dx, y - dy),
        after = sample(x + dx, y + dy);
      expect(before[0]).toBeCloseTo(after[0], 3);
      expect(before[1]).toBeCloseTo(after[1], 3);
    }
  }
});

it("retains incident topology per corner without repeating lattice address work", () => {
  const local = createWorldMesh([-100, -100, 100, 100], 64, 0),
    membership = triangleVertexMembership(local),
    address = vi.spyOn(local, "address"),
    cell = local.cellAt(0, 0),
    members = membership(cell, 0);
  expect(members.length).toBe(6);
  expect(address).toHaveBeenCalledOnce();
  expect(Array.from(members)).toContain(cell);
  expect(new Set(Array.from(members)).size).toBe(members.length);
  membership(cell, 0);
  expect(address).toHaveBeenCalledOnce();
  membership(cell, 1);
  expect(address).toHaveBeenCalledTimes(2);
  address.mockRestore();
});

it.each([
  [false, false],
  [true, false],
  [true, true],
])("keeps live vector values at open/periodic boundaries (%s, %s)", (wrapX, closePoles) => {
  const local = createWorldMesh(
      [-100, -100, 100, 100],
      64,
      0,
      undefined,
      undefined,
      undefined,
      wrapX,
      closePoles
    ),
    xs = new Float64Array(local.count).fill(15),
    ys = new Float64Array(local.count).fill(-7),
    sample = triangleVectorSampler(
      local,
      (i) => xs[i],
      (i) => ys[i]
    );
  for (const point of [
    [-99, -99],
    [99, 99],
    [99, -99],
    [-99, 99],
    [0, 0],
  ]) {
    expect(sample(point[0], point[1])).toEqual([15, -7]);
  }
  xs.fill(-3);
  ys.fill(5);
  for (const point of [
    [-99, -99],
    [99, 99],
    [99, -99],
    [-99, 99],
    [0, 0],
  ]) {
    expect(sample(point[0], point[1])).toEqual([-3, 5]);
  }
});

it("samples independent vector components over one shared physical neighborhood", () => {
  const xValue = (x: number, y: number) => 20 + 0.002 * x - 0.003 * y,
    yValue = (x: number, y: number) => -10 - 0.004 * x + 0.001 * y,
    sample = triangleVectorSampler(
      mesh,
      (i) => xValue(mesh.x(i), mesh.y(i)),
      (i) => yValue(mesh.x(i), mesh.y(i))
    );
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) !== 1) continue;
    const x = mesh.x(i) + mesh.spacing * 0.12,
      y = mesh.y(i) - mesh.spacing * 0.17,
      vector = sample(x, y);
    expect(vector[0]).toBeCloseTo(xValue(x, y), 8);
    expect(vector[1]).toBeCloseTo(yValue(x, y), 8);
  }
});

it("preserves constant decimal fields in sampling, fan vertices and boundary closure", () => {
  const value = 0.1,
    values = new Float64Array(mesh.count).fill(value),
    sample = physicalSampler(mesh, values);
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) !== 1) continue;
    const x = mesh.x(i) + mesh.spacing * 0.12,
      y = mesh.y(i) - mesh.spacing * 0.17;
    expect(sample(x, y)).toBe(value);
    expect(triangleValue(triangleSample(mesh, x, y), values)).toBe(value);
  }
  for (const samples of [
    triangleFans(
      mesh,
      Array.from({ length: mesh.count }, (_, i) => i),
      () => value
    ),
    triangleBoundary(mesh, () => value),
  ])
    for (const segment of samples) for (const station of segment) expect(station[2]).toBe(value);
});

it("reproduces physical planes at subcell positions and retains exact centre samples", () => {
  const plane = (x: number, y: number) => 700 + x * 0.003 - y * 0.001;
  const values = Float64Array.from({ length: mesh.count }, (_, i) => plane(mesh.x(i), mesh.y(i))),
    sample = physicalSampler(mesh, values);
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) !== 1) continue;
    expect(sample(mesh.x(i), mesh.y(i))).toBeCloseTo(values[i], 8);
    const x = mesh.x(i) + mesh.spacing * 0.12,
      y = mesh.y(i) - mesh.spacing * 0.17;
    expect(sample(x, y)).toBeCloseTo(plane(x, y), 8);
    expect(triangleValue(triangleSample(mesh, x, y), values)).toBeCloseTo(plane(x, y), 8);
  }
});

it("joins arbitrary terrain continuously across every triangle face without inventing extrema", () => {
  const values = Float64Array.from({ length: mesh.count }, (_, i) => Math.sin(i * 1.7) * 2000),
    sample = physicalSampler(mesh, values);
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) !== 1) continue;
    for (let edge = 0; edge < 3; edge++) {
      const j = mesh.neighbor(i, edge),
        x = (mesh.x(i) + mesh.x(j)) / 2,
        y = (mesh.y(i) + mesh.y(j)) / 2,
        dx = (mesh.x(j) - mesh.x(i)) * 1e-8,
        dy = (mesh.y(j) - mesh.y(i)) * 1e-8;
      expect(sample(x + dx, y + dy)).toBeCloseTo(sample(x - dx, y - dy), 3);
      expect(Math.abs(sample(x, y))).toBeLessThanOrEqual(2000);
    }
  }
});

it("locates the nearest triangle on translated lattices without scanning the world", () => {
  const shifted = createWorldMesh([0, 0, 100, 100], 64, 100_000, () => true);
  const points = Array.from({ length: 200 }, (_, i) => [
    Math.sin(i * 1.7) * 80_000,
    Math.cos(i * 0.7) * 80_000,
  ]);
  for (const [x, y] of [[0, 0], [100, 100], [-10_000, 20_000], [30_000, -40_000], ...points]) {
    let expected = -1,
      distance = Infinity;
    for (let i = 0; i < shifted.count; i++) {
      if (shifted.membership(i) === 0) continue;
      const d = (shifted.x(i) - x) ** 2 + (shifted.y(i) - y) ** 2;
      if (d < distance) {
        expected = i;
        distance = d;
      }
    }
    const actual = nearestTriangle(shifted, x, y);
    expect((shifted.x(actual) - x) ** 2 + (shifted.y(actual) - y) ** 2).toBeCloseTo(distance, 5);
    expect(expected).toBeGreaterThanOrEqual(0);
  }
});
