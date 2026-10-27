import { chartCopies, fieldInterpolator, spatial } from "@atlas/domain";
import type { GenerationState } from "../process";
import { parentChannels } from "./atlasWorkspace";
import { nearestTriangle } from "./mesh";
import { units } from "./math";
import type { PhysicalField } from "./field";
import { workingArray } from "./physicalNumerics";

function conditionSegment(
  map: PhysicalField,
  elevation: ReturnType<typeof fieldInterpolator>,
  span: number,
  a: number[],
  b: number[]
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (span / 2)));
  for (let step = 0; step <= steps; step++) {
    const x = a[0] + ((b[0] - a[0]) * step) / steps,
      y = a[1] + ((b[1] - a[1]) * step) / steps,
      i = nearestTriangle(map.mesh, x - map.mesh.origin[0], y - map.mesh.origin[1]),
      target = units(elevation({ x, y, z: 0 }));
    if (target >= map.Elevation[i]) continue;
    map.BedrockElevation[i] -= map.Elevation[i] - target;
    map.Elevation[i] = target;
  }
}

function drainageAncestor(state: GenerationState) {
  const world = state.domain.world;
  for (let id = world.areas[state.domain.scope.areaId].parentId; id; id = world.areas[id].parentId)
    if (world.drainage?.[id]) return world.drainage[id];
  return undefined;
}
/** Retained reaches constrain valley floors before new tributaries find their way into them. */
export function conditionRegionalCorridors(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    parent = parentChannels(state).get("elevation");
  if (!parent) return;
  const elevation = fieldInterpolator(parent, "elevation"),
    span = state.domain.scope.resolution ?? map.mesh.spacing;
  for (const reach of drainageAncestor(state)?.reaches ?? []) {
    const line = { type: "LineString" as const, coordinates: reach.coordinates };
    for (const shape of chartCopies(state.domain.world.reference, line)) {
      if (shape.type !== "LineString" || !spatial.intersects(shape, state.domain.scope.footprint))
        continue;
      for (let n = 1; n < shape.coordinates.length; n++)
        conditionSegment(map, elevation, span, shape.coordinates[n - 1], shape.coordinates[n]);
    }
  }
}
/** Only water entering the requested region is external supply; local runoff is added separately. */
export function regionalIncomingWater(state: GenerationState) {
  const map = state.physical!.map,
    incoming = workingArray(map, "float64", "regional:incoming-water"),
    area = state.domain.world.areas[state.domain.scope.areaId],
    seen = new Set<string>();
  for (const crossing of area.boundary?.crossings ?? []) {
    if (crossing.kind !== "river" || crossing.direction !== "incoming") continue;
    const key = `${crossing.featureId}:${crossing.point.x}:${crossing.point.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cell = nearestTriangle(
      map.mesh,
      crossing.point.x - map.mesh.origin[0],
      crossing.point.y - map.mesh.origin[1]
    );
    incoming[cell] += Math.max(0, crossing.flow);
  }
  return incoming;
}
