import { expect, it } from "vitest";
import { defaultCartographicPresentation, rectangle } from "@atlas/domain";
import { fixtureWorld } from "./testSupport/workspaceFixture";
import type { DrawnMapInput } from "./drawnMap";
import type { AtlasFeature } from "./types";
import { drawingIdentity } from "./drawnIdentity";
import { mapDataExtent } from "./useScene";

const world = fixtureWorld({ name: "Sheet", seed: 3, width: 1000, height: 1000 });
function input(features: AtlasFeature[]): DrawnMapInput {
  return {
    world,
    area: Object.values(world.areas)[0],
    view: { ...defaultCartographicPresentation(), mode: "drawn" },
    features,
    styles: [],
    base: [],
    rasters: [],
  };
}
const wood = (geometry = rectangle([0, 0, 10, 10])) =>
  ({ id: "wood", geometry }) as unknown as AtlasFeature;
it("names one stored drawing per subject and changes its stamp only with its inputs", () => {
  const footprint = rectangle([0, 0, 1000, 1000]);
  const first = drawingIdentity(input([wood()]), footprint);
  expect(drawingIdentity(input([wood()]), footprint)).toEqual(first);
  const finer = drawingIdentity(
    input([
      wood({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [5, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      }),
    ]),
    footprint
  );
  expect(finer.family).toBe(first.family);
  expect(finer.stamp).not.toBe(first.stamp);
});
it("reads a drawn sheet's whole subject whatever the viewport", () => {
  const sheet = rectangle([100, 100, 300, 400]);
  expect(mapDataExtent(sheet, [0, 0, 50, 50])).toEqual([100, 100, 300, 400]);
  expect(mapDataExtent(sheet, [500, 500, 900, 900])).toEqual([100, 100, 300, 400]);
  expect(mapDataExtent(null, [0, 0, 50, 50])).toEqual([0, 0, 50, 50]);
  expect(mapDataExtent(sheet, null)).toBeNull();
});
