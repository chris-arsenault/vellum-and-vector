import { mapCommand } from "./processTraits";
import {
  semanticId,
  canonicalPosition,
  isDescendant,
  representationId,
  ownsMapGeography,
  type AtlasFeature,
  type FeatureSelection,
  type RegularGrid,
} from "@atlas/domain";
import type { GenerationState, MapProcess } from "./process";
import { nameGeographicFeature, nameMetadata } from "./atlasNaming";
import { networkParts } from "./mapNetworkParts";
import {
  generationFeature,
  generationFeatures,
  findGenerationFeature,
  writeGenerationFeature,
  removeGenerationFeature,
} from "./generationFeatures";
import {
  generationNetworks,
  writeGenerationNode,
  writeGenerationReach,
  removeGenerationReach,
} from "./generationNetworks";

/** The identity a generated record of this key has on this map. */
export const generatedId = (state: GenerationState, key: string) =>
  semanticId(state.domain.world.id, `generated:${state.domain.scope.areaId}`, key);
export function generatedFeature(
  state: GenerationState,
  key: string,
  name: string,
  kind: string,
  layerId: string,
  geometry: AtlasFeature["geometry"],
  attributes: Record<string, unknown> = {}
): AtlasFeature {
  const id = generatedId(state, key);
  const naming = featureNaming(state, id, key, name, kind, geometry, attributes);
  return {
    id,
    name: naming.name,
    kind,
    layerId,
    geometry,
    attributes: naming.attributes,
    areaId: state.domain.scope.areaId,
    detail: {},
    relations: [],
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    generationDomain: state.domain.world.layers[layerId]?.generator ?? null,
    causes: [
      `Generated from ${key} in ${state.domain.world.areas[state.domain.scope.areaId].name}.`,
    ],
  };
}
function featureNaming(
  state: GenerationState,
  id: string,
  key: string,
  name: string,
  kind: string,
  geometry: AtlasFeature["geometry"],
  attributes: Record<string, unknown>
) {
  const named = nameGeographicFeature(state.domain.world, key, kind, geometry, attributes);
  const previous = state.retainedFeatureNames?.[id];
  const nameStatus = ["furniture", "wall", "door", "room", "building"].includes(kind)
    ? "label"
    : "proper";
  return {
    name: previous?.name ?? named?.name ?? name,
    attributes: {
      nameStatus,
      ...attributes,
      ...(named ? nameMetadata(named) : {}),
      ...previous?.attributes,
    },
  };
}
export function putGenerated(state: GenerationState, feature: AtlasFeature) {
  const previous = generationFeature(state, feature.id);
  if (
    previous &&
    (previous.protected || previous.state === "authored" || Object.keys(previous.detail).length)
  )
    return false;
  // Established cross-area interfaces retain their existing semantic geometry.
  if (
    Object.values(state.domain.world.areas).some((a) =>
      a.boundary?.crossings.some((c) => c.featureId === feature.id)
    )
  )
    return false;
  writeGenerationFeature(state, feature);
  return true;
}
/** A finer drawing of an existing subject keeps its original identity and network endpoints. */
export function putGeneratedDetail(
  state: GenerationState,
  feature: AtlasFeature,
  matches: (existing: AtlasFeature) => boolean,
  selection: FeatureSelection = {}
) {
  const world = state.domain.world;
  if (ownsMapGeography(world, feature.areaId))
    return putMapPlace(state, feature, matches, selection);
  const previous = findGenerationFeature(
    state,
    (candidate) =>
      candidate.areaId !== feature.areaId &&
      isDescendant(world.areas, feature.areaId, candidate.areaId) &&
      matches(candidate),
    selection
  );
  if (!previous) return false;
  const detail = previous.detail[feature.areaId];
  if (
    previous.protected ||
    previous.state === "authored" ||
    detail?.protected ||
    detail?.state === "authored"
  )
    return true;
  previous.detail[feature.areaId] = {
    id: representationId(world.id, previous.id, feature.areaId),
    geometry: feature.geometry,
    attributes: feature.attributes,
    state: "generated",
    protected: false,
    needsReconciliation: false,
    actor: "generator",
    generationId: null,
  };
  writeGenerationFeature(state, previous);
  return true;
}
function putMapPlace(
  state: GenerationState,
  feature: AtlasFeature,
  matches: (candidate: AtlasFeature) => boolean,
  selection: FeatureSelection
) {
  const local = findGenerationFeature(state, matches, { ...selection, areaId: feature.areaId });
  if (!local) return false;
  if (local.protected || local.state === "authored") return true;
  writeGenerationFeature(state, {
    ...feature,
    id: local.id,
    placeId: local.placeId ?? local.id,
    name: local.name,
  });
  return true;
}
function networkHeight(feature: AtlasFeature, index: number, coordinate: number[]) {
  const elevations = feature.attributes.elevations;
  return Array.isArray(elevations)
    ? Number(index === 0 ? elevations[0] : elevations.at(-1))
    : (coordinate[2] ?? 0);
}
export function putGeneratedNetwork(state: GenerationState, feature: AtlasFeature) {
  if (!putGenerated(state, feature)) return;
  const parts = networkParts(feature, state.domain.world.reference);
  for (const [part, { coordinates, attributes }] of parts.entries())
    putNetworkPart(
      state,
      { ...feature, attributes },
      coordinates,
      parts.length === 1 ? feature.id : `${feature.id}:${part}`
    );
}
function putNetworkPart(
  state: GenerationState,
  feature: AtlasFeature,
  coordinates: number[][],
  key: string
) {
  const world = state.domain.world,
    ends = [coordinates[0], coordinates.at(-1)!];
  const ids = ends.map((p) =>
    semanticId(
      world.id,
      ownsMapGeography(world, state.domain.scope.areaId)
        ? `generated-junction:${state.domain.scope.areaId}`
        : "generated-junction",
      JSON.stringify([
        state.domain.scope.spaceId,
        canonicalPosition(world.reference, { x: p[0], y: p[1], z: 0 }).x,
        p[1],
      ])
    )
  );
  for (const [index, p] of ends.entries())
    writeGenerationNode(state, {
      id: ids[index],
      kind: feature.kind,
      position: canonicalPosition(world.reference, {
        x: p[0],
        y: p[1],
        z: networkHeight(feature, index, p),
      }),
      spaceId: state.domain.scope.spaceId,
      waterLevel: null,
    });
  const reach = semanticId(world.id, "generated-reach", key);
  writeGenerationReach(state, {
    id: reach,
    featureId: feature.id,
    start: ids[0],
    end: ids[1],
    geometry: { type: "LineString", coordinates },
    flow: Number(feature.attributes.discharge ?? 0),
    endFlow: Array.isArray(feature.attributes.discharges)
      ? Number(feature.attributes.discharges.at(-1))
      : null,
  });
}
export function prepareGeneratedProcess(domains: string[]): MapProcess {
  return {
    contract: {
      id: "atlas.prepare",
      version: "1",
      parameters: {},
      requires: [],
      produces: [],
      invalidates: [],
    },
    operation: mapCommand(
      "atlas.prepare",
      "initialize",
      (state) => {
        const world = state.domain.world;
        state.retainedFeatureNames = {};
        for (const f of generationFeatures(state))
          state.retainedFeatureNames[f.id] = {
            name: f.name,
            attributes: Object.fromEntries(
              Object.entries(f.attributes).filter(
                ([key]) => key.startsWith("naming") || key === "namedInEra"
              )
            ),
          };
        const contracted = new Set([
          ...Object.values(world.areas).flatMap(
            (a) => a.boundary?.crossings.map((c) => c.featureId) ?? []
          ),
          ...Object.values(world.connections ?? {}).flatMap((c) => [c.a.featureId, c.b.featureId]),
        ]);
        for (const feature of generationFeatures(state))
          for (const relation of feature.relations) contracted.add(relation.targetId);
        for (const feature of generationFeatures(state)) {
          if (!replaceable(feature, state.domain.scope.areaId, domains, contracted)) continue;
          removeGenerationFeature(state, feature.id);
          for (const reach of generationNetworks(state).reaches({ featureId: feature.id }))
            removeGenerationReach(state, reach.id);
        }
      },
      []
    ),
    validate() {
      return [];
    },
  };
}
function replaceable(
  feature: AtlasFeature,
  areaId: string,
  domains: string[],
  retained: Set<string | null>
) {
  return (
    feature.areaId === areaId &&
    feature.state === "generated" &&
    !retainsFeature(feature, retained) &&
    (domains.includes(feature.generationDomain ?? "") ||
      (feature.layerId === "ecology" && domains.includes("magic")))
  );
}
function retainsFeature(feature: AtlasFeature, retained: Set<string | null>) {
  return (
    feature.protected ||
    Object.keys(feature.detail).length > 0 ||
    retained.has(feature.id) ||
    !!(feature.placeId && feature.geometry.type === "Point")
  );
}
export function cellPolygon(grid: RegularGrid, x0: number, x1: number, y: number) {
  const dx = (grid.bounds[2] - grid.bounds[0]) / (grid.width - 1),
    dy = (grid.bounds[3] - grid.bounds[1]) / (grid.height - 1);
  const west = Math.max(grid.bounds[0], grid.bounds[0] + (x0 - 0.5) * dx);
  const east = Math.min(grid.bounds[2], grid.bounds[0] + (x1 + 0.5) * dx);
  const south = Math.max(grid.bounds[1], grid.bounds[1] + (y - 0.5) * dy);
  const north = Math.min(grid.bounds[3], grid.bounds[1] + (y + 0.5) * dy);
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}
