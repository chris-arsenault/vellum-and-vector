import {
  areaSpace,
  composeFeature,
  materializeField,
  requireThat,
  spatial,
  rectangle,
  type AtlasFeature,
  type World,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { session } from "./atlasState";
import { analyzeNetwork } from "./networkAnalysis";

export function readFeature(id: string, featureId: string, areaId: string): AtlasFeature {
  const world = session(id).snapshot.world;
  const feature = world.features[featureId];
  requireThat(feature, "missing_feature", "Select an existing feature.");
  const geometry = composeFeature(world, feature);
  requireThat(geometry, "feature_geometry", "This feature has no visible geometry.");
  return {
    ...feature,
    geometry,
    attributes: feature.detail[areaId]?.attributes ?? feature.attributes,
  };
}

export function readScene(id: string, areaId: string, extent?: number[]) {
  const world = session(id).snapshot.world;
  const area = world.areas[areaId],
    space = areaSpace(world, areaId);
  const footprint = extent
    ? spatial.intersection(area.footprint, rectangle(extent as [number, number, number, number]))
    : area.footprint;
  if (!footprint) return [];
  return Object.values(world.features).flatMap((feature) => {
    if (areaSpace(world, feature.areaId) !== space) return [];
    const presented = readFeature(id, feature.id, areaId);
    const geometry = spatial.intersection(presented.geometry, footprint);
    return geometry ? [{ ...presented, geometry }] : [];
  });
}

export function readRaster(id: string, fieldId: string, channel: string) {
  const source = session(id).snapshot.numerical[fieldId];
  requireThat(source, "missing_field", "Choose an available field.");
  const grid = materializeField(source);
  requireThat(grid.channels[channel], "missing_channel", `No ${channel} samples in this field.`);
  return {
    id: fieldId,
    areaId: grid.scope.areaId,
    footprint: grid.scope.footprint,
    bounds: grid.bounds,
    width: grid.width,
    height: grid.height,
    channel,
    values: Array.from(grid.channels[channel], (value, i) => (grid.active[i] ? value : Number.NaN)),
  };
}

export function exportWorld(id: string) {
  const world = session(id).snapshot.world;
  return {
    type: "FeatureCollection",
    worldReference: world.reference,
    name: world.name,
    version: world.version,
    areas: Object.values(world.areas).map(({ id, parentId, profile, footprint, frame }) => ({
      id,
      parentId,
      profile,
      footprint,
      frame,
    })),
    features: Object.values(world.features).map((feature) => ({
      type: "Feature",
      id: feature.id,
      geometry: composeFeature(world, feature),
      properties: {
        ...feature.attributes,
        name: feature.name,
        kind: feature.kind,
        layerId: feature.layerId,
        areaId: feature.areaId,
        spaceId: areaSpace(world, feature.areaId),
        state: feature.state,
        protected: feature.protected,
        actor: feature.actor,
        relations: feature.relations,
        causes: feature.causes,
      },
    })),
  };
}

interface AnalysisInput {
  areaId: string;
  operation: string;
  geometry: Geometry;
  featureId: string | null;
  targetFeatureId: string | null;
  layer: string | null;
  channel: string | null;
  distance: number;
  networkKind: string;
}
export interface AnalysisResult {
  geometry: Geometry | null;
  measurements: Record<string, number>;
  features: string[];
  areas: string[];
  path: string[];
  notes: string[];
  worldVersion: number;
}
export function analyzeArea(id: string, input: AnalysisInput): AnalysisResult {
  const world = session(id).snapshot.world;
  const result: AnalysisResult = {
    geometry: input.geometry,
    measurements: {},
    features: [],
    areas: [],
    path: [],
    notes: [],
    worldVersion: world.version,
  };
  const scene = readScene(id, input.areaId).filter(
    (f) => !input.layer || f.layerId === input.layer
  );
  switch (input.operation) {
    case "measure":
      measure(result);
      break;
    case "buffer":
      result.geometry = spatial.buffer(input.geometry, input.distance);
      measure(result);
      break;
    case "intersect": {
      requireThat(input.targetFeatureId, "analysis_target", "Choose a target feature.");
      result.geometry = spatial.intersection(
        input.geometry,
        readFeature(id, input.targetFeatureId, input.areaId).geometry
      );
      measure(result);
      break;
    }
    case "nearby":
      result.features = scene
        .filter((f) => spatial.distance(f.geometry, input.geometry) <= input.distance)
        .map((f) => f.id);
      break;
    case "dependencies":
      dependencies(result, world, input);
      break;
    case "fieldStatistics":
      statistics(result, id, input);
      break;
    default:
      network(result, world, input);
  }
  return result;
}
function measure(result: AnalysisResult) {
  if (!result.geometry) {
    result.notes.push("The geometries do not intersect.");
    return;
  }
  result.measurements = {
    area_m2: spatial.area(result.geometry),
    length_m: spatial.length(result.geometry),
  };
}
function dependencies(result: AnalysisResult, world: World, input: AnalysisInput) {
  result.features = Object.values(world.features)
    .filter(
      (f) => f.id === input.featureId || f.relations.some((r) => r.targetId === input.featureId)
    )
    .map((f) => f.id);
  result.areas = Object.values(world.areas)
    .filter(
      (a) =>
        areaSpace(world, a.id) === areaSpace(world, input.areaId) &&
        spatial.intersects(a.footprint, input.geometry)
    )
    .map((a) => a.id);
  result.notes.push(
    "These areas overlap the edit; listed features refer to its semantic identity."
  );
}
function statistics(result: AnalysisResult, id: string, input: AnalysisInput) {
  const snapshot = session(id).snapshot;
  const values: number[] = [];
  for (const field of snapshot.world.fields) {
    if (
      field.spaceId !== areaSpace(snapshot.world, input.areaId) ||
      !field.channels?.includes(input.channel ?? "")
    )
      continue;
    const raster = readRaster(id, field.id, input.channel!);
    const [x0, y0, x1, y1] = raster.bounds;
    raster.values.forEach((v, i) => {
      const x = x0 + ((i % raster.width) * (x1 - x0)) / (raster.width - 1);
      const y = y0 + (Math.floor(i / raster.width) * (y1 - y0)) / (raster.height - 1);
      if (
        Number.isFinite(v) &&
        spatial.covers(input.geometry, { type: "Point", coordinates: [x, y] })
      )
        values.push(v);
    });
  }
  requireThat(
    values.length,
    "missing_samples",
    "No samples for this channel in the selected extent."
  );
  result.measurements = {
    samples: values.length,
    minimum: values.reduce((a, b) => Math.min(a, b)),
    maximum: values.reduce((a, b) => Math.max(a, b)),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}
function network(result: AnalysisResult, world: World, input: AnalysisInput) {
  const source = world.features[input.featureId ?? ""],
    target = world.features[input.targetFeatureId ?? ""];
  requireThat(source && target, "network_selection", "Select a starting feature and a target.");
  if (input.operation === "networkPath") {
    Object.assign(
      result,
      analyzeNetwork(world, input.areaId, source.id, target.id, input.networkKind)
    );
    return;
  }
  const features = Object.values(world.features).filter(
    (f) => areaSpace(world, f.areaId) === areaSpace(world, input.areaId)
  );
  const queue = [[source.id]],
    seen = new Set<string>();
  for (const path of queue) {
    const current = path.at(-1)!;
    if (current === target.id) {
      result.path = path;
      result.features = path;
      return;
    }
    if (seen.has(current)) continue;
    seen.add(current);
    const connected = features.filter(
      (f) =>
        f.relations.some(
          (r) => r.targetId === current && ["connects", "inside"].includes(r.kind)
        ) ||
        world.features[current].relations.some(
          (r) => r.targetId === f.id && ["connects", "inside"].includes(r.kind)
        )
    );
    for (const next of connected) if (!seen.has(next.id)) queue.push([...path, next.id]);
  }
  result.notes.push("No connected route between the selected features.");
}
