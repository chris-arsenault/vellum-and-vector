import { expect, it } from "vitest";
import { createWorldMesh } from "../../generation/src/canonry/worldMesh";
import { nearestTriangle, triangleAddress, triangleIndex } from "../../generation/src/canonry/mesh";
import {
  triangleSampler,
  triangleSample,
  triangleValue,
} from "../../generation/src/canonry/triangleSampling";
import {
  projectionInterpolation,
  projectedValues,
} from "../../generation/src/canonry/atlasSampling";
import { createField } from "../../generation/src/canonry/field";
import { atlasPhysicalProfile } from "../../generation/src/canonry/atlasProfile";
import { arenaFixture } from "./numericalFixture";
import { blockCacheFixture } from "./blockCacheFixture";

it.each([
  [false, false],
  [true, false],
  [true, true],
])("constructs a long mesh with wrap=%s poles=%s and connected metric faces", (wrap, poles) => {
  const bounds: [number, number, number, number] = [0, 0, 10_000_000, 100_000_000];
  const start = performance.now();
  const mesh = createWorldMesh(bounds, 4096, 0, () => true, 1e15, undefined, wrap, poles);
  const constructionMs = performance.now() - start;
  let contentArea = 0;
  for (let i = 0; i < mesh.count; i++) contentArea += mesh.contentArea(i);
  expect(contentArea / 1e15).toBeCloseTo(1, 10);
  for (let i = 0; i < mesh.count; i += 17) {
    const [u, v, inverted] = triangleAddress(mesh, i);
    expect(triangleIndex(mesh, u, v, inverted)).toBe(i);
    expect(nearestTriangle(mesh, mesh.x(i), mesh.y(i))).toBe(i);
    if (mesh.periodic)
      expect(
        triangleIndex(mesh, u + mesh.periodic.columns, v + mesh.periodic.columns, inverted)
      ).toBe(i);
    for (let edge = 0; edge < 3; edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0) continue;
      expect(Array.from({ length: mesh.degree(j) }, (_, e) => mesh.neighbor(j, e))).toContain(i);
      expect(mesh.edgeLength(i, edge)).toBeGreaterThan(0);
    }
  }
  const sample = triangleSampler(mesh, () => 0.1);
  expect(sample(0, 0)).toBe(0.1);
  console.info("connected mesh", { wrap, poles, cells: mesh.count, constructionMs });
});
it("reuses file-backed interpolation across channels and mathematical block boundaries", () => {
  const f = blockCacheFixture(262_144),
    projection = arenaFixture(262_144, 512);
  try {
    const mesh = createWorldMesh(
      [0, 0, 400_000, 200_000],
      256,
      0,
      () => true,
      8e10,
      undefined,
      true,
      true
    );
    const count = 8201,
      position = (i: number): [number, number] => [
        mesh.x(i % mesh.count) + mesh.spacing * 0.23,
        mesh.y(i % mesh.count) - mesh.spacing * 0.17,
      ];
    const interpolation = projectionInterpolation(mesh, count, position, projection.arena);
    const map = createField(mesh, f.cache);
    const work = {
      map,
      samples: interpolation.samples,
      interpolation,
      profile: atlasPhysicalProfile(),
      fixed: [],
      inherited: false,
      sampling: { maximumSize: 1000, minimumSize: 1000, featureSamples: 2 },
    };
    const input = (i: number) => 0.1 + mesh.x(i) * 0.003 - mesh.y(i) * 0.001;
    const result = projectedValues(work, input);
    result.retain?.();
    projection.arena.flush();
    projection.arena.releaseProcess();
    map.coverage.releaseProcess();
    for (const i of [0, 1, 4095, 4096, 8200]) {
      const [x, y] = position(i),
        sample = triangleSample(mesh, x, y);
      const values = sample.cells.map((cell) => input(cell));
      const expected = triangleValue({ ...sample, cells: values.map((_, j) => j) }, values);
      expect(result[i]).toBeCloseTo(expected, 10);
    }
    expect(projection.arena.stats.reads).toBeGreaterThan(0);
    expect(projection.arena.stats.peakDecodedBytes).toBeLessThanOrEqual(262_144);
  } finally {
    f.close();
    projection.close();
  }
});
