import { expect, it } from "vitest";
import { realScaleStyle, roofColour } from "./realScaleStyles";
import { cityRoadStyle } from "./cityGroundStyle";
import { footpathColour, footpathStroke } from "./roadStyles";
import Feature from "ol/Feature.js";
import type { StyleFunction } from "ol/style/Style.js";
import type { PublishedFeature } from "./publishedAppearance";
import type { LayerStyle } from "./types";
import type { MapDescriptor, MapSpace } from "@atlas/map";
import {
  defaultRealScalePresentation,
  formatDistance,
  isHexLayer,
  realScaleFrame,
  realScaleStyles,
  shownSpace,
  undergroundSpace,
} from "./realScale";

const style = (layerId: string): LayerStyle => ({
  layerId,
  visible: false,
  opacity: 1,
  color: "#000000",
  labels: false,
  minScale: 0,
});

it("draws a distinct roof colour for each published building function", () => {
  expect(["residential", "civic", "economic"].map(roofColour)).toEqual([
    "#ab6e58",
    "#587689",
    "#bc883a",
  ]);
  expect(roofColour(undefined)).toBeUndefined();
});
it("draws surveyed paths at their physical width and distinguishes traffic at every scale", () => {
  const light = footpathColour(0.25, 0.7),
    worn = footpathColour(25, 0.7);
  expect(light[3]).toBeLessThan(worn[3] / 2);
  expect(footpathStroke(0.7, 5, light).getWidth()).toBeCloseTo(0.14);
  expect(footpathStroke(0.7, 0.5, worn).getWidth()).toBeCloseTo(1.4);
  const narrow = footpathColour(0.25, 0.35);
  expect(0.35 * narrow[3]).toBeCloseTo(0.7 * light[3]);
  const domain = {
    kind: "footpath",
    layerId: "roads",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [20, 0],
      ],
    },
    footprint: {
      type: "Polygon",
      coordinates: [
        [
          [0, -0.35],
          [20, -0.35],
          [20, 0.35],
          [0, 0.35],
          [0, -0.35],
        ],
      ],
    },
    attributes: { wear: 0.25, widths: [0.7, 0.7] },
  };
  const paint = realScaleStyle(style("roads"), defaultRealScalePresentation(), "") as StyleFunction;
  const styles = paint(new Feature({ domain }), 5);
  if (!Array.isArray(styles)) throw new Error("Expected the published path footprint");
  expect(styles).toHaveLength(1);
  expect(styles[0].getFill()?.getColor()).toEqual(light);
  expect(styles[0].getStroke()).toBeNull();
});

it("keeps the City's arterial visible above local lanes at overview and uses its surveyed carriageway at detail", () => {
  const avenue = {
    kind: "thoroughfare",
    name: "Market Road",
    layerId: "roads",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [50, 0],
      ],
    },
    footprint: {
      type: "Polygon",
      coordinates: [
        [
          [0, -3],
          [50, -3],
          [50, 3],
          [0, 3],
          [0, -3],
        ],
      ],
    },
    attributes: { arterialStrength: 0.8, widths: [6, 6] },
  } as unknown as PublishedFeature;
  const styling = realScaleStyle(
    style("roads"),
    defaultRealScalePresentation(),
    ""
  ) as StyleFunction;
  const paint = (domain: PublishedFeature, resolution: number) => {
    const styles = styling(new Feature({ domain }), resolution);
    if (!Array.isArray(styles)) throw new Error("Expected ground styles");
    return styles;
  };
  const stroke = (f: PublishedFeature) => paint(f, 15).at(-1)?.getStroke()?.getWidth();
  expect(stroke(avenue)).toBe(cityRoadStyle(avenue, 15, "#555")?.getStroke()?.getWidth());
  expect(
    stroke({ ...avenue, kind: "street", attributes: { roadClass: "lane", widths: [3, 3] } })
  ).toBeLessThan(stroke(avenue)!);
  expect(paint(avenue, 0.5)[0].getFill()).toBeTruthy();
  expect(paint(avenue, 0.5).at(-1)?.getStroke()).toBeNull();
  const tree: PublishedFeature = {
    ...avenue,
    kind: "tree",
    layerId: "objects",
    footprint: null,
    geometry: { type: "Point" as const, coordinates: [10, 10] },
  };
  expect(paint(tree, 15)).toHaveLength(0);
  expect(paint(tree, 0.5)[0].getImage()).toBeTruthy();
});

it("draws real-scale kinds top first, from hexes down to water, and shows them", () => {
  const styles = realScaleStyles(
    ["vector:settlements", "vector:rivers", "vector:hexes", "vector:objects", "vector:roads"].map(
      style
    )
  );
  expect(styles.map((entry) => entry.layerId)).toEqual([
    "vector:hexes",
    "vector:objects",
    "vector:roads",
    "vector:rivers",
    "vector:settlements",
  ]);
  expect(styles.find((entry) => entry.layerId === "vector:rivers")?.visible).toBe(true);
  expect(styles.find((entry) => entry.layerId === "vector:settlements")?.visible).toBe(false);
});

it("shows the caves' underground space only on a map that has one", () => {
  const space = (id: string, parentSpaceId: string | null, floor: string | null) =>
    ({ id, parentSpaceId, frame: { origin: [0, 0, 0], rotation: 0, floor } }) as MapSpace;
  const map = {
    primarySpaceId: "glen",
    spaces: [space("world", null, null), space("glen", "world", null)],
  } as MapDescriptor;
  expect(undergroundSpace(map)).toBeUndefined();
  expect(shownSpace(map, { ...defaultRealScalePresentation(), space: "glen:underground" })).toBe(
    "glen"
  );
  const caves = {
    ...map,
    spaces: [...map.spaces, space("glen:underground", "glen", "underground")],
  };
  expect(undergroundSpace(caves)?.id).toBe("glen:underground");
  expect(shownSpace(caves, { ...defaultRealScalePresentation(), space: "glen:underground" })).toBe(
    "glen:underground"
  );
  expect(shownSpace(caves)).toBe("glen");
  expect([isHexLayer("caveHexes"), isHexLayer("caves")]).toEqual([true, false]);
});

it("states distances in the reader's units", () => {
  expect(formatDistance(1.524, "feet")).toBe("5 ft");
  expect(formatDistance(30, "metres")).toBe("30.0 m");
  expect(formatDistance(2500, "metres")).toBe("2.50 km");
  expect(formatDistance(1609.344 * 2, "feet")).toBe("2.00 mi");
});

it("opens a 4:3 frame of the chosen hexes across", () => {
  expect(realScaleFrame({ kind: "ground", hexSize: "1.5m", hexesAcross: 50 })).toEqual({
    width: 75,
    height: 56.25,
  });
});
