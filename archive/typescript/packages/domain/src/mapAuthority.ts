import type { DomainSnapshot } from "./operations";
import type { GridSurface } from "./grids";
import { isDescendant, areaDepth } from "./composition";
import type { AtlasFeature, World } from "./model";
import { hasStructuralMapEdit, refreshMappedPresentation } from "./mapEligibility";
import { cloneFieldInput } from "./snapshot";
import {
  featureWorkspaceWorld,
  type FeatureWorkspace,
  type FeatureReader,
} from "./featureWorkspace";
import { worldNetworkReader, type NetworkReader, type NetworkWorkspace } from "./networkWorkspace";

/** A child drawing belongs to that map and its descendants, never a sibling or parent. */
export function mappedField(
  grid: GridSurface,
  world: World,
  areaId = grid.scope.areaId
): GridSurface {
  return {
    ...grid,
    ...(grid.overlays
      ? {
          overlays: grid.overlays
            .filter(
              (overlay) =>
                !overlay.mapOnly || isDescendant(world.areas, areaId, overlay.grid.scope.areaId)
            )
            .sort(
              (a, b) =>
                Number(!!a.mapOnly) - Number(!!b.mapOnly) ||
                areaDepth(world.areas, a.grid.scope.areaId) -
                  areaDepth(world.areas, b.grid.scope.areaId)
            )
            .map((overlay) => ({ ...overlay, grid: mappedField(overlay.grid, world, areaId) })),
        }
      : {}),
  };
}

function proceduralField(grid: GridSurface): GridSurface {
  return {
    ...grid,
    ...(grid.overlays
      ? {
          overlays: grid.overlays
            .filter((overlay) => !overlay.mapOnly)
            .map((overlay) => ({ ...overlay, grid: proceduralField(overlay.grid) })),
        }
      : {}),
  };
}
/** Shared identifiers connect the drawings; creative geometry is never an inverse simulation. */
export function proceduralSnapshot(
  source: DomainSnapshot,
  features?: FeatureReader
): DomainSnapshot {
  return {
    ...source,
    world: {
      ...source.world,
      networkReaches: Object.fromEntries(
        Object.entries(source.world.networkReaches ?? {}).filter(
          ([, reach]) =>
            !(features ? features.get(reach.featureId) : source.world.features[reach.featureId])
              ?.mapOnly
        )
      ),
      features: Object.fromEntries(
        Object.values(source.world.features).flatMap((feature) => {
          const value = proceduralFeature(feature);
          return value ? [[value.id, value]] : [];
        })
      ),
    },
    numerical: Object.fromEntries(
      Object.entries(source.numerical).map(([id, grid]) => [id, proceduralField(grid)])
    ),
    fieldPatches: source.fieldPatches.filter((patch) => !patch.mapOnly),
  };
}

export function proceduralFeature(feature: AtlasFeature): AtlasFeature | undefined {
  if (feature.mapOnly) return;
  return {
    ...feature,
    relations: feature.detail[feature.areaId]?.mapBaseline?.relations ?? feature.relations,
    detail: Object.fromEntries(
      Object.entries(feature.detail).flatMap(([areaId, detail]) =>
        detail.mapOnly ? (detail.mapSource ? [[areaId, detail.mapSource]] : []) : [[areaId, detail]]
      )
    ),
  };
}

export function restoreMappedEdits(
  candidate: DomainSnapshot,
  source: DomainSnapshot,
  stores: {
    features?: FeatureWorkspace;
    sourceFeatures?: FeatureReader;
    networks?: NetworkWorkspace;
    sourceNetworks?: NetworkReader;
  } = {}
) {
  const original = stores.sourceFeatures ?? {
    get: (id: string) => source.world.features[id],
    values: () => Object.values(source.world.features),
  };
  restoreMappedFeatures(candidate, original, stores.features);
  restoreMappedFields(candidate, source);
  restoreMappedNetworks(
    candidate,
    stores.sourceNetworks ?? worldNetworkReader(source.world),
    original,
    stores.networks
  );
}
function restoreMappedNetworks(
  candidate: DomainSnapshot,
  source: NetworkReader,
  features: FeatureReader,
  networks?: NetworkWorkspace
) {
  const putReach = networks
    ? (reach: import("./model").NetworkReach) => networks.putReach(reach)
    : (reach: import("./model").NetworkReach) => {
        (candidate.world.networkReaches ??= {})[reach.id] = reach;
      };
  const putNode = networks
    ? (node: import("./model").NetworkNode) => networks.putNode(node)
    : (node: import("./model").NetworkNode) => {
        (candidate.world.networkNodes ??= {})[node.id] = node;
      };
  for (const reach of source.reaches()) {
    if (!features.get(reach.featureId)?.mapOnly) continue;
    putReach(structuredClone(reach));
    for (const id of [reach.start, reach.end]) {
      const node = source.node(id);
      if (node) putNode(structuredClone(node));
    }
  }
}
function restoreMappedFeatures(
  candidate: DomainSnapshot,
  sourceFeatures: FeatureReader,
  features?: FeatureWorkspace
) {
  for (const feature of sourceFeatures.values()) {
    if (!feature.mapOnly && !Object.values(feature.detail).some((detail) => detail.mapOnly))
      continue;
    let target = features ? features.get(feature.id) : candidate.world.features[feature.id];
    if (feature.mapOnly || !target) target = structuredClone(feature);
    const world = features
      ? featureWorkspaceWorld(candidate.world, features, [target.id])
      : candidate.world;
    world.features[target.id] = target;
    restoreMappedDetails(world, target, feature);
    if (features) features.put(target);
    else candidate.world.features[target.id] = target;
  }
}
function restoreMappedDetails(world: World, target: AtlasFeature, feature: AtlasFeature) {
  for (const [areaId, detail] of Object.entries(feature.detail))
    if (detail.mapOnly) {
      target.detail[areaId] = hasStructuralMapEdit(detail, feature)
        ? structuredClone(detail)
        : refreshMappedPresentation(world, target, areaId, detail);
      target.name = feature.name;
      target.relations = structuredClone(feature.relations);
    }
}
function restoreMappedFields(candidate: DomainSnapshot, source: DomainSnapshot) {
  for (const patch of source.fieldPatches.filter((patch) => patch.mapOnly)) {
    if (!candidate.fieldPatches.some((p) => p.id === patch.id))
      candidate.fieldPatches.push(structuredClone(patch));
  }
  for (const [id, grid] of Object.entries(source.numerical)) {
    const overlays = grid.overlays?.filter((overlay) => overlay.mapOnly);
    if (!overlays?.length || !candidate.numerical[id]) continue;
    const current = candidate.numerical[id];
    current.overlays = [
      ...(current.overlays ?? []).filter((overlay) => !overlay.mapOnly),
      ...overlays.map((overlay) => ({
        ...overlay,
        channels: [...overlay.channels],
        grid: cloneFieldInput(overlay.grid),
      })),
    ];
  }
}
