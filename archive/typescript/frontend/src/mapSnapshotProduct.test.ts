import { expect, it } from "vitest";
import { createGrid, generateBand, putChannel, MapScale, rectangle, spatial } from "@atlas/domain";
import type { MapLayer } from "@atlas/map";
import { publishedMapFixture } from "./testSupport/publishedMapFixture";
import { mapSnapshotRasters } from "./mapSnapshotRasters";
import { mapSnapshotProduct } from "./mapSnapshotProduct";
import { mapSampleRecords } from "./mapSamplePublication";

it("uses current outputs before captured channels and keeps untouched captured overlays", () => {
  const { snapshot, raster } = publishedMapFixture();
  const current = snapshot.world.fields[0];
  current.channels = current.channels!.filter((channel) => channel !== "Temperature");
  snapshot.world.fields.unshift({
    ...current,
    id: "captured",
    input: true,
    channels: ["Elevation", "Temperature"],
  });
  const grid = { ...raster.field, channels: { ...raster.field.channels } };
  putChannel(
    grid,
    "Elevation",
    "native-length",
    generateBand(grid.coverage, "float64", "captured-height", () => MapScale.native(-100))
  );
  putChannel(
    grid,
    "Temperature",
    "celsius",
    generateBand(grid.coverage, "float64", "captured-temperature", () => 42)
  );
  snapshot.numerical.captured = grid;
  const products = [...mapSnapshotRasters(snapshot, raster.areaId, () => [])];
  const height = products.find((product) => product.channel === "Elevation")!;
  const temperature = products.find((product) => product.channel === "Temperature")!;
  expect(height.field.channels.Elevation!.get(12)).toBe(MapScale.native(850));
  expect(temperature.field.channels.Temperature!.get(12)).toBe(42);
  expect(height.surface?.channels.finalSurface).toBe(raster.field.channels.finalSurface);
});

it("publishes a seam-crossing child in its own opening window with canonical inspection geography", () => {
  const { snapshot, raster } = publishedMapFixture();
  const { world } = snapshot;
  world.reference.boundaryMode = "cylinder";
  const footprint = spatial.union(rectangle([90, 10, 100, 30]), rectangle([0, 10, 10, 30]))!;
  world.areas.child = {
    ...world.areas[raster.areaId],
    id: "child",
    parentId: raster.areaId,
    profile: "region",
    footprint,
    map: { sourceAreaId: raster.areaId, sourceRevision: 1, refinementLevel: 1 },
  };
  snapshot.scope = { ...snapshot.scope, areaId: "child", footprint };
  const grid = createGrid(
    "child-field",
    { ...raster.field.scope, ...snapshot.scope },
    5,
    5,
    [90, 10, 110, 30],
    undefined,
    100
  );
  putChannel(
    grid,
    "Elevation",
    "native-length",
    generateBand(grid.coverage, "float64", "height", () => MapScale.native(100))
  );
  world.fields = [{ ...world.fields[0], id: grid.id, areaId: "child", channels: ["Elevation"] }];
  snapshot.numerical = { [grid.id]: grid };
  const parent = { mapId: raster.areaId, revision: "captured" };
  const input = mapSnapshotProduct(
    snapshot,
    { reference: { mapId: "child", revision: "new" }, expected: null, parent },
    { get: () => undefined, values: () => [] },
    []
  );
  expect(input.descriptor.bounds).toEqual([90, 10, 110, 30]);
  expect(input.descriptor.spaces[0]).toMatchObject({
    bounds: [0, 0, 100, 100],
    periodicWidth: 100,
  });
  expect(input.descriptor.parent).toEqual(parent);
  const layer = heightLayer(world.id);
  const samples = [
    ...mapSampleRecords(world, grid, [{ channel: "Elevation", bandId: "value", layer }]),
  ];
  const seam = samples.find((sample) => sample.center[0] === 0 && sample.center[1] === 20)!;
  expect(seam.footprint.type).toBe("MultiPolygon");
  const covers = spatial.pointCoverage(seam.footprint);
  expect(covers({ x: 99, y: 20, z: 0 })).toBe(true);
  expect(covers({ x: 1, y: 20, z: 0 })).toBe(true);
  expect(seam.attributes[0].value).toBe(MapScale.native(100));
});
function heightLayer(spaceId: string): MapLayer {
  return {
    id: "terrain",
    name: "Height",
    spaceId,
    bounds: [90, 10, 110, 30],
    attribution: [],
    catalog: {
      path: ["Terrain"],
      common: true,
      featureTypes: [],
      defaultStyle: null,
      presets: [],
      properties: {},
      geometries: [],
      examples: [],
    },
    source: {
      kind: "attributes",
      data: {
        bands: [
          {
            id: "value",
            name: "Elevation",
            unit: "native-length",
            display: { unit: "m", factor: 1000 },
            nodata: null,
            range: null,
            categories: [],
          },
        ],
      },
    },
  };
}
