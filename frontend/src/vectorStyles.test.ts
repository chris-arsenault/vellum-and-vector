import { expect, it } from "vitest";
import { Circle, Style, RegularShape } from "ol/style.js";
import { featureStyle, defaultSymbolStyle } from "./vectorStyles";
import { biomeFamilies, magicPlacePresentations, rectangle } from "@atlas/domain";
import Parser from "geostyler-openlayers-parser";
import type { AtlasFeature, LayerStyle } from "./types";

const layer: LayerStyle = {
  color: "#226699",
  labels: false,
  layerId: "rivers",
  visible: true,
  opacity: 1,
  minScale: 0,
};
function river(widths: number[]): AtlasFeature {
  return {
    id: "river",
    name: "River",
    kind: "river",
    layerId: "rivers",
    geometry: { type: "LineString", coordinates: widths.map((_, i) => [i * 1000, i * 500]) },
    attributes: { widths },
    areaId: "world",
    detail: {},
    relations: [],
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    causes: [],
  };
}
function styles(feature: AtlasFeature, resolution: number) {
  const style = featureStyle(feature, layer, resolution);
  return (Array.isArray(style) ? style : [style]) as Style[];
}
function width(feature: AtlasFeature, resolution: number) {
  return styles(feature, resolution)
    .map((style) => style.getStroke()?.getWidth())
    .filter((value) => value !== undefined) as number[];
}

it("distinguishes unresolved tributaries and trunks at continental zoom without splitting every segment", () => {
  const small = river([10, 12, 15]),
    large = river([100, 150, 230]);
  expect(width(small, 5000)[0]).toBeLessThan(width(large, 5000)[0]);
  expect(width(small, 5000)[0]).toBeLessThan(1);
  expect(styles(large, 5000)).toHaveLength(1);
});

it("distinguishes political seats without using zoom to add or remove settlement features", () => {
  const town: AtlasFeature = {
    ...river([]),
    kind: "settlement",
    layerId: "settlements",
    geometry: { type: "Point", coordinates: [0, 0] },
    attributes: { population: 6000, settlementRole: "capital" },
  };
  for (const resolution of [10000, 1]) {
    const capital = styles(town, resolution)[0];
    expect((capital.getImage() as RegularShape).getPoints()).toBe(5);
    const regional = styles(
      { ...town, attributes: { ...town.attributes, settlementRole: "regionalCapital" } },
      resolution
    )[0];
    expect((regional.getImage() as RegularShape).getPoints()).toBe(4);
    expect(capital.getZIndex()).toBeGreaterThan(regional.getZIndex()!);
  }
});

it("uses physical bank widths and the longitudinal width profile at close zoom", () => {
  const feature = river([50, 100, 200]);
  expect(width(feature, 1)).toEqual([75, 150]);
  expect(width(feature, 10)[0]).toBeLessThan(width(feature, 1)[0]);
  expect(feature.attributes.widths).toEqual([50, 100, 200]);
});

it("keeps non-river line symbols and manual river lines usable", () => {
  expect(width({ ...river([10, 10]), kind: "road", attributes: {} }, 5000)).toEqual([2]);
  expect(width({ ...river([10, 10]), attributes: {} }, 5000)[0]).toBeGreaterThan(0);
});
it("distinguishes subsurface fault traces from topographic and landform boundaries", () => {
  const fault = { ...river([10, 10]), kind: "fault", layerId: "faults", attributes: {} };
  const style = styles(fault, 5000)[0];
  expect(style.getStroke()?.getLineDash()).toEqual([6, 4]);
  expect(style.getStroke()?.getWidth()).toBe(1);
});

it("uses biome colors for ecological polygons and preserves thematic rules in GeoStyler", async () => {
  const ecology = { ...layer, layerId: "ecology", color: "#588860" };
  const colors = ["forest", "wetland", "ember", "grassland"].map((kind) => {
    const feature = {
      ...river([]),
      kind,
      layerId: "ecology",
      geometry: rectangle([0, 0, 100, 100]),
      attributes: { biome: "Named region" },
    };
    const style = featureStyle(feature, ecology, 1000) as Style;
    expect(style.getStroke()?.getColor()).toBe(biomeFamilies.find((b) => b.kind === kind)!.color);
    return style.getFill()?.getColor();
  });
  expect(new Set(colors).size).toBe(4);
  const symbols = defaultSymbolStyle("Biomes", ecology, ["Polygon"]);
  expect(symbols.rules.find((rule) => rule.name === "Ember grove")?.filter).toEqual([
    "==",
    "kind",
    "ember",
  ]);
  const parsed = await new Parser().writeStyle(symbols);
  expect(parsed.errors ?? []).toEqual([]);
});
it("marks generated magic places by rule so springs, vents and crush zones differ", async () => {
  const magic = { ...layer, layerId: "magic", color: "#c199ee" };
  const place = (system: string, rule: string): AtlasFeature => ({
    ...river([]),
    kind: `${system}:${rule}`,
    layerId: "magic",
    geometry: { type: "Point", coordinates: [0, 0] },
    attributes: { system, rule, placeType: rule },
  });
  const styled = ["spring", "vent", "crush", "field"].map(
    (rule) =>
      featureStyle(place(rule === "crush" ? "pressure" : "fire", rule), magic, 1000) as Style
  );
  expect(new Set(styled.map((style) => style.getStroke()?.getColor())).size).toBe(4);
  expect(styled[0].getStroke()?.getColor()).toBe(magicPlacePresentations.spring.color);
  expect((styled[1].getImage() as RegularShape).getPoints()).toBe(4);
  expect(styled[0].getImage()).toBeInstanceOf(Circle);
  const authored = { ...place("fire", "spring"), kind: "magicSource", attributes: {} };
  expect((featureStyle(authored, magic, 1000) as Style).getStroke()?.getColor()).toBe(magic.color);
  const symbols = defaultSymbolStyle("Magic", magic, ["Point"]);
  expect(symbols.rules.find((rule) => rule.name === "Vent")?.filter).toEqual([
    "==",
    "rule",
    "vent",
  ]);
  const parsed = await new Parser().writeStyle(symbols);
  expect(parsed.errors ?? []).toEqual([]);
});
