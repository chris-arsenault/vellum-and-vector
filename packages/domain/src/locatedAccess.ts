import type { Area, AtlasFeature, Connection, NetworkNode, Position } from "./model";
import type { IntentContext } from "./intent";
import type { ChangeSet, DomainSnapshot } from "./operations";
import { semanticId } from "./identity";
import { areaSpace } from "./composition";
import { boundaryRings, sampleFields } from "./boundaryContracts";
import { upsertArea } from "./authoringBasics";
import { requireThat } from "./errors";

function entryMarker(
  id: string,
  areaId: string,
  p: Position,
  actor: string,
  layer: string,
  name: string,
  node: string
): AtlasFeature {
  return {
    id,
    areaId,
    name,
    kind: "entrance",
    layerId: layer,
    geometry: { type: "Point", coordinates: [p.x, p.y, p.z] },
    detail: {},
    attributes: { nodeId: node },
    relations: [],
    state: "authored",
    protected: false,
    actor,
    generationId: null,
    causes: [],
  };
}
export function addLocatedAccess(
  changes: ChangeSet,
  context: IntentContext,
  snapshot: DomainSnapshot,
  area: Area
): void {
  const parent = snapshot.world.areas[area.parentId!],
    world = snapshot.world.id;
  const layer = context.layers.find(
    (l) =>
      l.id === "pois" && l.profiles.includes(parent.profile) && l.profiles.includes(area.profile)
  );
  requireThat(
    layer,
    "access_layer",
    "Register a point layer supporting the parent and located space before adding access markers."
  );
  const ring = boundaryRings(area.footprint)[0],
    a = ring[0],
    b = ring[1];
  const location = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: area.frame.origin.z };
  const outside = {
    ...location,
    z: sampleFields(snapshot, location).elevation ?? parent.frame.origin.z,
  };
  const source = semanticId(world, "access-feature", `${area.id}:parent`),
    target = semanticId(world, "access-feature", `${area.id}:inside`);
  const from: NetworkNode = {
    id: semanticId(world, "access-node", source),
    kind: "access",
    position: outside,
    spaceId: areaSpace(snapshot.world, parent.id),
    waterLevel: null,
  };
  const to: NetworkNode = {
    ...from,
    id: semanticId(world, "access-node", target),
    position: location,
    spaceId: area.id,
  };
  const connection: Connection = {
    id: semanticId(world, "access-connection", area.id),
    kind: location.z === outside.z ? "entrance" : "stairs",
    a: { areaId: parent.id, position: outside, featureId: source, nodeId: from.id },
    b: { areaId: area.id, position: location, featureId: target, nodeId: to.id },
    flow: 0,
  };
  appendAccessWrites(changes, context, {
    parent,
    area,
    layerId: layer.id,
    source,
    target,
    from,
    to,
    connection,
  });
}
interface AccessLayout {
  parent: Area;
  area: Area;
  layerId: string;
  source: string;
  target: string;
  from: NetworkNode;
  to: NetworkNode;
  connection: Connection;
}
function appendAccessWrites(changes: ChangeSet, context: IntentContext, layout: AccessLayout) {
  const { parent, area, layerId, source, target, from, to, connection } = layout;
  const outside = from.position,
    location = to.position;
  changes.writes.push(
    {
      kind: "feature",
      value: entryMarker(
        source,
        parent.id,
        outside,
        context.actor,
        layerId,
        `${area.name} entrance`,
        from.id
      ),
    },
    {
      kind: "feature",
      value: entryMarker(
        target,
        area.id,
        location,
        context.actor,
        layerId,
        `${area.name} access`,
        to.id
      ),
    },
    { kind: "node", value: from },
    { kind: "node", value: to },
    { kind: "connection", value: connection }
  );
  markAccessAreas(changes, parent, area, layerId);
}
function markAccessAreas(changes: ChangeSet, parent: Area, area: Area, layer: string) {
  upsertArea(changes, { ...parent, layers: { ...parent.layers, [layer]: "authored" } });
  upsertArea(changes, { ...area, layers: { ...area.layers, [layer]: "authored" } });
}
