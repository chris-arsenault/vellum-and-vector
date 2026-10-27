import { closeSync, fsyncSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createWorldMesh } from "../../generation/src/canonry/worldMesh";
import { nearestTriangle, triangleIndex } from "../../generation/src/canonry/mesh";
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
import { PagedArena } from "./pagedArena";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "atlas-mesh-")),
    fd = openSync(join(directory, "work.bin"), "w+");
  const arena = new PagedArena(
    {
      read: (bytes, offset) => readSync(fd, bytes, 0, bytes.byteLength, offset),
      write: (bytes, offset) => writeSync(fd, bytes, 0, bytes.byteLength, offset),
      flush: () => fsyncSync(fd),
      close: () => closeSync(fd),
    },
    262_144,
    512
  );
  return {
    arena,
    close() {
      arena.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
it.each([
  [false, false],
  [true, false],
  [true, true],
])(
  "constructs a file-backed long mesh with wrap=%s poles=%s and connected metric faces",
  (wrap, poles) => {
    const f = fixture(),
      bounds: [number, number, number, number] = [0, 0, 10_000_000, 100_000_000];
    try {
      const start = performance.now();
      const mesh = createWorldMesh(
        bounds,
        4096,
        0,
        () => true,
        1e15,
        undefined,
        wrap,
        poles,
        f.arena
      );
      const constructionMs = performance.now() - start;
      f.arena.flush();
      f.arena.releaseProcess();
      expect(Array.isArray(mesh.coords)).toBe(false);
      expect(mesh.indexes instanceof Map).toBe(false);
      expect(mesh.contentAreas.reduce((sum, area) => sum + area, 0) / 1e15).toBeCloseTo(1, 10);
      for (let i = 0; i < mesh.count; i += 17) {
        const p = mesh.coords[i];
        expect(triangleIndex(mesh, p.u, p.v, p.inverted)).toBe(i);
        expect(nearestTriangle(mesh, mesh.x[i], mesh.y[i])).toBe(i);
        if (mesh.periodic)
          expect(
            triangleIndex(
              mesh,
              p.u + mesh.periodic.columns,
              p.v + mesh.periodic.columns,
              p.inverted
            )
          ).toBe(i);
        for (let edge = 0; edge < 3; edge++) {
          const j = mesh.neighbors[i * 3 + edge];
          if (j < 0) continue;
          expect(mesh.neighbors.subarray(j * 3, j * 3 + 3).includes(i)).toBe(true);
          expect(mesh.edgeLength[i * 3 + edge]).toBeGreaterThan(0);
        }
      }
      const sample = triangleSampler(mesh, () => 0.1);
      expect(sample(0, 0)).toBe(0.1);
      expect(f.arena.stats.reads).toBeGreaterThan(0);
      expect(f.arena.stats.peakDecodedBytes).toBeLessThanOrEqual(262_144);
      console.info("file-backed connected mesh", {
        wrap,
        poles,
        cells: mesh.count,
        constructionMs,
        ...f.arena.stats,
      });
    } finally {
      f.close();
    }
  }
);
it("reuses file-backed interpolation across channels and mathematical block boundaries", () => {
  const f = fixture();
  try {
    const mesh = createWorldMesh(
      [0, 0, 400_000, 200_000],
      256,
      0,
      () => true,
      8e10,
      undefined,
      true,
      true,
      f.arena
    );
    const count = 8201,
      position = (i: number): [number, number] => [
        mesh.x[i % mesh.count] + mesh.spacing * 0.23,
        mesh.y[i % mesh.count] - mesh.spacing * 0.17,
      ];
    const interpolation = projectionInterpolation(mesh, count, position, f.arena);
    const work = {
      map: createField(mesh, f.arena),
      samples: interpolation.samples,
      interpolation,
      profile: atlasPhysicalProfile(),
      fixed: [],
      inherited: false,
      sampling: { maximumSize: 1000, minimumSize: 1000, featureSamples: 2 },
    };
    const input = (i: number) => 0.1 + mesh.x[i] * 0.003 - mesh.y[i] * 0.001;
    const result = projectedValues(work, input);
    result.retain?.();
    f.arena.flush();
    f.arena.releaseProcess();
    for (const i of [0, 1, 4095, 4096, 8200]) {
      const [x, y] = position(i),
        sample = triangleSample(mesh, x, y);
      const values = sample.cells.map((cell) => input(cell));
      const expected = triangleValue({ ...sample, cells: values.map((_, j) => j) }, values);
      expect(result[i]).toBeCloseTo(expected, 10);
    }
    expect(f.arena.stats.reads).toBeGreaterThan(0);
    expect(f.arena.stats.peakDecodedBytes).toBeLessThanOrEqual(262_144);
  } finally {
    f.close();
  }
});
