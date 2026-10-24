import { expect, it } from "vitest";
import Feature from "ol/Feature.js";
import { Style, Stroke, Text } from "ol/style.js";
import type { StyleFunction } from "ol/style/Style.js";
import { describeFeature } from "@atlas/domain";
import { createWorld } from "./atlasState";
import { typeStyle } from "./typeStyles";
import type { AtlasFeature, LayerStyle } from "./types";

it("applies type visibility and label overrides to an existing advanced renderer", () => {
  const world = createWorld({ name: "Types", seed: 1, width: 1000, height: 1000 });
  const f = {
    kind: "waterfall",
    layerId: "geology",
    attributes: {},
    name: "Falls",
  } as AtlasFeature;
  const type = describeFeature(world, f),
    ol = new Feature({ domain: f });
  const style: LayerStyle = {
    layerId: "geology",
    visible: true,
    color: "#000000",
    opacity: 1,
    minScale: 0,
    types: { [type.id]: { visible: false } },
  };
  const parsed = new Style({
    stroke: new Stroke({ color: "#ffffff", width: 7 }),
    text: new Text({ text: "Falls" }),
  });
  expect((typeStyle(world, style, parsed) as StyleFunction)(ol, 100)).toEqual([]);
  style.types![type.id] = { visible: true, labels: false, color: "#ff0000" };
  const output = (typeStyle(world, style, parsed) as StyleFunction)(ol, 100) as Style[];
  expect(output[0].getText()).toBeNull();
  expect(output[0].getStroke()?.getWidth()).toBe(7);
  expect(output[0].getStroke()?.getColor()).toEqual([255, 0, 0, 1]);
  expect(parsed.getText()).not.toBeNull();
});
