import { expect, it } from "vitest";
import { createGrid } from "./grids";
import { rectangle, spatial } from "./spatial";
import { fieldContour } from "./fieldContours";

function scaledShore(scale: number) {
  const grid = createGrid(
    "shore",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metre",
      footprint: rectangle([0, 0, 1000 * scale, 700 * scale]),
      revision: 1,
      time: "present",
      resolution: null,
    },
    9,
    7
  );
  let calls = 0;
  const shore = fieldContour(
    grid,
    (x, y) => {
      calls++;
      return x / scale + (y / scale) * 0.193 - 371.73;
    },
    undefined,
    0,
    10 * scale
  )!;
  return { calls, area: spatial.area(shore) / scale ** 2 };
}

it("uses cartographic tolerance rather than absolute micrometre precision at larger scales", () => {
  const small = scaledShore(1),
    large = scaledShore(1024);
  const expectedArea = 700 * (1000 - 371.73) + (0.193 * 700 ** 2) / 2;
  expect(small.area).toBeCloseTo(expectedArea, 2);
  expect(large.area).toBeCloseTo(expectedArea, 2);
  expect(large.calls).toBe(small.calls);
});
