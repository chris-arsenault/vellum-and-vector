import type { FeatureContributionContext, GenerationFeature } from "./features";
import { atlasParameterDefinitions } from "./atlasParameters";
import { operation } from "./domainContributions";
import { landmarksInExtent } from "./landmarkSelection";
import { physicalApplicability } from "./physicalApplicability";

/**
 * At a top-level run the generator sites the configured number of landmarks itself, so the
 * capability always applies there; a child run only carries the records that reach its extent.
 */
function landmarksApply(context: FeatureContributionContext) {
  const area = context.source.world.areas[context.input.areaId];
  if (!area.parentId) return true;
  return landmarksInExtent(context.source, context.input).length > 0;
}

/**
 * Major landmarks: causes injected after the epoch's seeded events, signatures restored
 * before the epoch's history is kept.
 */
export const landmarkFeature: GenerationFeature = {
  id: "physical.landmarks",
  label: "Major landmarks",
  applicability: physicalApplicability["physical.landmarks"],
  cartography: [],
  domains: ["physical"],
  defaultEnabled: true,
  settings: {
    landscapeLandmarks: atlasParameterDefinitions.landscapeLandmarks,
    magicLandmarks: atlasParameterDefinitions.magicLandmarks,
  },
  legacyParameters: ["landscapeLandmarks", "magicLandmarks"],
  processes: ["landmark.emplace", "landmark.maintain"],
  slots: ["epoch.landmarks", "epoch.landmark-maintenance"],
  requires: ["physical.foundation"],
  absent: [],
  contribute(slot, _configuration, context) {
    if (!context || !landmarksApply(context)) return [];
    if (slot === "epoch.landmarks") return [operation("landmark.emplace", "1")];
    if (slot === "epoch.landmark-maintenance") return [operation("landmark.maintain", "1")];
    return [];
  },
};
