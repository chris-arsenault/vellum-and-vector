import {
  canonicalGeometry,
  canonicalPosition,
  semanticId,
  spatial,
  type AtlasFeature,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import {
  generationFeatures,
  writeGenerationFeature,
  removeGenerationFeature,
} from "../generationFeatures";
import { atlasName, nameGeographicFeature, nameMetadata } from "../atlasNaming";
import type { RefinementState } from "./state";

export function putRefinementFeature(
  state: RefinementState,
  key: string,
  kind: string,
  layerId: string,
  geometry: Geometry,
  attributes: Record<string, unknown> = {},
  label = kind
): AtlasFeature {
  const id = semanticId(state.domain.world.id, `regional:${state.input.areaId}`, key),
    named =
      kind === "settlement"
        ? atlasName(state.domain.world, {
            key,
            kind: "settlement",
            subkind: "village",
            position: spatial.interiorPosition(geometry),
          })
        : nameGeographicFeature(state.domain.world, key, kind, geometry, attributes),
    feature: AtlasFeature = {
      id,
      placeId: undefined,
      areaId: state.input.areaId,
      layerId,
      kind,
      name: named?.name ?? label,
      geometry: canonicalGeometry(state.domain.world.reference, geometry),
      attributes: { nameStatus: "proper", ...attributes, ...(named ? nameMetadata(named) : {}) },
      relations: [],
      causes: ["Developed from captured present geography at regional scale."],
      detail: {},
      state: "generated",
      protected: false,
      actor: "generator",
      generationId: null,
      generationDomain: state.domain.world.layers[layerId]?.generator ?? null,
    };
  writeGenerationFeature(state, feature);
  return feature;
}
export function clearRegionalProducts(state: RefinementState) {
  for (const f of generationFeatures(state, { areaId: state.input.areaId })) {
    if (retainPlace(f) || !state.input.domains.includes(f.generationDomain ?? "")) continue;
    removeGenerationFeature(state, f.id);
    for (const reach of state.networks?.reaches({ featureId: f.id }) ?? [])
      state.networks!.removeReach(reach.id);
  }
}
function retainPlace(f: AtlasFeature) {
  return (
    f.state !== "generated" ||
    f.protected ||
    f.kind === "landmark" ||
    !!(f.placeId && f.geometry.type === "Point") ||
    [
      "sovereignty",
      "control",
      "claims",
      "administration",
      "cultures",
      "languages",
      "religions",
    ].includes(f.layerId)
  );
}
export function putRefinementNetwork(
  state: RefinementState,
  feature: AtlasFeature,
  flow = 0,
  coordinates = feature.geometry.type === "LineString" ? feature.geometry.coordinates : null
) {
  if (!coordinates) return;
  const ends = [coordinates[0], coordinates.at(-1)!],
    nodes = ends.map(([x, y, z = 0]) => ({
      id: semanticId(
        state.domain.world.id,
        `regional-node:${state.input.areaId}`,
        `${feature.layerId}:${x}:${y}`
      ),
      kind: `network:${feature.layerId}`,
      position: canonicalPosition(state.domain.world.reference, { x, y, z }),
      spaceId: state.surface.scope.spaceId,
      waterLevel: null,
    }));
  const reach = {
    id: semanticId(state.domain.world.id, "regional-reach", feature.id),
    featureId: feature.id,
    start: nodes[0].id,
    end: nodes[1].id,
    geometry: feature.geometry,
    flow,
    endFlow: null,
  };
  if (state.networks) {
    for (const node of nodes) state.networks.putNode(node);
    state.networks.putReach(reach);
  } else {
    for (const node of nodes) (state.domain.world.networkNodes ??= {})[node.id] = node;
    (state.domain.world.networkReaches ??= {})[reach.id] = reach;
  }
}
