import type { ResourceRaster, FieldReference, RasterGeographyReference } from "./types";

function fieldIdentity(field: FieldReference | undefined) {
  return field && [field.resourceId, field.patches];
}
export function rasterGeographyKey(reference: RasterGeographyReference) {
  const { scope, areaId, geographyId, windows, tolerance, revision } = reference;
  return JSON.stringify([
    scope.worldId,
    scope.spaceId,
    scope.areaId,
    areaId,
    geographyId,
    windows,
    tolerance,
    revision,
  ]);
}
/** Immutable identities avoid serializing geometry or numerical samples during UI comparisons. */
export function rasterIdentity(raster: ResourceRaster) {
  return JSON.stringify([
    raster.id,
    raster.channel,
    raster.areaId,
    raster.wrap,
    fieldIdentity(raster.field),
    fieldIdentity(raster.water),
    fieldIdentity(raster.ice),
    fieldIdentity(raster.surface),
    rasterGeographyKey(raster.geography),
  ]);
}
