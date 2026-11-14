import { areaSpace, spatial, type NetworkReach, type World } from "@atlas/domain";
import type { AnalysisResult } from "./spatialAnalysis";

interface Edge {
  to: string;
  reach: NetworkReach;
  distance: number;
}
export function analyzeNetwork(
  world: World,
  areaId: string,
  source: string,
  target: string,
  kind: string
): Partial<AnalysisResult> {
  const reaches = Object.values(world.networkReaches ?? {}).filter((reach) => {
    const feature = world.features[reach.featureId];
    return (
      feature &&
      feature.kind === kind &&
      areaSpace(world, feature.areaId) === areaSpace(world, areaId)
    );
  });
  const starts = reaches.filter((r) => r.featureId === source).flatMap((r) => [r.start, r.end]);
  const ends = new Set(
    reaches.filter((r) => r.featureId === target).flatMap((r) => [r.start, r.end])
  );
  const graph = graphEdges(reaches, kind === "river");
  const costs = new Map(starts.map((node) => [node, 0])),
    previous = new Map<string, { from: string; reach: NetworkReach }>();
  const pending = new Set(starts);
  while (pending.size) {
    const node = [...pending].sort((a, b) => costs.get(a)! - costs.get(b)!)[0];
    pending.delete(node);
    if (ends.has(node)) return result(previous, node, costs.get(node)!, source, target);
    for (const edge of graph.get(node) ?? []) {
      const next = costs.get(node)! + edge.distance;
      if (next >= (costs.get(edge.to) ?? Infinity)) continue;
      costs.set(edge.to, next);
      previous.set(edge.to, { from: node, reach: edge.reach });
      pending.add(edge.to);
    }
  }
  return { notes: ["No passable network route connects these features in this located space."] };
}
function graphEdges(reaches: NetworkReach[], directed: boolean) {
  const graph = new Map<string, Edge[]>();
  const add = (from: string, to: string, reach: NetworkReach) =>
    graph.set(from, [
      ...(graph.get(from) ?? []),
      { to, reach, distance: spatial.length(reach.geometry) },
    ]);
  for (const reach of reaches) {
    add(reach.start, reach.end, reach);
    if (!directed) add(reach.end, reach.start, reach);
  }
  return graph;
}
function result(
  previous: Map<string, { from: string; reach: NetworkReach }>,
  end: string,
  distance: number,
  source: string,
  target: string
): Partial<AnalysisResult> {
  const path: NetworkReach[] = [];
  for (let node = end; previous.has(node); node = previous.get(node)!.from)
    path.unshift(previous.get(node)!.reach);
  return {
    path: [...new Set([source, ...path.map((r) => r.featureId), target])],
    features: [...new Set([source, ...path.map((r) => r.featureId), target])],
    measurements: { length_m: distance },
    geometry: path.length
      ? { type: "GeometryCollection", geometries: path.map((r) => r.geometry) }
      : null,
  };
}
