import type { Geometry } from "geojson";
import type { DrawnMapInput } from "./drawnMap";
import type { IllustrationReply } from "./illustrationProtocol";
import { bounds } from "./presentation";
import { rasterGeographyKey } from "./rasterIdentity";
import { resourceRaster, type Raster } from "./types";

export type StoredDrawing = Omit<IllustrationReply, "id" | "geography" | "error"> & {
  geography: [string, Geometry | null][];
};
function positions(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return typeof value[0] === "number" ? 1 : value.reduce((sum, v) => sum + positions(v), 0);
}
function geometrySize(geometry: Geometry): number {
  return geometry.type === "GeometryCollection"
    ? geometry.geometries.reduce((sum, g) => sum + geometrySize(g), 0)
    : positions(geometry.coordinates);
}
const rasterKey = (raster: Raster) =>
  [
    raster.id,
    raster.channel,
    resourceRaster(raster) ? rasterGeographyKey(raster.geography) : raster.field.id,
  ].join(":");
/** One stored product per subject and display scale; the stamp names every input it was
 * assembled from, so any change to them assembles it again. */
export function drawingIdentity(input: DrawnMapInput, footprint: Geometry) {
  const subject = input.region?.id ?? input.area.id;
  const scale = [...input.base, ...input.rasters].map((r) =>
    resourceRaster(r) ? r.geography.tolerance : 0
  )[0];
  return {
    family: `drawn:${subject}:${scale ?? "vector"}`,
    stamp: JSON.stringify([
      input.world.version,
      bounds(footprint),
      input.view,
      input.base.map(rasterKey),
      input.rasters.map(rasterKey),
      input.features.map((f) => `${f.id}:${geometrySize(f.geometry)}`),
    ]),
  };
}
