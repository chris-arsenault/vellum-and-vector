import {
  areaSpace,
  canonicalFeatures,
  presentAtlasFeature,
  gridPosition,
  gridSampler,
  gridWindowCells,
  mappedField,
  requireThat,
  spatial,
  type DomainSnapshot,
  type World,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { analyzeNetwork } from "./networkAnalysis";

export interface AnalysisInput {
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
export function analyzeSnapshot(snapshot: DomainSnapshot, input: AnalysisInput): AnalysisResult {
  const result: AnalysisResult = {
    geometry: input.geometry,
    measurements: {},
    features: [],
    areas: [],
    path: [],
    notes: [],
    worldVersion: snapshot.world.version,
  };
  switch (input.operation) {
    case "measure":
      measure(result);
      break;
    case "buffer":
      result.geometry = spatial.buffer(input.geometry, input.distance);
      measure(result);
      break;
    case "intersect":
      intersect(result, snapshot.world, input);
      break;
    case "nearby":
      result.features = scene(snapshot.world, input)
        .filter((f) => spatial.distance(f.geometry, input.geometry) <= input.distance)
        .map((f) => f.id);
      break;
    case "dependencies":
      dependencies(result, snapshot.world, input);
      break;
    case "fieldStatistics":
      statistics(result, snapshot, input);
      break;
    default:
      network(result, snapshot.world, input);
  }
  return result;
}
function scene(world: World, input: AnalysisInput) {
  return canonicalFeatures(world).flatMap((feature) => {
    if (input.layer && feature.layerId !== input.layer) return [];
    const presented = presentAtlasFeature(world, feature, input.areaId);
    return presented ? [presented] : [];
  });
}
function intersect(result: AnalysisResult, world: World, input: AnalysisInput) {
  const target = scene(world, input).find((feature) => feature.id === input.targetFeatureId);
  requireThat(target, "analysis_target", "Choose a target feature in the selected layer.");
  result.geometry = spatial.intersection(input.geometry, target.geometry);
  measure(result);
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
function statistics(result: AnalysisResult, snapshot: DomainSnapshot, input: AnalysisInput) {
  let count = 0,
    minimum = Infinity,
    maximum = -Infinity,
    mean = 0;
  const bounds = spatial.bounds(input.geometry),
    covers = spatial.pointCoverage(input.geometry);
  const fields = snapshot.world.fields.filter(
    (field) =>
      field.spaceId === areaSpace(snapshot.world, input.areaId) &&
      field.channels?.includes(input.channel ?? "")
  );
  for (const field of fields) {
    const source = snapshot.numerical[field.id];
    if (!source) continue;
    const grid = mappedField(source, snapshot.world, input.areaId),
      valueAt = gridSampler(grid, input.channel!),
      covered = spatial.pointCoverage(grid.scope.footprint);
    for (const i of gridWindowCells(grid, bounds)) {
      const p = gridPosition(grid, i);
      if (!grid.active.get(i) || !covered(p) || !covers(p)) continue;
      const value = valueAt(p);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      mean += (value - mean) / ++count;
    }
  }
  requireThat(count, "missing_samples", "No samples for this channel in the selected extent.");
  result.measurements = { samples: count, minimum, maximum, mean };
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
  circulationPath(result, world, input.areaId, source.id, target.id);
}
function circulationPath(
  result: AnalysisResult,
  world: World,
  areaId: string,
  source: string,
  target: string
) {
  const graph = circulation(world, areaId),
    queue = [source],
    previous = new Map([[source, ""]]);
  for (const current of queue) {
    if (current === target) {
      const path: string[] = [];
      for (let id = current; id; id = previous.get(id)!) path.push(id);
      result.path = path.reverse();
      result.features = result.path;
      return;
    }
    for (const next of graph.get(current) ?? [])
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
  }
  result.notes.push("No connected route between the selected features.");
}
function circulation(world: World, areaId: string) {
  const graph = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a)!.add(b);
  };
  for (const feature of Object.values(world.features)) {
    if (areaSpace(world, feature.areaId) !== areaSpace(world, areaId)) continue;
    for (const relation of feature.relations)
      if (["connects", "inside"].includes(relation.kind) && world.features[relation.targetId]) {
        add(feature.id, relation.targetId);
        add(relation.targetId, feature.id);
      }
  }
  return graph;
}
