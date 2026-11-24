import { describe, expect, it } from "vitest";
import type { MapDescriptor, RegionGeometry } from "@atlas/map";
import type { PublishedFeature } from "./publishedAppearance";
import { citySelection, districtChoice, districtSelection } from "./cityMaps";

const map = {
  reference: { mapId: "region", revision: "one" },
  realScale: null,
} as unknown as MapDescriptor;
function feature(kind: string, geometry: PublishedFeature["geometry"]): PublishedFeature {
  return {
    id: `${kind}-1`,
    spaceId: "surface",
    name: "Rivassanrema",
    kind,
    geometry,
  } as unknown as PublishedFeature;
}
const square: RegionGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};

describe("city and district maps", () => {
  it("a settlement on a regional map opens a city map at that settlement", () => {
    const opened = citySelection(
      map,
      feature("settlement", { type: "Point", coordinates: [5, 7] })
    );
    expect(opened?.city).toEqual({ settlement: "settlement-1" });
    expect(opened?.selection.parent).toEqual(map.reference);
    expect(opened?.selection.regionPath).toEqual([]);
    // A real-scale map's settlements are already its towns.
    expect(
      citySelection(
        { ...map, realScale: {} } as unknown as MapDescriptor,
        feature("settlement", { type: "Point", coordinates: [5, 7] })
      )
    ).toBeNull();
    expect(citySelection(map, feature("district", square))).toBeNull();
    expect(citySelection(map, feature("settlement", square))?.selection.geometry).toEqual(square);
  });

  it("a city map's district opens a real-scale map over its own outline", () => {
    const selection = districtSelection(map, feature("district", square));
    expect(selection?.geometry).toEqual(square);
    expect(selection?.regionPath).toHaveLength(1);
    expect(selection?.regionPath[0]).toMatchObject({ id: "district-1", geometry: square });
    expect(districtChoice.kind).toBe("ground");
    expect(
      districtSelection(map, feature("settlement", { type: "Point", coordinates: [1, 1] }))
    ).toBeNull();
  });
});
