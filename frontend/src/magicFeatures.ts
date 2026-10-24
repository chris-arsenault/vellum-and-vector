import { authoredMagicFeatures, presentAtlasFeature, spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { AtlasFeature, World } from "./types";

export function magicFeatures(world: World, areaId: string, footprint: Geometry): AtlasFeature[] {
  return authoredMagicFeatures(world).flatMap((source) => {
    const feature = presentAtlasFeature(world, source, areaId);
    return feature && spatial.intersects(feature.geometry, footprint) ? [feature] : [];
  });
}
