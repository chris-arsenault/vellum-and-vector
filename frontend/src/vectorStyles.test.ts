import { expect, it } from "vitest";
import { Style } from "ol/style.js";
import { featureStyle, defaultSymbolStyle } from "./vectorStyles";
import { biomeFamilies, rectangle } from "@atlas/domain";
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
  const colors = ["forest", "wetland", "altered", "grassland"].map((kind) => {
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
  expect(symbols.rules.find((rule) => rule.name === "Altered land")?.filter).toEqual([
    "==",
    "kind",
    "altered",
  ]);
  const parsed = await new Parser().writeStyle(symbols);
  expect(parsed.errors ?? []).toEqual([]);
});
