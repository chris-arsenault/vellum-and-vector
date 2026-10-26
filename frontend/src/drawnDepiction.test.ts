import { expect, it } from "vitest";
import {
  defaultCartographicPresentation,
  rectangle,
  spatial,
  createGrid,
  areaSpace,
  describeFeature,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { AtlasFeature, Raster } from "./types";
import { createWorld } from "./atlasState";
import { drawingGeography } from "./drawnGeography";
import { biomeStyle, biomeTreatment } from "./drawnEcology";
import { placeAnchor, placeMark } from "./drawnPlaces";
import { cartographicFeatureStyle, defaultDrawnStyles } from "./drawnStyles";
import { drawnMagic, magicCartography } from "./drawnMagic";
import { sheetPadding } from "./drawnSheet";
import type { DrawnMapInput } from "./drawnMap";

const polygon = (ring: number[][]): Geometry => ({ type: "Polygon", coordinates: [ring] });
function feature(
  id: string,
  geometry: Geometry,
  kind = "sovereignty",
  layerId = "sovereignty"
): AtlasFeature {
  return {
    id,
    geometry,
    kind,
    layerId,
    areaId: "area",
    name: id,
    attributes: {},
    relations: [],
    detail: {},
    protected: false,
    state: "generated",
    actor: "generator",
    generationId: null,
    causes: [],
  };
}
function neighbours() {
  return [
    feature(
      "west",
      polygon([
        [0, 0],
        [6000, 0],
        [6000, 2000],
        [4000, 2000],
        [4000, 4000],
        [2000, 4000],
        [2000, 6000],
        [0, 6000],
        [0, 0],
      ])
    ),
    feature(
      "east",
      polygon([
        [6000, 2000],
        [6000, 6000],
        [2000, 6000],
        [2000, 4000],
        [4000, 4000],
        [4000, 2000],
        [6000, 2000],
      ])
    ),
  ];
}
it("rounds shared generated stairs once, retaining complete coverage and the source boundaries", () => {
  const features = neighbours(),
    before = structuredClone(features);
  const shapes = drawingGeography(features),
    a = shapes.get("west")!,
    b = shapes.get("east")!;
  expect(a).not.toEqual(features[0].geometry);
  expect(spatial.area(spatial.intersection(a, b) ?? rectangle([0, 0, 0, 0]))).toBe(0);
  expect(spatial.area(spatial.union(a, b))).toBeCloseTo(36000000, 3);
  expect(features).toEqual(before);
  expect(drawingGeography(features)).toBe(shapes);
});
it("retains authored shared borders and three-country junctions", () => {
  const features = neighbours();
  features[0].protected = true;
  expect(drawingGeography(features).get("east")).toEqual(features[1].geometry);
  const junction = [
    feature("a", rectangle([0, 0, 3000, 6000])),
    feature("b", rectangle([3000, 0, 6000, 3000])),
    feature("c", rectangle([3000, 3000, 6000, 6000])),
  ];
  const shapes = drawingGeography(junction);
  for (const f of junction) expect(shapes.get(f.id)).toEqual(f.geometry);
});
it("keeps narrow coastal slivers and adjacent countries valid during shared smoothing", () => {
  const sliver = polygon([
    [0, 0],
    [10000, 0],
    [10000, 3000],
    [8000, 3000],
    [8000, 6000],
    [7999, 5999],
    [7800, 3000],
    [6000, 3000],
    [6000, 8000],
    [4000, 8000],
    [4000, 3000],
    [2000, 3000],
    [2000, 10000],
    [0, 10000],
    [0, 0],
  ]);
  const remainder = spatial.difference(rectangle([0, 0, 10000, 10000]), sliver)!;
  const source = [feature("sliver", sliver), feature("neighbour", remainder)];
  const shapes = drawingGeography(source),
    a = shapes.get("sliver")!,
    b = shapes.get("neighbour")!;
  expect(() => spatial.canonical(a)).not.toThrow();
  expect(() => spatial.canonical(b)).not.toThrow();
  expect(spatial.intersectionArea(a)(b)).toBeCloseTo(0, 4);
  expect(spatial.area(spatial.union(a, b))).toBeCloseTo(100000000, 2);
});
it("clips land washes and ecological shapes to physical shores and lakes, including water holes", () => {
  const world = createWorld({ name: "Shores", seed: 3, width: 100000, height: 100000 });
  const area = Object.values(world.areas)[0];
  const field = createGrid(
    "coast",
    {
      worldId: world.id,
      areaId: area.id,
      spaceId: areaSpace(world, area.id),
      crsId: world.reference.id,
      footprint: area.footprint,
      revision: 0,
      time: "present",
      resolution: null,
    },
    3,
    3
  );
  field.ocean = spatial.difference(
    rectangle([0, 0, 40000, 100000]),
    rectangle([10000, 20000, 20000, 30000])
  )!;
  const base: Raster[] = [
    {
      id: field.id,
      areaId: area.id,
      footprint: area.footprint,
      bounds: field.bounds,
      channel: "elevation",
      field,
    },
  ];
  const country = feature("country", area.footprint),
    biome = feature("fen", area.footprint, "wetland", "ecology");
  const lake = feature("lake", rectangle([70000, 70000, 80000, 80000]), "lake", "lakes");
  const shapes = drawingGeography([country, biome, lake], base);
  for (const f of [country, biome]) {
    const shape = shapes.get(f.id)!;
    expect(spatial.intersectionArea(shape)(field.ocean)).toBe(0);
    expect(spatial.intersectionArea(shape)(lake.geometry)).toBe(0);
    expect(spatial.pointCoverage(shape)({ x: 15000, y: 25000, z: 0 })).toBe(true);
  }
  expect(country.geometry).toEqual(area.footprint);
});
it("depicts distinct biome families with their own wash and illustration motif", () => {
  const kinds = ["forest", "grassland", "wetland", "barren"];
  const features = kinds.map((kind) =>
    feature(kind, rectangle([0, 0, 10000, 10000]), kind, "ecology")
  );
  expect(new Set(features.map((f) => biomeStyle(f, false)?.getFill()?.getColor())).size).toBe(4);
  expect(features.map((f) => biomeTreatment(f)?.symbol)).toEqual([
    "broadleaf",
    "grass",
    "reeds",
    "rock",
  ]);
  features[3].attributes.biome = "Desert";
  expect(biomeTreatment(features[3])?.symbol).toBe("dune");
});
it("gives major non-city sites recognizable marks and anchors polygon sites inside their footprint", () => {
  const kinds = ["volcano", "crater", "waterfall", "poi", "harbor"];
  expect(
    kinds.map((kind) => placeMark(feature(kind, rectangle([0, 0, 10000, 10000]), kind, "geology")))
  ).toEqual(["volcano", "crater", "falls", "site", "harbor"]);
  const site = feature("Named canyon", rectangle([0, 0, 10000, 10000]), "landmark", "geology");
  site.attributes.landmarkKind = "canyon";
  expect(placeMark(site)).toBe("gorge");
  const [x, y] = placeAnchor(site);
  expect(spatial.pointCoverage(site.geometry)({ x, y, z: 0 })).toBe(true);
});
it("keeps legacy mesh fault traces out of ordinary drawn maps but retains explicit fault styling", () => {
  const world = createWorld({ name: "Faults", seed: 1, width: 100000, height: 100000 });
  const fault = feature(
    "fault",
    {
      type: "LineString",
      coordinates: [
        [0, 0],
        [10000, 10000],
      ],
    },
    "fault",
    "geology"
  );
  const style = {
    ...defaultDrawnStyles(world, "political").find((s) => s.layerId === "geology")!,
    labels: false,
  };
  const context = { world, view: { ...defaultCartographicPresentation(), mode: "drawn" as const } };
  expect(cartographicFeatureStyle(fault, style, 100, context)).toEqual([]);
  style.types = { [describeFeature(world, fault).id]: { visible: true } };
  expect(
    cartographicFeatureStyle(fault, style, 100, context)[0].getStroke()?.getLineDash()
  ).toEqual([2, 5]);
  expect(defaultDrawnStyles(world, "political").find((s) => s.layerId === "magic")?.visible).toBe(
    true
  );
  expect(defaultDrawnStyles(world, "political").find((s) => s.layerId === "pois")?.visible).toBe(
    true
  );
});
it("keeps broad magical fields translucent while retaining rule-defined sites and courses", () => {
  const world = createWorld({ name: "Magic", seed: 1, width: 100000, height: 100000 });
  const field = feature(
    "Pressure lattice",
    rectangle([0, 0, 10000, 10000]),
    "pressure:lattice",
    "magic"
  );
  field.attributes = { system: "pressure", rule: "lattice" };
  const style = defaultDrawnStyles(world, "political").find((s) => s.layerId === "magic")!;
  expect(magicCartography(field, world)).toBe("area");
  const color = drawnMagic(field, style, world, 100, false)[0].getFill()!.getColor() as string;
  expect(parseInt(color.slice(-2), 16) / 255).toBeLessThan(0.1);
  expect(drawnMagic(field, style, world, 100, false)[0].getStroke()).toBeNull();
  const spring = { ...field, kind: "fire:spring", attributes: { system: "fire", rule: "spring" } };
  expect(magicCartography(spring, world)).toBe("site");
  expect(magicCartography({ ...spring, attributes: { system: "fire", rule: "vein" } }, world)).toBe(
    "course"
  );
});
it("reserves chart space for a full political legend instead of drawing the key over the land", () => {
  const world = createWorld({ name: "Many countries", seed: 1, width: 100000, height: 100000 });
  const input: DrawnMapInput = {
    world,
    area: Object.values(world.areas)[0],
    features: Array.from({ length: 44 }, (_, i) =>
      feature(`country${i}`, rectangle([0, 0, 10000, 10000]))
    ),
    styles: defaultDrawnStyles(world, "political"),
    view: { ...defaultCartographicPresentation(), mode: "drawn" },
    base: [],
    rasters: [],
  };
  expect(sheetPadding(input, 1200)[2]).toBeGreaterThan(200);
  input.view.sheet.legend = false;
  expect(sheetPadding(input, 1200)[2]).toBe(110);
});
