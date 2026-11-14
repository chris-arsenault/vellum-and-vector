import { expect, it } from "vitest";
import { rectangle, spatial, type AtlasFeature, type FeatureReader } from "@atlas/domain";
import { publishedMapFixture } from "./testSupport/publishedMapFixture";
import { mapIllustrationGeometry } from "./mapIllustrationPublication";
import { vectorCatalog } from "./mapLayerCatalog";

function feature(
  id: string,
  areaId: string,
  bounds: [number, number, number, number]
): AtlasFeature {
  return {
    id,
    areaId,
    layerId: "sovereignty",
    kind: "sovereignty",
    name: id,
    geometry: rectangle(bounds),
    attributes: {},
    detail: {},
    relations: [],
    causes: [],
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: "supplied",
  };
}
const reader = (records: AtlasFeature[]): FeatureReader => ({
  get: (id) => records.find((feature) => feature.id === id),
  values: (query) =>
    records.filter((feature) => !query?.layerId || feature.layerId === query.layerId),
});

it("publishes retained ocean geography, dry political shapes and explicit hidden shapes", async () => {
  const { snapshot, raster } = publishedMapFixture();
  const records = [
    feature("country", raster.areaId, [0, 0, 100, 100]),
    { ...feature("submerged", raster.areaId, [0, 0, 10, 100]), layerId: "ecology" },
    { ...feature("lake", raster.areaId, [30, 30, 50, 50]), kind: "lake", layerId: "lakes" },
  ];
  const products = [];
  for await (const product of mapIllustrationGeometry(snapshot, reader(records)))
    products.push(product);
  const ocean = products.find((shape) => shape.featureId === null)!;
  expect(ocean.geometry).toEqual(raster.field.ocean);
  const country = products.find((shape) => shape.featureId === "country")!;
  expect(spatial.area(country.geometry!)).toBe(7600);
  expect(spatial.pointCoverage(country.geometry!)({ x: 40, y: 40, z: 0 })).toBe(false);
  expect(products.find((shape) => shape.featureId === "submerged")?.geometry).toBeNull();
  expect(products.some((shape) => shape.featureId === "lake")).toBe(false);
});

it("publishes resolved classifications and the existing presentation presets", () => {
  const { snapshot, raster } = publishedMapFixture();
  const country = feature("country", raster.areaId, [20, 0, 100, 100]);
  country.attributes.population = 120;
  const catalogue = vectorCatalog(snapshot.world, raster.areaId, "sovereignty", reader([country]));
  expect(catalogue.featureTypes.filter((type) => type.count)).toEqual([
    {
      id: '["sovereignty","sovereignty",""]',
      kind: "sovereignty",
      label: "Sovereignty",
      path: ["Politics", "Territories", "Sovereignty"],
      magicDepiction: null,
      count: 1,
      geometries: ["Polygon"],
      footprints: false,
    },
  ]);
  expect(catalogue.examples).toEqual([country.id]);
  expect(catalogue.geometries).toEqual(["Polygon"]);
  expect(catalogue.properties.population).toEqual({ type: "number" });
  expect(catalogue.presets).toContain("political");
  expect(catalogue.defaultStyle).toMatchObject({ visible: false, opacity: 0.4 });
});

it("retains empty feature types without inventing examples or geometry", () => {
  const { world, raster } = publishedMapFixture();
  const catalogue = vectorCatalog(world, raster.areaId, "settlements", reader([]));
  expect(catalogue.featureTypes.length).toBeGreaterThan(0);
  expect(catalogue.featureTypes.every((type) => type.count === 0 && !type.geometries.length)).toBe(
    true
  );
  expect(catalogue.examples).toEqual([]);
  const network = Object.values(world.layers).find((layer) => layer.representation === "network")!;
  expect(vectorCatalog(world, raster.areaId, network.id, reader([])).geometries).toEqual([
    "LineString",
  ]);
});
