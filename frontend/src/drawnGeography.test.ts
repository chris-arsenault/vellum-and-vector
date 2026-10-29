import { fixtureWorld } from "./testSupport/workspaceFixture";
import { it, expect } from "vitest";
import {
  areaSpace,
  copyGrid,
  createGrid,
  detachGrid,
  generateBand,
  defaultCartographicPresentation,
  rectangle,
  spatial,
} from "@atlas/domain";
import type { AtlasFeature, LoadedRaster as Raster } from "./types";
import type { LoadedDrawnMapInput as DrawnMapInput } from "./drawnMap";
import { territoryWashes } from "./drawnMap";
import { defaultDrawnStyles } from "./drawnStyles";
import { terrainMarks } from "./drawnTerrain";
import { fieldMarks } from "./drawnFields";
import { drawnLabelGeometry } from "./drawnLabels";
import { drawnLegend } from "./drawnLegend";
import type { Point } from "ol/geom.js";
import { drawnOcean } from "./drawnWater";
import { drawingGeography } from "./drawnGeography";

function fixture(): DrawnMapInput {
  const world = fixtureWorld({ name: "Drawn geography", seed: 31, width: 100000, height: 100000 });
  const area = Object.values(world.areas)[0];
  const field = createGrid(
    "drawing",
    {
      worldId: world.id,
      areaId: area.id,
      spaceId: areaSpace(world, area.id),
      crsId: world.reference.id,
      footprint: area.footprint,
      revision: world.version,
      time: "present",
      resolution: null,
    },
    9,
    9
  );
  field.channels.elevation = generateBand(
    field.coverage,
    "float64",
    "elevation",
    (i) => 500 + 3000 * Math.exp(-(((i % 9) - 5) ** 2 + (Math.floor(i / 9) - 5) ** 2) / 5)
  );
  field.channels.treeCover = generateBand(field.coverage, "float64", "treeCover", () => 0.7);
  field.channels["culture:a"] = generateBand(field.coverage, "float64", "culture:a", () => 0.6);
  field.channels["language:b"] = generateBand(field.coverage, "float64", "language:b", () => 0.8);
  field.units = { elevation: "m", treeCover: "ratio", "culture:a": "ratio", "language:b": "ratio" };
  field.ocean = rectangle([0, 0, 25000, 100000]);
  const raster: Raster = {
    id: field.id,
    areaId: area.id,
    footprint: area.footprint,
    bounds: field.bounds,
    channel: "elevation",
    field,
  };
  return {
    world,
    area,
    features: [],
    styles: defaultDrawnStyles(world, "political"),
    view: { ...defaultCartographicPresentation(), mode: "drawn" },
    base: [raster],
    rasters: ["treeCover", "culture:a", "language:b"].map((channel) => ({ ...raster, channel })),
  };
}
function country(input: DrawnMapInput): AtlasFeature {
  return {
    id: "country",
    areaId: input.area.id,
    layerId: "sovereignty",
    kind: "sovereignty",
    name: "The Reach",
    geometry: rectangle([0, 0, 100000, 100000]),
    attributes: {},
    relations: [],
    detail: {},
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    causes: [],
  };
}
it("retains ocean geometry and derives water when only elevation is available", async () => {
  const input = fixture(),
    raster = input.base[0];
  expect(drawnOcean(raster)).toBe(raster.field.ocean);
  const field = copyGrid(raster.field);
  delete field.ocean;
  field.channels.elevation = generateBand(field.coverage, "float64", "elevation", (i) =>
    i % 9 < 3 ? -500 : 1000
  );
  const before = detachGrid(field);
  const shape = drawnOcean({ ...raster, field });
  expect(shape).toBeTruthy();
  const covers = spatial.pointCoverage(shape!);
  expect(covers({ x: 10000, y: 50000, z: 0 })).toBe(true);
  expect(covers({ x: 90000, y: 50000, z: 0 })).toBe(false);
  expect(detachGrid(field)).toEqual(before);
});
it("places deterministic terrain on land without changing source fields", async () => {
  const input = fixture(),
    before = detachGrid(input.base[0].field);
  const marks = terrainMarks(input, input.area.footprint);
  expect(marks.filter((m) => m.kind === "mountain").length).toBeGreaterThan(10);
  expect(marks.filter((m) => m.kind === "tree").length).toBeGreaterThan(10);
  expect(marks.every((m) => m.coordinate[0] > 25000)).toBe(true);
  expect(terrainMarks(input, input.area.footprint)).toEqual(marks);
  expect(detachGrid(input.base[0].field)).toEqual(before);
});
it("keeps terrain marks out of holes and handles disconnected subjects", async () => {
  const input = fixture();
  const holed = spatial.difference(
    rectangle([30000, 0, 65000, 100000]),
    rectangle([40000, 30000, 55000, 65000])
  )!;
  const footprint = spatial.union(holed, rectangle([80000, 50000, 100000, 100000]));
  const covers = spatial.pointCoverage(footprint);
  const marks = terrainMarks(input, footprint);
  expect(marks.length).toBeGreaterThan(10);
  expect(marks.every((m) => covers({ x: m.coordinate[0], y: m.coordinate[1], z: 0 }))).toBe(true);
  expect(marks.some((m) => m.coordinate[0] > 80000)).toBe(true);
});
it("honours existing terrain-layer visibility without changing the numerical source", async () => {
  const input = fixture();
  input.styles = input.styles.map((s) => (s.layerId === "geology" ? { ...s, visible: false } : s));
  expect(terrainMarks(input, input.area.footprint).every((m) => m.kind === "tree")).toBe(true);
  input.styles = input.styles.map((s) => (s.layerId === "ecology" ? { ...s, visible: false } : s));
  expect(terrainMarks(input, input.area.footprint)).toEqual([]);
  expect(input.base[0].field.channels.treeCover.get(0)).toBe(0.7);
});
it("shows coexisting cultural fields independently and explains them in the legend", async () => {
  const input = fixture();
  input.view.fields = ["culture:a", "language:b"];
  const marks = fieldMarks(input, input.area.footprint);
  expect(new Set(marks.map((m) => m.channel))).toEqual(new Set(input.view.fields));
  expect(marks.find((m) => m.channel === "culture:a")?.weight).toBeCloseTo(0.6);
  expect(marks.find((m) => m.channel === "language:b")?.weight).toBeCloseTo(0.8);
  expect(drawnLegend(input)).toHaveLength(2);
  expect(fieldMarks(input, input.area.footprint)).toEqual(marks);
});
it("keeps territory washes below illustrations and honours feature visibility", async () => {
  const input = fixture(),
    feature = country(input);
  input.features = [feature];
  expect(territoryWashes(input)).toHaveLength(1);
  input.view.overrides[feature.id] = { illustrationHidden: true };
  expect(territoryWashes(input)).toEqual([]);
  expect(feature.geometry).toEqual(rectangle([0, 0, 100000, 100000]));
});
it("keeps generated travel frontiers canonical and subdivisions subordinate to their country", () => {
  const input = fixture(),
    parent = country(input);
  parent.attributes.boundaryDerivation = "supported-reach";
  parent.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [30000, 0],
        [60000, 0],
        [65000, 40000],
        [60000, 100000],
        [30000, 100000],
        [30000, 0],
      ],
    ],
  };
  const neighbour = {
    ...country(input),
    id: "neighbour",
    attributes: parent.attributes,
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [60000, 0],
          [100000, 0],
          [100000, 100000],
          [60000, 100000],
          [65000, 40000],
          [60000, 0],
        ],
      ],
    },
  };
  const part = { ...parent, id: "province", kind: "politicalRegion" };
  input.features = [parent, neighbour, part];
  const shapes = drawingGeography(input.features);
  expect(shapes.get(parent.id)).toEqual(parent.geometry);
  expect(shapes.get(neighbour.id)).toEqual(neighbour.geometry);
  expect(territoryWashes(input, shapes)).toHaveLength(2);
});
it("locates regional country labels inside the selected geography and retains manual paths", async () => {
  const input = fixture(),
    feature = country(input);
  const footprint = rectangle([70000, 70000, 90000, 90000]);
  const context = { world: input.world, view: input.view, footprint };
  const geometry = drawnLabelGeometry(feature, context, {}) as Point;
  const [x, y] = geometry.getCoordinates();
  expect(spatial.pointCoverage(footprint)({ x, y, z: 0 })).toBe(true);
  const path: [number, number][] = [
    [71000, 72000],
    [80000, 85000],
  ];
  expect(drawnLabelGeometry(feature, context, { path })?.getType()).toBe("LineString");
  expect(feature.geometry).toEqual(rectangle([0, 0, 100000, 100000]));
});
