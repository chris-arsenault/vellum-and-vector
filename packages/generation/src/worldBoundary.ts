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
