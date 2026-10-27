import {
  gridPosition,
  semanticId,
  spatial,
  canonicalPosition,
  isDescendant,
  representationId,
  lineParts,
  type AtlasFeature,
  type RegularGrid,
} from "@atlas/domain";
import type { GenerationState, MapProcess } from "./process";
import { nameGeographicFeature, nameMetadata } from "./atlasNaming";
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

export function generatedFeature(
  state: GenerationState,
  key: string,
  name: string,
  kind: string,
  layerId: string,
  geometry: AtlasFeature["geometry"],
  attributes: Record<string, unknown> = {}
): AtlasFeature {
  const id = semanticId(state.domain.world.id, `generated:${state.domain.scope.areaId}`, key);
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
  matches: (existing: AtlasFeature) => boolean
) {
  const world = state.domain.world;
  const previous = findGenerationFeature(
    state,
    (candidate) =>
      candidate.areaId !== feature.areaId &&
      isDescendant(world.areas, feature.areaId, candidate.areaId) &&
      matches(candidate)
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
function networkHeight(feature: AtlasFeature, index: number, coordinate: number[]) {
  const elevations = feature.attributes.elevations;
  return Array.isArray(elevations)
    ? Number(index === 0 ? elevations[0] : elevations.at(-1))
    : (coordinate[2] ?? 0);
}
export function putGeneratedNetwork(state: GenerationState, feature: AtlasFeature) {
  if (!putGenerated(state, feature)) return;
  const parts = lineParts(feature.geometry);
  for (const [part, coordinates] of parts.entries())
    putNetworkPart(
      state,
      feature,
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
      "generated-junction",
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
    behavior: {
      kind: "initialize",
      initialize(state) {
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
    },
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
    !feature.protected &&
    !Object.keys(feature.detail).length &&
    !retained.has(feature.id) &&
    (domains.includes(feature.generationDomain ?? "") ||
      (feature.layerId === "ecology" && domains.includes("magic")))
  );
}
export const extractGeographyProcess: MapProcess = {
  contract: {
    id: "physical.features",
    version: "1",
    parameters: {},
    requires: ["elevation", "drainage", "flow"],
    produces: ["geographicFeatures"],
    invalidates: [],
  },
  behavior: {
    kind: "extract",
    extract(state, context) {
      const grid = state.surface,
        flow = grid.channels.flow;
      const maximum = flow.reduce(
        (a, b, i) => (grid.channels.elevation[i] > 0 ? Math.max(a, b) : a),
        0
      );
      const threshold = maximum * 0.075;
      for (let i = 0; i < grid.active.length; i++) {
        if (!grid.active[i] || flow[i] <= threshold || grid.channels.elevation[i] <= 0) continue;
        const receiver = grid.channels.receiver[i];
        if (receiver < 0) continue;
        const a = gridPosition(grid, i),
          b = gridPosition(grid, receiver);
        const feature = generatedFeature(
          state,
          `river:${i}`,
          `River reach ${i + 1}`,
          "river",
          "rivers",
          {
            type: "LineString",
            coordinates: [
              [a.x, a.y],
              [b.x, b.y],
            ],
          },
          {
            elevations: [
              grid.channels.drainageElevation[i],
              grid.channels.drainageElevation[receiver],
            ],
            discharges: [flow[i], flow[receiver]],
            discharge: flow[i],
          }
        );
        // New tributaries do not invent crossings at a child's fixed interface.
        if (
          state.domain.world.areas[state.domain.scope.areaId].boundary &&
          spatial.crossings(feature.geometry, state.domain.scope.footprint).length
        )
          continue;
        putGeneratedNetwork(state, feature);
      }
      context.recordCause({
        kind: "domain",
        process: "physical.features",
        subjects: [],
        description:
          "River reaches follow the acyclic conditioned drainage graph and accumulated runoff.",
      });
    },
  },
  validate() {
    return [];
  },
};

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
