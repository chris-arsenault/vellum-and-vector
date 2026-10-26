import type { DomainSnapshot } from "./operations";
import type { GridSurface } from "./grids";
import { isDescendant, areaDepth } from "./composition";
import type { World } from "./model";
import { hasStructuralMapEdit, refreshMappedPresentation } from "./mapEligibility";

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
export function proceduralSnapshot(source: DomainSnapshot): DomainSnapshot {
  const mapFeatures = new Set(
    Object.values(source.world.features)
      .filter((feature) => feature.mapOnly)
      .map((feature) => feature.id)
  );
  return {
    ...source,
    world: {
      ...source.world,
      networkReaches: Object.fromEntries(
        Object.entries(source.world.networkReaches ?? {}).filter(
          ([, reach]) => !mapFeatures.has(reach.featureId)
        )
      ),
      features: Object.fromEntries(
        Object.entries(source.world.features)
          .filter(([, feature]) => !feature.mapOnly)
          .map(([id, feature]) => [
            id,
            {
              ...feature,
              relations:
                feature.detail[feature.areaId]?.mapBaseline?.relations ?? feature.relations,
              detail: Object.fromEntries(
                Object.entries(feature.detail).flatMap(([areaId, detail]) =>
                  detail.mapOnly
                    ? detail.mapSource
                      ? [[areaId, detail.mapSource]]
                      : []
                    : [[areaId, detail]]
                )
              ),
            },
          ])
      ),
    },
    numerical: Object.fromEntries(
      Object.entries(source.numerical).map(([id, grid]) => [id, proceduralField(grid)])
    ),
    fieldPatches: source.fieldPatches.filter((patch) => !patch.mapOnly),
  };
}

export function restoreMappedEdits(candidate: DomainSnapshot, source: DomainSnapshot) {
  restoreMappedFeatures(candidate, source);
  restoreMappedFields(candidate, source);
  restoreMappedNetworks(candidate, source);
}
function restoreMappedNetworks(candidate: DomainSnapshot, source: DomainSnapshot) {
  for (const reach of Object.values(source.world.networkReaches ?? {})) {
    if (!source.world.features[reach.featureId]?.mapOnly) continue;
    (candidate.world.networkReaches ??= {})[reach.id] = structuredClone(reach);
    for (const id of [reach.start, reach.end]) {
      const node = source.world.networkNodes?.[id];
      if (node) (candidate.world.networkNodes ??= {})[id] = structuredClone(node);
    }
  }
}
function restoreMappedFeatures(candidate: DomainSnapshot, source: DomainSnapshot) {
  for (const feature of Object.values(source.world.features)) {
    if (
      feature.mapOnly ||
      (!candidate.world.features[feature.id] &&
        Object.values(feature.detail).some((detail) => detail.mapOnly))
    )
      candidate.world.features[feature.id] = structuredClone(feature);
    const target = candidate.world.features[feature.id];
    if (!target) continue;
    for (const [areaId, detail] of Object.entries(feature.detail))
      if (detail.mapOnly) {
        target.detail[areaId] = hasStructuralMapEdit(detail, feature)
          ? structuredClone(detail)
          : refreshMappedPresentation(candidate.world, target, areaId, detail);
        target.name = feature.name;
        target.relations = structuredClone(feature.relations);
      }
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
      ...structuredClone(overlays),
    ];
  }
}
