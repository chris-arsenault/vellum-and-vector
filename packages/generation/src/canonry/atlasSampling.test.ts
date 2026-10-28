import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { projectedValues, projectionInterpolation } from "./atlasSampling";
import { triangleSample, triangleValue } from "./triangleSampling";

it.each(["open", "cylinder", "globe"])(
  "projects complete %s interpolation through blocks, preserving seams and missing support",
  (boundary) => {
    const mesh = createWorldMesh(
      [0, 0, 400_000, 200_000],
      256,
      30_000,
      () => true,
      400_000 * 200_000,
      undefined,
      boundary !== "open",
      boundary === "globe"
    );
    const count = 8201;
    const position = (i: number): [number, number] =>
      i === count - 1
        ? [1e9, 1e9]
        : [
            mesh.x(i % mesh.count) + mesh.spacing * 0.23,
            mesh.y(i % mesh.count) - mesh.spacing * 0.17,
          ];
    const interpolation = projectionInterpolation(mesh, count, position);
    const work = {
      map: createField(mesh),
      profile: atlasPhysicalProfile(),
      samples: interpolation.samples,
      interpolation,
      fixed: [],
      inherited: false,
      sampling: { maximumSize: 1000, minimumSize: 1000, featureSamples: 2 },
    };
    const values = Float64Array.from(
      { length: mesh.count },
      (_, i) => 0.1 + mesh.x(i) * 0.003 - mesh.y(i) * 0.001
    );
    const expected = Float64Array.from({ length: count }, (_, i) => {
      const [x, y] = position(i);
      const sample = triangleSample(mesh, x, y);
      expect(interpolation.samples[i]).toBe(sample.cell);
      return triangleValue(sample, values);
    });
    expect(projectedValues(work, values)).toEqual(expected);
    expect(projectedValues(work, values, true)).toEqual(
      Float64Array.from(interpolation.samples, (cell) => values[cell])
    );
    const reused = new Float64Array(count);
    expect(projectedValues(work, values, false, reused)).toBe(reused);
    expect(reused).toEqual(expected);
    expect(interpolation.degree).toHaveLength(count);
    expect(interpolation.cells).toHaveLength(count * interpolation.stride);
    expect(
      Array.from(projectedValues(work, new Float64Array(mesh.count).fill(0.1))).every(
        (v) => v === 0 || v === 0.1
      )
    ).toBe(true);
  }
);
