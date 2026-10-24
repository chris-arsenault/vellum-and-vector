import type { FeatureSelection } from "./features";
import type { DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import { mapBoundaryValue } from "./atlasParameters";
import type { Diagnostic } from "@atlas/domain";

export function boundaryDiagnostics(input: AtlasGenerationInput): Diagnostic[] {
  return input.parameters?.mapBoundary === 2
    ? [
        {
          severity: "error",
          invocation: null,
          resource: null,
          code: "map_boundary_unavailable",
          message: "Ocean surrounded is not available yet. Choose Cylinder or Nothing.",
        },
      ]
    : [];
}

export function inheritMapBoundary(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  existing = false
): AtlasGenerationInput {
  const area = source.world.areas[input.areaId];
  if (
    !existing &&
    !area?.parentId &&
    !source.world.generations.some((run) => run.domains.includes("physical"))
  )
    return input;
  const mapBoundary = mapBoundaryValue(source.world.reference.boundaryMode);
  const foundation = input.features?.["physical.foundation"];
  return {
    ...input,
    parameters: { ...input.parameters, mapBoundary },
    ...(foundation
      ? {
          features: {
            ...input.features,
            "physical.foundation": {
              ...foundation,
              settings: { ...foundation.settings, mapBoundary },
            },
          },
        }
      : {}),
  };
}

/** Older climate recipes stored the longitude choice before it owned world topology. */
export function migrateBoundarySelection(selection: FeatureSelection | undefined) {
  const climate = selection?.["physical.climate"];
  if (!climate?.settings || typeof climate.settings.wrapLongitude !== "number") return selection;
  const { wrapLongitude, ...settings } = climate.settings;
  const foundation = selection!["physical.foundation"] ?? { enabled: true };
  return {
    ...selection,
    "physical.climate": { ...climate, settings },
    "physical.foundation": {
      ...foundation,
      settings: {
        mapBoundary: wrapLongitude,
        ...foundation.settings,
      },
    },
  };
}
