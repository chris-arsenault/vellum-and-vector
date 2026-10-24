import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { physicalSampler } from "./physicalMetric";
import { nearestTriangle } from "./mesh";
import { triangleSample, triangleValue, triangleFans, triangleBoundary } from "./triangleSampling";

const mesh = createWorldMesh([2e6, 3e6, 2.2e6, 3.1e6], 1024, 30_000);

it("preserves constant decimal fields in sampling, fan vertices and boundary closure", () => {
  const value = 0.1,
    values = new Float64Array(mesh.count).fill(value),
    sample = physicalSampler(mesh, values);
  for (let i = 0; i < mesh.contentCount; i++) {
    const x = mesh.x[i] + mesh.spacing * 0.12,
      y = mesh.y[i] - mesh.spacing * 0.17;
    expect(sample(x, y)).toBe(value);
    expect(triangleValue(triangleSample(mesh, x, y), values)).toBe(value);
  }
  for (const samples of [
    triangleFans(mesh, [...mesh.x.keys()], () => value),
    triangleBoundary(mesh, () => value),
  ])
    for (const segment of samples) for (const station of segment) expect(station[2]).toBe(value);
});

it("reproduces physical planes at subcell positions and retains exact centre samples", () => {
  const plane = (x: number, y: number) => 700 + x * 0.003 - y * 0.001;
  const values = Float64Array.from(mesh.x, (x, i) => plane(x, mesh.y[i])),
    sample = physicalSampler(mesh, values);
  for (let i = 0; i < mesh.contentCount; i++) {
    expect(sample(mesh.x[i], mesh.y[i])).toBeCloseTo(values[i], 8);
    const x = mesh.x[i] + mesh.spacing * 0.12,
      y = mesh.y[i] - mesh.spacing * 0.17;
    expect(sample(x, y)).toBeCloseTo(plane(x, y), 8);
    expect(triangleValue(triangleSample(mesh, x, y), values)).toBeCloseTo(plane(x, y), 8);
  }
});

it("joins arbitrary terrain continuously across every triangle face without inventing extrema", () => {
  const values = Float64Array.from(mesh.x, (_, i) => Math.sin(i * 1.7) * 2000),
    sample = physicalSampler(mesh, values);
  for (let i = 0; i < mesh.contentCount; i++)
    for (let edge = 0; edge < 3; edge++) {
      const j = mesh.neighbors[i * 3 + edge],
        x = (mesh.x[i] + mesh.x[j]) / 2,
        y = (mesh.y[i] + mesh.y[j]) / 2,
        dx = (mesh.x[j] - mesh.x[i]) * 1e-8,
        dy = (mesh.y[j] - mesh.y[i]) * 1e-8;
      expect(sample(x + dx, y + dy)).toBeCloseTo(sample(x - dx, y - dy), 3);
      expect(Math.abs(sample(x, y))).toBeLessThanOrEqual(2000);
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
      const d = (shifted.x[i] - x) ** 2 + (shifted.y[i] - y) ** 2;
      if (d < distance) {
        expected = i;
        distance = d;
      }
    }
    const actual = nearestTriangle(shifted, x, y);
    expect((shifted.x[actual] - x) ** 2 + (shifted.y[actual] - y) ** 2).toBeCloseTo(distance, 5);
    expect(expected).toBeGreaterThanOrEqual(0);
  }
});
