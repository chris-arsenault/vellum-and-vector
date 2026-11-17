import type { HexClass, KindSize, MapDescriptor, MapFeature, MapLayer } from "@atlas/map";
import { vectorFamily } from "./publishedAppearance";

/** A feature of the surface hex grid or the caves' grid. */
export const isHex = (feature: MapFeature) =>
  ["hexes", "caveHexes"].includes(vectorFamily(feature.layerId));

/** Choices for placing one object and scattering many; the Rust commands own their shapes. */
export interface LandChoice {
  /** Degrees counter-clockwise from east. */
  rotation: number;
  scale: number;
  /** Least distance between scattered objects, in metres. */
  spacing: number;
  /** The same seed lays the same scatter again. */
  seed: number;
}
export const defaultLand = (): LandChoice => ({ rotation: 0, scale: 1, spacing: 1.5, seed: 1 });

/** The map's drawable layers and the latent ones it publishes (a ground map's cave walls
 * before it has caves): drawing into a latent layer opens it. */
export function withLatentLayers(map: MapDescriptor, layers: MapLayer[]): MapLayer[] {
  const latent = (map.realScale?.authoring.latentLayers ?? []).filter(
    (layer) => !map.layers.some((entry) => entry.id === layer.id)
  );
  return [...layers, ...latent];
}
/** A published layer of this family, on the map or latent. */
export const layerOf = (map: MapDescriptor, family: string) =>
  withLatentLayers(map, map.layers).find(
    (layer) => layer.source.kind === "vector" && vectorFamily(layer.id) === family
  );
/** The catalogue's true size of a kind, as the map publishes it. */
export function kindSize(map: MapDescriptor, layerId: string, kind: string): KindSize | undefined {
  return withLatentLayers(map, map.layers)
    .find((layer) => layer.id === layerId)
    ?.catalog.featureTypes.find((entry) => entry.kind === kind)?.trueSize;
}
export interface LineSize {
  label: string;
  /** Width given to every drawn point, in metres. */
  width: number;
}
/** Starting widths for a drawn line: its kind's narrow, typical and wide true size. */
export function lineSizes(size: KindSize | undefined): LineSize[] {
  if (!size) return [];
  return [
    { label: "Narrow", width: size.least },
    { label: "Typical", width: size.typical },
    { label: "Wide", width: size.largest },
  ];
}
export const groundClasses = (map: MapDescriptor): HexClass[] =>
  map.realScale?.authoring.groundClasses ?? [];
export const coverClasses = (map: MapDescriptor): HexClass[] =>
  map.realScale?.authoring.coverClasses ?? [];
/** The located space a layer's features lie in, once the map holds the layer. */
export const layerSpace = (map: MapDescriptor, layerId: string) =>
  map.layers.find((layer) => layer.id === layerId)?.spaceId;
