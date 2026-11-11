import { expect, it } from "vitest";
import {
  canonicalGeometry,
  canonicalPosition,
  chartCopies,
  chartFootprint,
  unwrapCoordinates,
} from "./worldBoundary";
import { rectangle, spatial } from "./spatial";
import type { World } from "./model";

const reference = {
  boundaryMode: "cylinder",
  domain: rectangle([0, 0, 1000, 500]),
} as World["reference"];
it("rejoins canonical footprint pieces in a compact working chart", () => {
  const original = rectangle([950, 100, 1050, 200]);
  const canonical = canonicalGeometry(reference, original);
  const continuous = chartFootprint(canonical, [950, 100, 1050, 200], 1000);
  expect(spatial.bounds(continuous)).toEqual([950, 100, 1050, 200]);
  expect(spatial.covers(continuous, rectangle([975, 125, 1025, 175]))).toBe(true);
  expect(spatial.bounds(canonical)).toEqual([0, 100, 1000, 200]);
  expect(
    spatial.covers(chartFootprint(reference.domain, [950, 100, 1050, 200], 1000), original)
  ).toBe(true);
});
it("normalizes repeated chart positions and preserves open worlds", () => {
  expect(canonicalPosition(reference, { x: 2010, y: 20, z: 5 })).toEqual({ x: 10, y: 20, z: 5 });
  expect(canonicalPosition({ ...reference, boundaryMode: "none" }, { x: -20, y: 20, z: 0 }).x).toBe(
    -20
  );
});
it("cuts a seam-crossing polygon into two chart pieces without losing area", () => {
  const shape = canonicalGeometry(reference, rectangle([950, 100, 1050, 200]));
  expect(shape.type).toBe("MultiPolygon");
  expect(spatial.area(shape)).toBeCloseTo(10000, 6);
  expect(spatial.covers(reference.domain, shape)).toBe(true);
  expect(spatial.bounds(shape)).toEqual([0, 100, 1000, 200]);
});
it("carries a line's overhang past the west edge to the east edge, and leaves a degenerate shape alone", () => {
  const grazing = {
    type: "LineString" as const,
    coordinates: [
      [-5, 250],
      [900, 250],
    ],
  };
  const shape = canonicalGeometry(reference, grazing);
  expect(shape.type).toBe("MultiLineString");
  expect(spatial.length(shape)).toBeCloseTo(905, 6);
  expect(spatial.bounds(shape)).toEqual([0, 250, 1000, 250]);
  const collapsed = {
    type: "Polygon" as const,
    coordinates: [
      [
        [30, 30],
        [30, 30],
        [30, 30],
        [30, 30],
      ],
    ],
  };
  expect(canonicalGeometry(reference, collapsed)).toEqual(collapsed);
});
it("unwraps short seam links before clipping, rather than drawing across the world", () => {
  const coordinates = unwrapCoordinates(
    [
      [980, 250],
      [20, 250],
      [40, 250],
    ],
    1000
  );
  const line = { type: "LineString" as const, coordinates };
  expect(coordinates.map((p) => p[0])).toEqual([980, 1020, 1040]);
  expect(chartCopies(reference, line)).toHaveLength(2);
  const shape = canonicalGeometry(reference, line);
  expect(shape.type).toBe("MultiLineString");
  expect(spatial.length(shape)).toBeCloseTo(60, 6);
});

it("clips crossing traces at the seam without turning their crossings into network nodes", () => {
  const shape = canonicalGeometry(reference, {
    type: "LineString",
    coordinates: [
      [-100, 100],
      [900, 400],
      [-100, 400],
      [900, 100],
    ],
  });
  expect(shape.type).toBe("MultiLineString");
  if (shape.type !== "MultiLineString") throw new Error("Expected chart pieces.");
  const stations = shape.coordinates.flat();
  expect(stations).toContainEqual([900, 400]);
  expect(stations).not.toContainEqual([400, 250]);
  expect(spatial.covers(reference.domain, shape)).toBe(true);
});

it("retains a trace lying along the chart boundary while clipping its overhang", () => {
  const shape = canonicalGeometry(reference, {
    type: "LineString",
    coordinates: [
      [0, -50],
      [0, 250],
      [100, 550],
    ],
  });
  const lines =
    shape.type === "LineString"
      ? [shape.coordinates]
      : shape.type === "MultiLineString"
        ? shape.coordinates
        : [];
  expect(lines.flat()).toContainEqual([0, 0]);
  expect(lines.flat()).toContainEqual([0, 250]);
  expect(spatial.covers(reference.domain, shape)).toBe(true);
});
