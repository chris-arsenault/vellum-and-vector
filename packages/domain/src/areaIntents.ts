import { createAreaSchema } from "./authoringSchemas";
import { intentChanges, intentReads, type IntentRegistry, type IntentContext } from "./intent";
import type { z } from "zod";
import type { DomainSnapshot } from "./operations";
import { requireIdentity, requireRelations, upsertArea } from "./authoringBasics";
import { establishBoundary } from "./boundaryContracts";
import { validateAreaPlacement } from "./areaConstraints";
import { effectiveTraits, validateBoundaryTraits } from "./traits";
import { composeFeature, areaSpace } from "./composition";
import { spatial, Spatial } from "./spatial";
import { requireThat } from "./errors";
import { profiles, type Area } from "./model";
import { semanticId } from "./identity";
import { validateCoverage, type MaterializedCoverage } from "./coverage";
import { addLocatedAccess } from "./locatedAccess";
import { refinedDrainageFeatures } from "./drainageRefinement";
import { validateRegionRefinement } from "./regionRefinement";

type AreaInput = z.infer<typeof createAreaSchema>;
function areaRequirements(data: AreaInput, context: IntentContext) {
  const reads = intentReads(context, {
    objects: [
      { kind: "area", ids: [data.id, data.parentId] },
      ...(data.regionId ? [{ kind: "view" as const, ids: [data.regionId] }] : []),
      ...(data.contextFeatureId
        ? [{ kind: "feature" as const, ids: [data.contextFeatureId] }]
        : []),
    ],
    spatialLayers: context.layers.map((l) => l.id),
    constraints: { intersectingAreas: true, descendantsOf: [], boundaryFeatures: [] },
    channels: context.fields
      .filter(
        (f) =>
          f.channels !== null && (!f.footprint || spatial.intersects(f.footprint, data.footprint))
      )
      .map((f) => ({ fieldId: f.id, names: f.channels! })),
  });
  reads.scope = { ...reads.scope, footprint: data.footprint };
  return reads;
}
function evaluateArea(data: AreaInput, context: IntentContext, snapshot: DomainSnapshot) {
  const area = areaCandidate(data, context, snapshot);
  validateContextFeature(data, snapshot, area);
  const rivers = data.approach === "blank" ? [] : refinedDrainageFeatures(snapshot, area);
  const inherited = {
    ...snapshot,
    world: {
      ...snapshot.world,
      areas: { ...snapshot.world.areas, [area.id]: area },
      features: { ...snapshot.world.features, ...Object.fromEntries(rivers.map((f) => [f.id, f])) },
    },
  };
  area.boundary = establishBoundary(inherited, area);
  validateBoundaryTraits(area);
  const changes = intentChanges(context, snapshot);
  upsertArea(changes, area);
  for (const river of rivers) changes.writes.push({ kind: "feature", value: river });
  if (data.approach === "blank")
    for (const layerId of data.layers) {
      const candidate = { ...snapshot.world, areas: { ...snapshot.world.areas, [area.id]: area } };
      const coverage: MaterializedCoverage = {
        id: semanticId(
          snapshot.world.id,
          "coverage",
          JSON.stringify([area.id, layerId, "present"])
        ),
        areaId: area.id,
        spaceId: areaSpace(candidate, area.id),
        layerId,
        detailRank: profiles.indexOf(area.profile),
        resolution: null,
        time: "present",
        footprint: area.footprint,
        state: "intentionallyEmpty",
        resourceId: null,
        generationId: null,
      };
      validateCoverage(candidate, coverage, snapshot.coverage);
      changes.writes.push({ kind: "coverage", value: coverage });
    }
  if (data.createEntrance && located(area)) addLocatedAccess(changes, context, snapshot, area);
  return changes;
}
function located(area: Area) {
  return area.profile === "interior" || area.context === "cave" || area.frame.floor !== null;
}
function areaCandidate(data: AreaInput, context: IntentContext, snapshot: DomainSnapshot): Area {
  requireThat(
    data.parentId === context.scope.areaId,
    "area_context",
    "Create refinement within the selected geographic parent."
  );
  requireIdentity(snapshot, data.id, "area");
  requireThat(
    snapshot.identities[data.id] === undefined,
    "retired_identity",
    "Use undo to restore a retired area identity."
  );
  requireThat(!snapshot.world.areas[data.id], "existing_area", "This mapped area already exists.");
  requireRelations(snapshot, data.contextFeatureId ? [data.contextFeatureId] : []);
  const parent = snapshot.world.areas[data.parentId];
  requireThat(parent, "missing_parent", "Choose an existing geographic parent.");
  requireThat(
    data.layers.every(
      (id) =>
        Object.hasOwn(snapshot.world.layers, id) &&
        snapshot.world.layers[id].profiles.includes(data.profile)
    ),
    "layer_profile",
    "Choose registered layers supporting this creation profile."
  );
  const area: Area = {
    id: data.id,
    ...(data.regionId ? { regionId: data.regionId } : {}),
    parentId: parent.id,
    name: data.name,
    profile: data.profile,
    footprint: new Spatial(snapshot.world.reference.precision).canonical(data.footprint),
    frame: data.frame,
    version: 1,
    traits: [],
    localTraits: data.traits,
    layers: Object.fromEntries(
      data.layers.map((id) => [
        id,
        data.approach === "blank" ? "intentionallyEmpty" : "unmaterialized",
      ])
    ),
    boundary: null,
    templateId: null,
    templateInstanceId: null,
    recipeJobId: null,
    context: data.context,
    contextFeatureId: data.contextFeatureId,
  };
  const areas = { ...snapshot.world.areas, [area.id]: area };
  area.spaceId = areaSpace({ ...snapshot.world, areas }, area.id);
  area.traits = effectiveTraits(areas, area.id);
  validateAreaPlacement(snapshot.world, area);
  validateRegionRefinement(snapshot.world, area);
  return area;
}
function validateContextFeature(data: AreaInput, snapshot: DomainSnapshot, area: Area) {
  if (data.contextFeatureId) {
    const source = snapshot.world.features[data.contextFeatureId],
      shape = source && composeFeature(snapshot.world, source);
    requireThat(
      source &&
        shape &&
        areaSpace(snapshot.world, source.areaId) === areaSpace(snapshot.world, data.parentId) &&
        (shape.type.includes("Polygon")
          ? spatial.covers(shape, area.footprint)
          : spatial.intersects(shape, area.footprint)),
      "area_context",
      "The selected context feature must contain or locate this refinement."
    );
  }
}
export function registerAreaIntents(registry: IntentRegistry): void {
  registry.register({
    kind: "createArea",
    version: 1,
    description:
      "Create a sparse refinement with inherited geography, fixed interfaces and a located frame.",
    schema: createAreaSchema,
    requirements: areaRequirements,
    evaluate: evaluateArea,
  });
}
