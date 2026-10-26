import { biomeFamilies } from "@atlas/domain";
import { Fill, Stroke, Style } from "ol/style.js";
import type { AtlasFeature } from "./types";
import type { DrawnIconKind } from "./drawnSymbols";

const motifs: Record<string, DrawnIconKind> = {
  forest: "broadleaf",
  grassland: "grass",
  wetland: "reeds",
  barren: "rock",
  ember: "grass",
  thaw: "grass",
  rime: "tree",
  glow: "rock",
  fog: "reeds",
  deepwood: "broadleaf",
  wending: "reeds",
  well: "grass",
  barrow: "grass",
  pan: "rock",
  flat: "rock",
};
export function biomeTreatment(feature: AtlasFeature) {
  if (feature.layerId !== "ecology") return null;
  const family = biomeFamilies.find((b) => b.kind === feature.kind);
  if (!family) return null;
  const name = String(feature.attributes.biome ?? "");
  const symbol = /desert|dune/i.test(name)
    ? "dune"
    : /boreal|conifer/i.test(name)
      ? "tree"
      : motifs[family.kind];
  return { ...family, symbol };
}
export function biomeStyle(feature: AtlasFeature, monochrome: boolean) {
  const biome = biomeTreatment(feature);
  return biome
    ? new Style({
        fill: new Fill({ color: monochrome ? "#8a816f24" : biome.color + "70" }),
        stroke: new Stroke({
          color: monochrome ? "#80745c70" : biome.color + "aa",
          width: 0.8,
          lineDash: [2, 4],
        }),
      })
    : null;
}
