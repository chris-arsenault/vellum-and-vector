import GeoJSON from "ol/format/GeoJSON.js";
import {
  evaluateMapFeature,
  featureEditSchema,
  semanticId,
  materializeField,
  sample,
  spatial,
  areaSpace,
  requireThat,
  canonicalGeometry,
  unwrapCoordinates,
  type DomainSnapshot,
  type IntentContext,
  type Position,
} from "@atlas/domain";
import { findRoute } from "@atlas/generation";

export function routeNetwork(
  snapshot: DomainSnapshot,
  context: IntentContext,
  data: Record<string, unknown>
) {
  const waypoints = structuredClone(data.waypoints) as Position[];
  requireThat(waypoints.length >= 2, "route_waypoints", "Draw at least two route waypoints.");
  attach(snapshot, waypoints, data.startFeatureId, 0);
  attach(snapshot, waypoints, data.endFeatureId, waypoints.length - 1);
  const field = snapshot.world.fields.find(
    (f) =>
      f.channels?.includes("elevation") &&
      areaSpace(snapshot.world, f.areaId) === context.scope.spaceId &&
      waypoints.every((p) =>
        spatial.covers(snapshot.numerical[f.id].scope.footprint, {
          type: "Point",
          coordinates: [p.x, p.y],
        })
      )
  );
  requireThat(
    field,
    "route_field",
    "Generate terrain covering the route before using assisted routing."
  );
  const grid = materializeField(snapshot.numerical[field.id]);
  const points = waypoints.slice(1).flatMap((point, index) => {
    const path = findRoute(grid, waypoints[index], point, String(data.kind));
    requireThat(
      path.length,
      "route_unavailable",
      "No passable route connects these waypoints. Adjust the route or its terrain."
    );
    return index ? path.slice(1) : path;
  });
  const channel =
    data.kind === "river" && grid.channels.drainageElevation ? "drainageElevation" : "elevation";
  const elevations = points.map((p) => sample(grid, channel, p));
  const feature = {
    id: semanticId(snapshot.world.id, "route", context.operationId),
    name: data.name,
    kind: data.kind,
    layerId: data.kind === "river" ? "rivers" : "roads",
    geometry: canonicalGeometry(snapshot.world.reference, {
      type: "LineString",
      coordinates: unwrapCoordinates(
        points.map((p) => [p.x, p.y]),
        grid.periodicWidth
      ),
    }),
    attributes: { elevations, ...(data.kind === "river" ? { discharge: data.flow } : {}) },
    relations: [],
    protected: true,
  };
  return evaluateMapFeature(
    featureEditSchema.parse({ areaId: context.scope.areaId, feature }),
    context,
    snapshot
  );
}
function attach(snapshot: DomainSnapshot, points: Position[], input: unknown, index: number) {
  if (!input) return;
  const feature = snapshot.world.features[String(input)];
  requireThat(feature, "route_attachment", "Choose an existing feature for the route attachment.");
  const p = points[index];
  const coordinate = new GeoJSON().readGeometry(feature.geometry)!.getClosestPoint([p.x, p.y]);
  points[index] = { x: coordinate[0], y: coordinate[1], z: p.z };
}
