import type { GenerationFeature } from "./features";
import { operation } from "./domainContributions";
import { landmarksInExtent } from "./landmarkSelection";
import { physicalApplicability } from "./physicalApplicability";

/**
 * Authored landmarks: causes injected after the epoch's seeded events, signatures restored
 * before the epoch's history is kept. Nothing runs when no landmark lies in the extent.
 */
export const landmarkFeature: GenerationFeature = {
  id: "physical.landmarks",
  label: "Major landmarks",
  applicability: physicalApplicability["physical.landmarks"],
  cartography: [],
  domains: ["physical"],
  defaultEnabled: true,
  settings: {},
  legacyParameters: [],
  processes: ["landmark.emplace", "landmark.maintain"],
  slots: ["epoch.landmarks", "epoch.landmark-maintenance"],
  requires: ["physical.foundation"],
  absent: [],
  contribute(slot, _configuration, context) {
    if (!context || !landmarksInExtent(context.source, context.input).length) return [];
    if (slot === "epoch.landmarks") return [operation("landmark.emplace", "1")];
    if (slot === "epoch.landmark-maintenance") return [operation("landmark.maintain", "1")];
    return [];
  },
};
