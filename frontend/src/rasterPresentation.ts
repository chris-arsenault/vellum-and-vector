import type { FieldStyle, Raster, RasterPresentation, World } from "./types";
import { rasterLimits } from "./rasterTiles";

export const palettes = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  magma: ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"],
  blueRed: ["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#b2182b"],
  terrain: ["#a1b37e", "#8ca472", "#ab9e80", "#c1b49f", "#f1f0e7"],
};
export function defaultRasterPresentation(): RasterPresentation {
  return {
    base: "topographic",
    sunAzimuth: 315,
    sunElevation: 45,
    exaggeration: 1,
    contourInterval: 100,
    fields: [],
  };
}
export function defaultFieldStyle(channel: string): FieldStyle {
  return {
    channel,
    visible: true,
    opacity: 0.65,
    palette: "viridis",
    scale: "linear",
    range: null,
  };
}
export function fieldLabel(world: World, channel: string) {
  const [kind, id, ...rest] = channel.split(":");
  if (!id) return channel.replace(/([a-z])([A-Z])/g, "$1 $2");
  const entity = world.entities[id] ?? world.magicSystems?.find((s) => s.id === id);
  return `${kind} · ${entity?.name ?? id}${rest.length ? ` · ${rest.join(" · ")}` : ""}`;
}
export function fieldRange(data: Raster[], style: FieldStyle): [number, number] {
  if (style.range) return style.range;
  const ranges = data.map((raster) => {
    let range = dataRanges.get(raster);
    if (!range) {
      range = rasterLimits([raster]);
      dataRanges.set(raster, range);
    }
    return range;
  });
  const limits = ranges.length
    ? [Math.min(...ranges.map((range) => range[0])), Math.max(...ranges.map((range) => range[1]))]
    : [0, 1];
  return [limits[0], limits[1] > limits[0] ? limits[1] : limits[0] + 1];
}
const dataRanges = new WeakMap<Raster, number[]>();
// Signed log retains zeros and negative anomalies while compressing large magnitudes.
export function scaledValue(value: number, scale: FieldStyle["scale"]) {
  return scale === "log" ? Math.sign(value) * Math.log(1 + Math.abs(value)) : value;
}
export function legendValue(t: number, range: number[], scale: FieldStyle["scale"]) {
  const value = scaledValue(range[0], scale) * (1 - t) + scaledValue(range[1], scale) * t;
  return scale === "log" ? Math.sign(value) * Math.expm1(Math.abs(value)) : value;
}
