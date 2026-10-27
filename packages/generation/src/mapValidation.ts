import {
  gridSchema,
  requireThat,
  sameValue,
  spatial,
  validateAuthoredField,
  validateGeometryWriteScopes,
  validateCrossings,
  composeFeature,
  areaSpace,
  type DomainSnapshot,
  type Grid,
  type AtlasFeature,
  featureWorkspaceWorld,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { validateAuthoredInputs } from "./mapAuthored";
import {
  generationFeature,
  generationFeatures,
  generationFeatureWorld,
  originalFeatureReader,
} from "./generationFeatures";

export function validateWorkingMap(state: GenerationState, original: DomainSnapshot): void {
  validateScope(state, original);
  validateAuthoredInputs(state, original);
  const previous = originalFeatureReader(state, original);
  for (const feature of previous.values())
    validateFeatureProtection(feature, generationFeature(state, feature.id));
  validateInterfaces(state, original);
  for (const feature of generationFeatures(state))
    if (!sameValue(previous.get(feature.id), feature))
      validateChangedFeature(state, original, feature.id);
  for (const { id } of previous.values())
    if (!generationFeature(state, id)) validateChangedFeature(state, original, id);
  validateSurface(state, original);
}

function validateScope(state: GenerationState, original: DomainSnapshot) {
  const scope = original.scope;
  requireThat(
    sameValue(state.domain.scope, scope) &&
      state.domain.world.id === original.world.id &&
      sameValue(state.domain.world.reference, original.world.reference),
    "generation_context",
    "Generation retains the pinned world, located context and spatial reference."
  );
  gridSchema.parse(state.surface);
  requireThat(
    state.surface.scope.worldId === scope.worldId &&
      state.surface.scope.spaceId === scope.spaceId &&
      state.surface.scope.crsId === scope.crsId &&
      state.surface.scope.areaId === scope.areaId &&
      state.surface.scope.time === scope.time &&
      state.surface.scope.revision === scope.revision &&
      spatial.covers(scope.footprint, state.surface.scope.footprint),
    "generation_scope",
    "Generation retains the pinned context and write extent."
  );
}

function validateInterfaces(state: GenerationState, original: DomainSnapshot) {
  for (const area of Object.values(original.world.areas)) {
    requireThat(
      sameValue(area.boundary, state.domain.world.areas[area.id]?.boundary),
      "generation_boundary",
      "Generation preserves inherited interfaces; reconcile them through authoring."
    );
  }
}
function validateChangedFeature(state: GenerationState, original: DomainSnapshot, id: string) {
  const world = generationFeatureWorld(state, [id]);
  validateGeometryWriteScopes(
    {
      ...original,
      world: featureWorkspaceWorld(original.world, originalFeatureReader(state, original), [id]),
    },
    world,
    [id]
  );
  for (const area of Object.values(original.world.areas)) {
    const feature = world.features[id];
    const contracted = area.boundary?.crossings.some((crossing) => crossing.featureId === id);
    requireThat(
      !contracted || feature,
      "generation_crossing",
      "Generation retains contracted network features."
    );
    if (!feature || areaSpace(world, feature.areaId) !== areaSpace(original.world, area.id))
      continue;
    const geometry = composeFeature(world, feature);
    if (geometry)
      validateCrossings({ ...state.domain, world }, area, feature, geometry, feature.attributes);
  }
}

function isAuthored(value: { protected: boolean; state: string }) {
  return value.protected || value.state === "authored" || value.state === "protected";
}
function validateFeatureProtection(feature: AtlasFeature, current: AtlasFeature | undefined) {
  if (isAuthored(feature))
    requireThat(
      sameValue(feature, current),
      "protected_feature",
      "Generation preserves authored feature content, ownership and protection."
    );
  for (const [area, detail] of Object.entries(feature.detail))
    if (isAuthored(detail))
      requireThat(
        sameValue(detail, current?.detail[area]),
        "protected_representation",
        "Generation preserves authored detail and its protection."
      );
}

function validateSurface(state: GenerationState, original: DomainSnapshot): void {
  const area = original.world.areas[original.scope.areaId];
  for (const [channel, values] of Object.entries(state.surface.channels)) {
    const layer = Object.values(original.world.layers).find(
      (l) => l.id === channel || l.facts?.includes(channel)
    );
    if (!layer) continue;
    const grid: Grid = {
      ...state.surface,
      channels: { [channel]: values },
      units: { [channel]: state.surface.units[channel] },
    };
    validateAuthoredField(original, area, grid, layer);
  }
}
