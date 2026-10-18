import type { AtlasFeature, NetworkNode, NetworkReach, Position, World } from "./model";
import type { ChangeSet, DomainSnapshot } from "./operations";
import type { Geometry } from "geojson";
import { Spatial, point } from "./spatial";
import { composeFeature, combineGeometry, areaSpace, geometryParts } from "./composition";
import { projectChanges } from "./projection";
import { lineEndpoints, splitDirectedLine } from "./networkGeometry";
import { semanticId } from "./identity";
import { featureStation } from "./boundaryContracts";
import { requireThat } from "./errors";
import { sameValue } from "./values";
import { layerSupports } from "./builtinLayers";
import { locateOnLine, lineParts } from "./lineStations";

interface Path {
  feature: AtlasFeature;
  geometry: Geometry;
  space: string;
}
function networkPaths(world: World, footprint: Geometry, gis: Spatial): Path[] {
  return Object.values(world.features).flatMap((feature) => {
    const layer = world.layers[feature.layerId];
    if (!layer || !layerSupports(layer, "network")) return [];
    const composed = composeFeature(world, feature),
      geometry = composed && gis.intersection(composed, footprint);
    return geometry?.type.includes("LineString")
      ? [{ feature, geometry, space: areaSpace(world, feature.areaId) }]
      : [];
  });
}
function affectedPaths(
  paths: Path[],
  ids: string[],
  snapshot: DomainSnapshot,
  gis: Spatial
): Path[] {
  const changed = paths.filter((p) => ids.includes(p.feature.id));
  const neighbors = new Set(
    Object.values(snapshot.world.networkReaches ?? {})
      .filter((r) => ids.includes(r.featureId))
      .flatMap((r) => [r.start, r.end])
  );
  const adjacent = new Set(
    Object.values(snapshot.world.networkReaches ?? {})
      .filter((r) => neighbors.has(r.start) || neighbors.has(r.end))
      .map((r) => r.featureId)
  );
  return paths.filter(
    (p) =>
      ids.includes(p.feature.id) ||
      adjacent.has(p.feature.id) ||
      changed.some(
        (c) =>
          c.space === p.space &&
          c.feature.layerId === p.feature.layerId &&
          gis.intersects(c.geometry, p.geometry)
      )
  );
}
function preserveJunctions(snapshot: DomainSnapshot, paths: Path[], ids: string[], gis: Spatial) {
  const reaches = Object.values(snapshot.world.networkReaches ?? {}),
    nodes = snapshot.world.networkNodes ?? {};
  for (const path of paths.filter((p) => ids.includes(p.feature.id))) {
    const own = reaches.filter((r) => r.featureId === path.feature.id);
    for (const id of new Set(own.flatMap((r) => [r.start, r.end]))) {
      if (nodes[id] && !gis.covers(snapshot.scope.footprint, point(nodes[id].position))) continue;
      const incident = new Set(
        reaches.filter((r) => r.start === id || r.end === id).map((r) => r.featureId)
      );
      if (incident.size < 2) continue;
      requireThat(
        nodes[id] && gis.distance(path.geometry, point(nodes[id].position)) <= gis.precision,
        "locked_junction",
        "Keep shared network junctions anchored; move them through an explicit junction operation."
      );
      requireThat(
        Math.abs(nodeElevation(snapshot, path, nodes[id].position) - nodes[id].position.z) <=
          gis.precision,
        "locked_junction_elevation",
        "Connected junction elevations move together through an explicit junction operation."
      );
    }
  }
}
function pathAnchors(
  path: Path,
  paths: Path[],
  snapshot: DomainSnapshot,
  gis: Spatial
): Position[] {
  const compatible = paths.filter(
    (p) => p.space === path.space && p.feature.layerId === path.feature.layerId
  );
  const line = combineGeometry(
    compatible.map((p) => p.geometry),
    1
  )!;
  const noded = lineEndpoints(gis.nodeLines(line));
  const boundaries = Object.values(snapshot.world.areas)
    .filter((a) => areaSpace(snapshot.world, a.id) === path.space)
    .flatMap(
      (a) =>
        a.boundary?.crossings.filter((c) => c.featureId === path.feature.id).map((c) => c.point) ??
        []
    );
  return [...noded, ...boundaries];
}
function nodeElevation(snapshot: DomainSnapshot, path: Path, p: Position) {
  return (
    featureStation(snapshot, path.feature, "elevations", p) ??
    locateOnLine(path.geometry, p).point.z
  );
}
function nodeIdentity(
  path: Path,
  p: Position,
  elevation: number,
  snapshot: DomainSnapshot,
  gis: Spatial
): string {
  const compatible = new Set(
    Object.values(snapshot.world.networkReaches ?? {})
      .filter((r) => snapshot.world.features[r.featureId]?.layerId === path.feature.layerId)
      .flatMap((r) => [r.start, r.end])
  );
  const existing = Object.values(snapshot.world.networkNodes ?? {}).find(
    (n) =>
      compatible.has(n.id) &&
      n.spaceId === path.space &&
      Math.hypot(n.position.x - p.x, n.position.y - p.y) <= gis.precision &&
      Math.abs(n.position.z - elevation) <= gis.precision
  );
  if (existing) return existing.id;
  return (
    boundaryNode(path, p, snapshot, gis) ??
    semanticId(
      snapshot.world.id,
      "network-node",
      JSON.stringify([path.space, path.feature.layerId, p.x, p.y, elevation])
    )
  );
}
function boundaryNode(path: Path, p: Position, snapshot: DomainSnapshot, gis: Spatial) {
  const boundary = Object.values(snapshot.world.areas)
    .flatMap((a) => a.boundary?.crossings ?? [])
    .find(
      (c) =>
        c.featureId === path.feature.id &&
        Math.hypot(c.point.x - p.x, c.point.y - p.y) <= gis.precision
    );
  return boundary?.nodeId;
}
function nodeFor(
  path: Path,
  p: Position,
  snapshot: DomainSnapshot,
  nodes: Map<string, NetworkNode>,
  gis: Spatial
): NetworkNode {
  const elevation = nodeElevation(snapshot, path, p),
    id = nodeIdentity(path, p, elevation, snapshot, gis);
  const value: NetworkNode = {
    id,
    kind: snapshot.world.networkNodes?.[id]?.kind ?? `network:${path.feature.layerId}`,
    spaceId: path.space,
    position: { ...p, z: elevation },
    waterLevel: path.feature.kind === "river" ? elevation : null,
  };
  const previous = nodes.get(id);
  requireThat(
    !previous || Math.abs(previous.position.z - elevation) <= gis.precision,
    "junction_elevation",
    "Connected network paths meet at the same elevation; use a located connection for separate levels."
  );
  nodes.set(id, previous ?? value);
  return previous ?? value;
}
function pathReaches(
  path: Path,
  paths: Path[],
  snapshot: DomainSnapshot,
  nodes: Map<string, NetworkNode>,
  gis: Spatial
): NetworkReach[] {
  const occurrences = new Map<string, number>();
  return splitDirectedLine(
    path.geometry,
    pathAnchors(path, paths, snapshot, gis),
    gis.precision
  ).map((geometry) => {
    const [a, b] = lineEndpoints(geometry),
      start = nodeFor(path, a, snapshot, nodes, gis),
      end = nodeFor(path, b, snapshot, nodes, gis);
    const pair = JSON.stringify([start.id, end.id]),
      occurrence = occurrences.get(pair) ?? 0;
    occurrences.set(pair, occurrence + 1);
    return {
      id: semanticId(
        snapshot.world.id,
        "network-reach",
        JSON.stringify([path.feature.id, start.id, end.id, occurrence])
      ),
      featureId: path.feature.id,
      start: start.id,
      end: end.id,
      geometry,
      flow: featureStation(snapshot, path.feature, "discharges", a) ?? 0,
      endFlow: featureStation(snapshot, path.feature, "discharges", b),
    };
  });
}
export function updateNetworkTopology(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  ids: string[]
): void {
  const candidate = projectChanges(snapshot, changes),
    gis = new Spatial(snapshot.world.reference.precision),
    paths = affectedPaths(
      networkPaths(candidate.world, snapshot.scope.footprint, gis),
      ids,
      snapshot,
      gis
    );
  if (paths.length === 0) return;
  preserveJunctions(candidate, paths, ids, gis);
  const nodes = new Map<string, NetworkNode>(),
    reaches = paths.flatMap((p) => pathReaches(p, paths, candidate, nodes, gis));
  reaches.push(...outsideReaches(snapshot, paths, nodes, gis));
  const affected = new Set(paths.map((p) => p.feature.id)),
    retained = new Set(reaches.map((r) => r.id));
  publishTopology(snapshot, changes, affected, retained, reaches, nodes);
}
function outsideReaches(
  snapshot: DomainSnapshot,
  paths: Path[],
  nodes: Map<string, NetworkNode>,
  gis: Spatial
): NetworkReach[] {
  return paths.flatMap((path) => {
    const old = Object.values(snapshot.world.networkReaches ?? {}).filter(
      (r) => r.featureId === path.feature.id
    );
    if (!old.length) {
      const source = snapshot.world.features[path.feature.id];
      const geometry = source && composeFeature(snapshot.world, source),
        outside = geometry && gis.difference(geometry, snapshot.scope.footprint);
      if (!outside || !source) return [];
      const previous = { ...path, feature: source, geometry: outside };
      return pathReaches(previous, [previous], snapshot, nodes, gis);
    }
    return old.flatMap((reach) => {
      const intersect = gis.intersection(reach.geometry, snapshot.scope.footprint);
      if (!intersect || gis.length(intersect) <= gis.precision) return [reach];
      return geometryParts(gis.difference(reach.geometry, snapshot.scope.footprint))
        .filter((g) => g.type === "LineString")
        .map((geometry) => outsideReach(reach, geometry, path, snapshot, nodes, gis));
    });
  });
}
function outsideReach(
  old: NetworkReach,
  geometry: Geometry,
  path: Path,
  snapshot: DomainSnapshot,
  nodes: Map<string, NetworkNode>,
  gis: Spatial
): NetworkReach {
  const endpoints = lineEndpoints(geometry),
    oldNodes = [snapshot.world.networkNodes![old.start], snapshot.world.networkNodes![old.end]];
  const at = (p: Position) =>
    oldNodes.find((n) => Math.hypot(n.position.x - p.x, n.position.y - p.y) <= gis.precision) ??
    nodeFor(path, p, snapshot, nodes, gis);
  const start = at(endpoints[0]),
    end = at(endpoints[1]);
  nodes.set(start.id, start);
  nodes.set(end.id, end);
  const rate = (p: Position) =>
    old.flow + ((old.endFlow ?? old.flow) - old.flow) * reachFraction(old.geometry, p);
  return {
    id: semanticId(
      snapshot.world.id,
      "network-reach",
      JSON.stringify([old.featureId, start.id, end.id, 0])
    ),
    featureId: old.featureId,
    start: start.id,
    end: end.id,
    geometry,
    flow: rate(endpoints[0]),
    endFlow: old.endFlow === null ? null : rate(endpoints[1]),
  };
}
function reachFraction(geometry: Geometry, p: Position): number {
  const location = locateOnLine(geometry, p);
  let length = 0,
    before = 0;
  for (const [part, coordinates] of lineParts(geometry).entries())
    for (let i = 1; i < coordinates.length; i++) {
      const step = Math.hypot(
        coordinates[i][0] - coordinates[i - 1][0],
        coordinates[i][1] - coordinates[i - 1][1]
      );
      if (part < location.part || (part === location.part && i - 1 < location.segment))
        before += step;
      if (part === location.part && i - 1 === location.segment) before += step * location.fraction;
      length += step;
    }
  return length === 0 ? 0 : before / length;
}
function publishTopology(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  affected: Set<string>,
  retained: Set<string>,
  reaches: NetworkReach[],
  nodes: Map<string, NetworkNode>
) {
  changes.removes.push(
    ...Object.values(snapshot.world.networkReaches ?? {})
      .filter((old) => affected.has(old.featureId) && !retained.has(old.id))
      .map((old) => ({ kind: "reach" as const, id: old.id }))
  );
  for (const value of reaches)
    if (!sameValue(snapshot.world.networkReaches?.[value.id], value))
      changes.writes.push({ kind: "reach", value });
  for (const value of nodes.values())
    if (!sameValue(snapshot.world.networkNodes?.[value.id], value)) upsertNode(changes, value);
  removeOrphanNodes(snapshot, changes, affected, reaches);
}
function upsertNode(changes: ChangeSet, value: NetworkNode) {
  const index = changes.writes.findIndex((w) => w.kind === "node" && w.value.id === value.id);
  if (index < 0) changes.writes.push({ kind: "node", value });
  else changes.writes[index] = { kind: "node", value };
}
function removeOrphanNodes(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  affected: Set<string>,
  reaches: NetworkReach[]
) {
  const old = Object.values(snapshot.world.networkReaches ?? {});
  const used = new Set(
    [...reaches, ...old.filter((r) => !affected.has(r.featureId))].flatMap((r) => [r.start, r.end])
  );
  for (const connection of Object.values(snapshot.world.connections ?? {})) {
    if (connection.a.nodeId) used.add(connection.a.nodeId);
    if (connection.b.nodeId) used.add(connection.b.nodeId);
  }
  const prior = new Set(
    old.filter((r) => affected.has(r.featureId)).flatMap((r) => [r.start, r.end])
  );
  for (const id of prior) if (!used.has(id)) changes.removes.push({ kind: "node", id });
}
