import { areaSpace, spatial, requireThat, type World, type ReadRequirements } from "@atlas/domain";
import type { AnalysisInput } from "./spatialAnalysis";

/** Analysis reads its selected geometry, channel or connected graph, never generation inputs. */
export function analysisRequirements(world: World, input: AnalysisInput): ReadRequirements {
  const area = world.areas[input.areaId];
  requireThat(area, "missing_area", "Choose an existing mapped area.");
  const spaceId = areaSpace(world, area.id),
    footprint = analysisFootprint(input);
  const result: ReadRequirements = {
    scope: {
      worldId: world.id,
      areaId: area.id,
      spaceId,
      crsId: world.reference.id,
      revision: world.version,
      footprint,
      time: "present",
      resolution: null,
    },
    objects: [],
    spatialLayers: [],
    channels: [],
    parentHistory: [],
    dependencies: false,
  };
  switch (input.operation) {
    case "intersect":
      result.references = featureIds(input.targetFeatureId);
      break;
    case "nearby":
      result.spatialLayers = input.layer ? [input.layer] : Object.keys(world.layers);
      break;
    case "dependencies":
      result.references = featureIds(input.featureId);
      result.referencesTo = result.references;
      result.constraints = { intersectingAreas: true, descendantsOf: [], boundaryFeatures: [] };
      break;
    case "fieldStatistics":
      result.channels = world.fields
        .filter(
          (field) =>
            field.spaceId === spaceId &&
            field.channels?.includes(input.channel ?? "") &&
            spatial.intersects(field.footprint ?? world.areas[field.areaId].footprint, footprint)
        )
        .map((field) => ({ fieldId: field.id, names: [input.channel!] }));
      break;
    case "networkPath":
    case "circulation":
      result.connected = {
        featureIds: featureIds(input.featureId, input.targetFeatureId),
        mode: input.operation === "networkPath" ? "network" : "circulation",
      };
      break;
  }
  return result;
}
function featureIds(...ids: (string | null)[]) {
  return ids.filter((id): id is string => id !== null);
}
function analysisFootprint(input: AnalysisInput) {
  return input.operation === "nearby" && input.distance > 0
    ? (spatial.buffer(input.geometry, input.distance) ?? input.geometry)
    : input.geometry;
}
