import { expect, it } from "vitest";
import { roofColour } from "./realScaleStyles";
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
