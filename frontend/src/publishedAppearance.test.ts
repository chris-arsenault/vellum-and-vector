import { expect, it } from "vitest";
import Feature from "ol/Feature.js";
import { Style, Stroke, Text } from "ol/style.js";
import type { StyleFunction } from "ol/style/Style.js";
import type { MapFeature } from "@atlas/map";
import { descriptor } from "./testSupport/mapProductFixture";
import { publishedAppearance, publishedFeature, publishedStyles } from "./publishedAppearance";
import { typeStyle } from "./typeStyles";
import { publishedStreetScene, publishedWindows, streetSceneStages } from "./publishedScene";

function fixture() {
  const map = descriptor("styles"),
    layer = map.layers[0];
  layer.id = "vector:rivers";
  layer.catalog.featureTypes = [
    {
      id: "river",
      kind: "river",
      label: "Rivers",
      path: ["Water", "Rivers"],
      magicDepiction: null,
      count: 1,
      geometries: ["LineString"],
      footprints: false,
    },
  ];
  layer.catalog.defaultStyle = {
    visible: true,
    opacity: 1,
    color: "#397d99",
    labels: true,
    minScale: 0,
    types: {},
    groups: {},
    symbols: null,
    filter: null,
  };
  const feature: MapFeature = {
    id: "river",
    name: "Branch",
    entityId: null,
    spaceId: "surface",
    layerId: layer.id,
    kind: "river",
    typeId: "river",
    catalog: { values: {}, origin: "Generated geography", mapOnly: false },
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [5, 5],
        [10, 10],
      ],
    },
    footprint: null,
    attributes: { widths: [20, 40, 80], flowingMonths: [12, 12, 6] },
    relations: [],
    causes: [],
  };
  return { map, layer, feature };
}
it("draws the published river's measured widths and seasonal stretches", () => {
  const { map, feature } = fixture();
  const appearance = publishedAppearance(map, []),
    style = publishedStyles(map)[0];
  const render = typeStyle(appearance, { ...style, layerId: "rivers" }) as StyleFunction;
  const output = render(new Feature({ domain: publishedFeature(feature) }), 1) as Style[];
  expect(output.slice(1).map((entry) => entry.getStroke()?.getWidth())).toEqual([30, 60]);
  expect(output[1].getStroke()?.getLineDash()).toBeNull();
  expect(output[2].getStroke()?.getLineDash()).toEqual([8, 5]);
});
it("keeps published classifications, relation names and type overrides outside the renderer", () => {
  const { map, layer, feature } = fixture();
  layer.catalog.featureTypes[0].magicDepiction = "course";
  feature.geometry = map.footprint;
  feature.relations = [{ kind: "sovereign", targetId: "country", targetName: "River country" }];
  const record = publishedFeature(feature),
    appearance = publishedAppearance(map, []);
  expect(appearance.name(record)).toBe("River country");
  expect(appearance.magic(record)).toBe("course");
  layer.catalog.defaultStyle!.types.river = {
    visible: true,
    labels: false,
    footprints: null,
    color: "#ff0000",
    opacity: null,
  };
  const style = publishedStyles(map)[0];
  const symbol = new Style({
    stroke: new Stroke({ width: 7, color: "#ffffff" }),
    text: new Text({ text: "Branch" }),
  });
  const render = typeStyle(appearance, style, symbol) as StyleFunction;
  const output = render(new Feature({ domain: record }), 1) as Style[];
  expect(output[0].getStroke()?.getWidth()).toBe(7);
  expect(output[0].getStroke()?.getColor()).toEqual([255, 0, 0, 1]);
  expect(output[0].getText()).toBeNull();
  expect(symbol.getText()).not.toBeNull();
  style.groups = { '["Water"]': false };
  expect(render(new Feature({ domain: record }), 1)).toEqual([]);
});
it("queries both canonical windows while panning across a cylindrical map", () => {
  const space = descriptor("seam").spaces[0];
  space.periodicWidth = 10;
  expect(publishedWindows(space, [8, 2, 12, 6])).toEqual([
    [8, 2, 10, 6],
    [0, 2, 2, 6],
  ]);
  expect(publishedWindows(space, [-2, 2, 2, 6])).toEqual([
    [8, 2, 10, 6],
    [0, 2, 2, 6],
  ]);
  expect(publishedWindows(space, [-10, 2, 20, 6])).toEqual([[0, 2, 10, 6]]);
});
it("opens the requested Street layers from principal roads to detail, including unclassified roads", () => {
  const { map, layer } = fixture();
  const roadLayer = (id: string, kinds: string[]) => ({
    ...layer,
    id,
    catalog: {
      ...layer.catalog,
      featureTypes: kinds.map((kind) => ({
        ...layer.catalog.featureTypes[0],
        id: `type-${kind}`,
        kind,
      })),
    },
  });
  map.layers.push(
    roadLayer("vector:roads", ["thoroughfare", "street", "alley", "footpath"]),
    roadLayer("vector:roads@floor", []),
    roadLayer("vector:structures", ["building"]),
    roadLayer("vector:hexes", ["hex"]),
    roadLayer("vector:lakes", ["lake"])
  );
  const selected = map.layers
    .filter((entry) => entry.source.kind === "vector" && entry.id !== "vector:lakes")
    .map(({ id }) => id);
  expect(streetSceneStages(map, selected)).toEqual([
    [
      { layerIds: ["vector:rivers"] },
      { layerIds: ["vector:roads"], typeIds: ["type-thoroughfare"] },
    ],
    [
      { layerIds: ["vector:roads"], typeIds: ["type-street", "type-alley"] },
      { layerIds: ["vector:roads@floor"] },
    ],
    [{ layerIds: ["vector:structures"] }],
    [{ layerIds: ["vector:roads"], typeIds: ["type-footpath"] }, { layerIds: ["vector:hexes"] }],
  ]);
});
it("cancels superseded Street reads after the first visible geography", async () => {
  const { map, feature } = fixture();
  const abort = new AbortController();
  const reads: string[][] = [];
  const run = publishedStreetScene(
    {
      async features(_ref, query, options) {
        expect(options?.signal).toBe(abort.signal);
        reads.push(query.layerIds ?? []);
        return { items: [feature], next: null };
      },
    },
    map,
    map.primarySpaceId,
    map.bounds,
    ["vector:rivers", "vector:structures"],
    abort.signal,
    async (records) => {
      expect(records).toEqual([feature]);
      abort.abort();
    }
  );
  await expect(run).rejects.toMatchObject({ name: "AbortError" });
  expect(reads).toEqual([["vector:rivers"]]);
});
