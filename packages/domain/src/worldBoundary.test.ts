import { expect, it } from "vitest";
import {
  canonicalGeometry,
  canonicalPosition,
  chartCopies,
  unwrapCoordinates,
} from "./worldBoundary";
import { rectangle, spatial } from "./spatial";
import type { World } from "./model";

const reference = {
  boundaryMode: "cylinder",
  domain: rectangle([0, 0, 1000, 500]),
} as World["reference"];
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
