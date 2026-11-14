import { type Layer } from "./model";
export declare function builtinLayers(): Layer[];
export declare function layerSupports(
  layer: Layer,
  representation: "field" | "vector" | "network"
): boolean;
