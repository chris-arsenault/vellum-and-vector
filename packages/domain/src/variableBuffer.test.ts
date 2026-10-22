import { expect, it } from "vitest";
import { spatial } from "./spatial";

it("retains explicit radius ownership through coincident and subprecision stations", () => {
  const line = {
    type: "LineString" as const,
    coordinates: [
      [0, 0],
      [10, 0],
      [10 + 1e-10, 0],
      [20, 0],
    ],
  };
  const shape = spatial.variableBuffer(line, [0, 2, 5, 0])!;
  expect(spatial.pointCoverage(shape)({ x: 10, y: 4, z: 0 })).toBe(true);
  expect(spatial.pointCoverage(shape)({ x: 10, y: 6, z: 0 })).toBe(false);
  expect(spatial.variableBuffer(line, [0, 0, 0, 0])).toBeNull();
  expect(() => spatial.variableBuffer(line, [1, 2])).toThrow(/Each line station/);
});

it("represents a constant-width rounded channel within the existing circular arc approximation", () => {
  const line = {
      type: "LineString" as const,
      coordinates: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
    },
    radius = 10;
  const expected = spatial.buffer(line, radius)!,
    actual = spatial.variableBuffer(line, [radius, radius, radius])!;
  expect(spatial.area(actual)).toBeCloseTo(spatial.area(expected), 3);
  for (const p of [
    [0, 9],
    [-9, 0],
    [109, 0],
    [109, 100],
    [100, 109],
  ])
    expect(spatial.pointCoverage(actual)({ x: p[0], y: p[1], z: 0 })).toBe(true);
});

it("retains the swept disk when a radius grows faster than station distance", () => {
  const shape = spatial.variableBuffer(
    {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 0],
      ],
    },
    [0, 10]
  )!;
  expect(spatial.area(shape)).toBeCloseTo(
    spatial.area(spatial.buffer({ type: "Point", coordinates: [1, 0] }, 10)!),
    4
  );
});
