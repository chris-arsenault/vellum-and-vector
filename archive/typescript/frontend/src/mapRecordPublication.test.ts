import { expect, it } from "vitest";
import {
  columnFields,
  generateBand,
  MapScale,
  putChannel,
  spatial,
  type AtlasFeature,
} from "@atlas/domain";
import type { MapLayer } from "@atlas/map";
import { publishedMapFixture } from "./testSupport/publishedMapFixture";
import { mapSampleRecords } from "./mapSamplePublication";
import { mapFeatureRecords } from "./mapFeaturePublication";
import { mapHistoryRecords } from "./mapHistoryPublication";
import { mapEntities } from "./mapCataloguePublication";

it("publishes exact stored values and cell geography separately from interpolated display pixels", () => {
  const { world, raster } = publishedMapFixture();
  const rock = columnFields.land;
  putChannel(
    raster.field,
    rock.depth[0],
    "native-length",
    generateBand(raster.field.coverage, "float64", "rock-depth", () => MapScale.native(12))
  );
  putChannel(
    raster.field,
    rock.kind[0],
    "category",
    generateBand(raster.field.coverage, "int32", "rock-kind", () => 0),
    "category"
  );
  const layer: MapLayer = {
    id: "sample-facts",
    name: "Stored facts",
    spaceId: raster.field.scope.spaceId,
    bounds: [0, 0, 100, 100],
    attribution: [],
    catalog: {
      path: ["Facts"],
      common: false,
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
        bands: (["Elevation", rock.depth[0], rock.kind[0]] as const).map((id) => ({
          id,
          name: id,
          unit: raster.field.units[id]!,
          display: { unit: raster.field.units[id]!, factor: 1 },
          nodata: null,
          range: null,
          categories: [],
        })),
      },
    },
  };
  const bindings = ["Elevation", rock.depth[0], rock.kind[0]].map((channel) => ({
    channel,
    bandId: channel,
    layer,
  }));
  const samples = [...mapSampleRecords(world, raster.field, bindings)];
  const middle = samples.find((sample) => sample.id === "cell:12")!;
  expect(middle).toMatchObject({ center: [50, 50, 0], cellSpan: 25, measure: 625, active: true });
  expect(middle.attributes[0].value).toBe(MapScale.native(850));
  expect(middle.sections[0].records[0].Thickness).toBe("12 m");
  expect(spatial.bounds(middle.footprint)).toEqual([37.5, 37.5, 62.5, 62.5]);
  expect(spatial.area(middle.footprint)).toBe(625);
});

it("publishes composed following geography and retains feature meaning and relations", () => {
  const { world, raster } = publishedMapFixture();
  const river: AtlasFeature = {
    id: "river",
    name: "Long water",
    kind: "river",
    layerId: "rivers",
    areaId: raster.areaId,
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 25],
        [50, 50],
        [100, 75],
      ],
    },
    detail: {},
    attributes: { discharge: 45 },
    relations: [],
    causes: ["Wet hills feed the river"],
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: "run",
  };
  const road: AtlasFeature = {
    ...river,
    id: "road",
    placeId: "shared-road",
    kind: "road",
    name: "River road",
    layerId: "roads",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [100, 0],
      ],
    },
    relations: [{ kind: "follows", targetId: "river" }],
  };
  const records = [river, road];
  const products = [
    ...mapFeatureRecords(world, raster.areaId, {
      get: (id) => records.find((record) => record.id === id),
      values: () => records,
    }),
  ];
  expect(products.find((feature) => feature.id === "road")).toMatchObject({
    kind: "road",
    entityId: "shared-road",
    geometry: river.geometry,
    relations: [{ kind: "follows", targetId: "river", targetName: "Long water" }],
    causes: river.causes,
    catalog: {
      origin: "Generated geography",
      mapOnly: false,
      values: { name: "River road", state: "generated", protected: false },
    },
  });
});

it("publishes entity descriptions without private naming or generation settings", () => {
  const { world } = publishedMapFixture();
  world.entities = {
    realm: {
      id: "realm",
      name: "Coastal union",
      kind: "polity",
      attributes: {
        character: { people: 1200, places: 3 },
        naming: { privateConfiguration: true },
      },
    },
  };
  expect([...mapEntities(world)]).toEqual([
    { id: "realm", name: "Coastal union", kind: "polity", people: 1200, places: 3 },
  ]);
});

it("keeps completed observations, numerical summaries and nested epochs as map history", () => {
  const entries = [
    ...mapHistoryRecords(
      [
        {
          path: ["era", "wet"],
          ancestry: [{ id: "era", duration: 100, parentEpoch: null, variables: {} }],
          causes: [
            {
              kind: "domain",
              process: "settlement",
              subjects: ["town"],
              description: "A crossing became a town",
            },
            {
              kind: "climate",
              process: "rain",
              fields: { rain: { unit: "millimetre/year", minimum: 10, maximum: 500, mean: 200 } },
            },
          ],
        },
      ],
      "run"
    ),
  ];
  expect(entries[0]).toMatchObject({
    description: "A crossing became a town",
    featureIds: ["town"],
    attributes: { path: ["era", "wet"] },
  });
  expect(entries[1].attributes.cause).toMatchObject({
    fields: { rain: { minimum: 10, maximum: 500 } },
  });
});
