import type { FieldStyle, Raster, RasterPresentation, World } from "./types";
import { rasterLimits } from "./rasterTiles";
import { ecologyLabels, fieldCategories, spatial } from "@atlas/domain";
import type { Geometry } from "geojson";

export const palettes = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  magma: ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"],
  blueRed: ["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#b2182b"],
  terrain: ["#dae3bd", "#becda5", "#c3c3a8", "#d5ccba", "#f3f1e7"],
};
export function defaultRasterPresentation(): RasterPresentation {
  return {
    base: "topographic",
    sunAzimuth: 315,
    sunElevation: 45,
    exaggeration: 1,
    contourInterval: 100,
    fields: [{ ...defaultFieldStyle("biome"), opacity: 0.55 }],
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
  if (ecologyLabels[channel]) return ecologyLabels[channel];
  const [kind, id, ...rest] = channel.split(":");
  const readable = (name: string) =>
    name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  const names: Record<string, string> = {
    flow: "River flow",
    finalSurface: "Land cover",
    naturalSurface: "Natural land cover",
  };
  if (!id) return names[channel] ?? readable(channel);
  const entity = world.entities[id] ?? world.magicSystems?.find((s) => s.id === id);
  return `${entity?.name ?? readable(id)}${rest.length ? ` · ${readable(rest.join(" · "))}` : ` · ${readable(kind)}`}`;
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

/** Follow the same coarse-to-fine part order as the raster layer group. */
export function rasterCategories(data: Raster[]): number[] {
  const result = new Set<number>();
  let covered: Geometry | null = null;
  for (const raster of data.slice().reverse()) {
    const visible = covered ? spatial.difference(raster.footprint, covered) : raster.footprint;
    if (visible)
      for (const code of fieldCategories(raster.field, raster.channel, visible)) result.add(code);
    covered = covered ? spatial.union(covered, raster.footprint) : raster.footprint;
  }
  return [...result].sort((a, b) => a - b);
}
// Signed log retains zeros and negative anomalies while compressing large magnitudes.
export function scaledValue(value: number, scale: FieldStyle["scale"]) {
  return scale === "log" ? Math.sign(value) * Math.log(1 + Math.abs(value)) : value;
}
export function legendValue(t: number, range: number[], scale: FieldStyle["scale"]) {
  const value = scaledValue(range[0], scale) * (1 - t) + scaledValue(range[1], scale) * t;
  return scale === "log" ? Math.sign(value) * Math.expm1(Math.abs(value)) : value;
}
