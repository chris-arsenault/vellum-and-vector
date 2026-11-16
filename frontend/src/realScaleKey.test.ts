import { expect, it } from "vitest";
import type { MapDescriptor, MapFeature } from "@atlas/map";
import { keyLayerIds, mapKey } from "./realScaleKey";

const feature = (id: string, attributes: MapFeature["attributes"], name: string | null = id) =>
  ({ id, name, kind: "spring", attributes }) as MapFeature;

it("lists numbered places in key order once, with their published account", () => {
  const key = mapKey([
    feature("b", { keyNumber: 2, account: "Spring, about 3.0 m across. Water rising." }),
    feature("a", { keyNumber: 1 }, null),
    feature("hex", { mark: "water" }),
    feature("b", { keyNumber: 2 }),
  ]);
  expect(key).toEqual([
    { id: "a", number: 1, name: "spring", account: "" },
    { id: "b", number: 2, name: "b", account: "Spring, about 3.0 m across. Water rising." },
  ]);
});

it("reads keys from vector layers other than the hexes", () => {
  const map = {
    layers: [{ id: "vector:geology" }, { id: "vector:hexes" }, { id: "raster:relief" }],
  } as unknown as MapDescriptor;
  expect(keyLayerIds(map)).toEqual(["vector:geology"]);
});
