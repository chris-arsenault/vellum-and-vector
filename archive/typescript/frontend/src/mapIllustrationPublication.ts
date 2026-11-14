import type { DomainSnapshot, FeatureReader } from "@atlas/domain";
import type { IllustrationGeometry } from "@atlas/map";
import { drawingGeography, drawingOceans } from "./drawnGeography";
import { mapFeatureRecords, mapPresentedFeatures } from "./mapFeaturePublication";
import { mapSnapshotRasters } from "./mapSnapshotRasters";

const landLayers = new Set(["sovereignty", "control", "claims", "administration", "ecology"]);

/** Resolve coastlines and shared cartographic borders before generation inputs are released. */
export async function* mapIllustrationGeometry(
  snapshot: DomainSnapshot,
  reader: FeatureReader
): AsyncGenerator<IllustrationGeometry> {
  const { world, scope } = snapshot;
  const base = [
    ...mapSnapshotRasters(snapshot, scope.areaId, () =>
      mapFeatureRecords(world, scope.areaId, reader, "lakes")
    ),
  ].filter((raster) => raster.channel === "Elevation");
  const features = [...mapPresentedFeatures(world, scope.areaId, reader)].filter(
    (feature) => landLayers.has(feature.layerId) || ["lake", "ocean"].includes(feature.kind)
  );
  for (const ocean of drawingOceans(features, base))
    yield { featureId: null, geometry: ocean as IllustrationGeometry["geometry"] };
  const shapes = drawingGeography(features, base);
  for (const feature of features) {
    if (!landLayers.has(feature.layerId) || !feature.geometry.type.includes("Polygon")) continue;
    yield {
      featureId: feature.id,
      geometry: shapes.get(feature.id) as IllustrationGeometry["geometry"],
    };
  }
}
