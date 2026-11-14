import { expect, it } from "vitest";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import Feature from "ol/Feature.js";
import { updateRegionMap } from "./regionMap";
import type { MapEngine } from "./mapEngine";

it("removes previous region outlines when the active map has no region presentation", () => {
  const regions = new VectorLayer({ source: new VectorSource() });
  regions.getSource()!.addFeature(new Feature());
  regions.getSource()!.set("signature", "previous map");
  regions.set("currentRegion", "previous region");
  updateRegionMap({ regions } as MapEngine, undefined);
  expect(regions.getSource()!.getFeatures()).toHaveLength(0);
  expect(regions.get("currentRegion")).toBeNull();
});
