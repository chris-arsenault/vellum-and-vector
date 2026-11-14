import { resourceRaster, type FieldStyle, type Raster, type World } from "./types";
import { rasterLimits } from "./rasterTiles";
import {
  biomes,
  canonryConfluencePresets,
  ecologyLabels,
  fieldCategories,
  spatial,
  surfaceCategories,
  type SurfaceCategory,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { surfaceMaterialCategories } from "@atlas/generation";
import { fieldClasses, fieldName } from "./fieldNames";
import { scaledValue } from "./rasterColors";
export { palettes, scaledValue } from "./rasterColors";
export { defaultRasterPresentation, defaultFieldStyle } from "./rasterDefaults";
/** Class colours for categorical channels; null for continuous ones. */
export function categoryPalette(world: World, channel: string): SurfaceCategory[] | null {
  if (channel === "SurfaceMaterial") return surfaceMaterialCategories;
  if (channel === "BiomeCodes")
    return biomes.map((biome, code) => ({
      code,
      name: biome.name,
      color: biome.color,
      bathymetric: false,
      tint: 1,
    }));
  if (channel === "naturalSurface") return surfaceCategories();
  if (channel === "finalSurface" || channel === "secondSurface")
    return surfaceCategories(
      world.magicSystems ?? [],
      world.confluences ?? canonryConfluencePresets()
    );
  return fieldClasses(world, channel);
}
export const surfacePalette = (world: World) => categoryPalette(world, "finalSurface")!;
export function fieldLabel(world: World, channel: string) {
  if (ecologyLabels[channel]) return ecologyLabels[channel];
  const named = fieldName(channel);
  if (named) return named.label;
  const [kind, id, ...rest] = channel.split(":");
  const readable = (name: string) =>
    name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  const names: Record<string, string> = {
    FlowAccumulation: "River flow",
    finalSurface: "Land cover",
    secondSurface: "Land cover · second class",
    naturalSurface: "Natural land cover",
    SurfaceMaterial: "Surface material",
  };
  if (!id) return names[channel] ?? readable(channel);
  return identityFieldLabel(world, kind, id, rest, readable);
}
function identityFieldLabel(
  world: World,
  kind: string,
  id: string,
  rest: string[],
  readable: (text: string) => string
) {
  const entity = world.entities[id] ?? world.magicSystems?.find((s) => s.id === id);
  const terms: Record<string, string> = { languageUse: "Naming use", language: "Knowledge" };
  const suffix = rest.length ? readable(rest.join(" · ")) : (terms[kind] ?? readable(kind));
  return `${entity?.name ?? readable(id)} · ${suffix}`;
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
    if (resourceRaster(raster)) {
      for (const code of raster.field.channels[raster.channel]?.categories ?? []) result.add(code);
    } else if (visible)
      for (const code of fieldCategories(raster.field, raster.channel, visible)) result.add(code);
    covered = covered ? spatial.union(covered, raster.footprint) : raster.footprint;
  }
  return [...result].sort((a, b) => a - b);
}
export function legendValue(t: number, range: number[], scale: FieldStyle["scale"]) {
  const value = scaledValue(range[0], scale) * (1 - t) + scaledValue(range[1], scale) * t;
  return scale === "log" ? Math.sign(value) * Math.expm1(Math.abs(value)) : value;
}
