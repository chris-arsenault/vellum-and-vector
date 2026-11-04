import { fixtureWorld } from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import Feature from "ol/Feature.js";
import { Style, Stroke, Text } from "ol/style.js";
import type { StyleFunction } from "ol/style/Style.js";
import { describeFeature } from "@atlas/domain";
import { typeStyle } from "./typeStyles";
import type { AtlasFeature, LayerStyle } from "./types";

it("applies type visibility and label overrides to an existing advanced renderer", async () => {
  const world = fixtureWorld({ name: "Types", seed: 1, width: 1000, height: 1000 });
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

it("draws a weighed place only where it clears the view's bar", () => {
  const world = fixtureWorld({ name: "Types", seed: 1, width: 1000, height: 1000 }),
    areaId = Object.keys(world.areas)[0],
    place = (importance: number) =>
      new Feature({
        domain: {
          kind: "waterfall",
          layerId: "geology",
          areaId,
          attributes: { importance },
          name: "Falls",
        } as unknown as AtlasFeature,
      }),
    style: LayerStyle = {
      layerId: "geology",
      visible: true,
      color: "#000000",
      opacity: 1,
      minScale: 0,
    },
    drawn = (importance: number, resolution: number) =>
      (
        (typeStyle(world, style, new Style()) as StyleFunction)(
          place(importance),
          resolution
        ) as Style[]
      ).length > 0,
    wholeMap = 1000 / 1600,
    closeUp = 1000 / 51200;
  expect(drawn(0.95, wholeMap)).toBe(true);
  expect(drawn(0.05, wholeMap)).toBe(false);
  expect(drawn(0.05, closeUp)).toBe(true);
});
