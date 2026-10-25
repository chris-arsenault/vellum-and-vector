import {
  authoredLandmarkFeatures,
  authoredMagicFeatures,
  presentAtlasFeature,
  spatial,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { AtlasFeature, World } from "./types";

function presented(world: World, areaId: string, footprint: Geometry, features: AtlasFeature[]) {
  return features.flatMap((source) => {
    const feature = presentAtlasFeature(world, source, areaId);
    return feature && spatial.intersects(feature.geometry, footprint) ? [feature] : [];
  });
}
export function magicFeatures(world: World, areaId: string, footprint: Geometry): AtlasFeature[] {
  return presented(world, areaId, footprint, authoredMagicFeatures(world));
}
export function landmarkFeatures(
  world: World,
  areaId: string,
  footprint: Geometry
): AtlasFeature[] {
  return presented(world, areaId, footprint, authoredLandmarkFeatures(world));
}
/** World-owned authored inputs that the scene shows beside the area's features. */
export function authoredInputFeatures(world: World, areaId: string, footprint: Geometry) {
  return [
    ...magicFeatures(world, areaId, footprint),
    ...landmarkFeatures(world, areaId, footprint),
  ];
}
