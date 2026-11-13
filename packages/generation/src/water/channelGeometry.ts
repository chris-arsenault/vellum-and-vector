import { meshDeltaX } from "../world/mesh";
// RiverChannelGeometryLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "../world/field";
import type { PhysicalContext } from "../world/context";
import { clamp, toUnits, truncate, units } from "../world/math";
import { edgeLeadingTo } from "../world/mesh";
import { groundOf } from "../rock/ground";
import { surfaceStanding } from "../rock/groundQueries";
import { channelDimensions } from "../world/dimensions";
import { physicalDistance } from "../world/physicalMetric";
import { RecordQueue, type Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "../world/physicalNumerics";
import { reachAt } from "./riverKeeping";
import type { Reach } from "./reaches";
import { flowThroughYear } from "./waterBalance";
import { riverStorage } from "./riverStorage";

function normalize(x: number, y: number): [number, number] {
  const length = Math.max(0.000001, Math.sqrt(x * x + y * y));
  return [x / length, y / length];
}
function direction(map: PhysicalField, source: number, target: number): [number, number] {
  return normalize(
    Math.fround(meshDeltaX(map.mesh, map.mesh.x(target) - map.mesh.x(source))),
    Math.fround(map.mesh.y(target) - map.mesh.y(source))
  );
}
export function dominantUpstream(map: PhysicalField, filled = false): Band {
  const upstream = workingArray(map, "int32", "channel:upstream").fill(-1);
  const channel = filled ? map.RiverChannelStrength : map.RiverOrders;
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets.get(i);
    if (channel.get(i) <= 0 || target < 0 || channel.get(target) <= 0) continue;
    const previous = upstream.get(target);
    if (previous < 0 || map.FlowAccumulation.get(i) > map.FlowAccumulation.get(previous))
      upstream.set(target, i);
  }
  return upstream;
}
export function longitudinalAlignment(
  map: PhysicalField,
  upstream: Band,
  spine: number,
  target: number
): number {
  let x = 0,
    y = 0;
  const downstream = map.FlowTargets.get(spine),
    previous = upstream.get(spine);
  if (downstream >= 0) {
    const [dx, dy] = direction(map, spine, downstream);
    x += dx;
    y += dy;
  }
  if (previous >= 0) {
    const [dx, dy] = direction(map, previous, spine);
    x += dx;
    y += dy;
  }
  const [tx, ty] = normalize(x, y),
    [bx, by] = direction(map, spine, target);
  return Math.abs(tx * bx + ty * by);
}
function extendSpines(map: PhysicalField) {
  const inflow = dominantUpstream(map, true);
  for (let head = 0; head < map.mesh.count; head++) {
    if (map.RiverOrders.get(head) <= 0) continue;
    let target = head,
      source = inflow.get(target);
    while (source >= 0 && map.RiverOrders.get(source) <= 0) {
      const se = edgeLeadingTo(map.mesh, source, target),
        te = edgeLeadingTo(map.mesh, target, source);
      if (se < 0 || te < 0) break;
      map.RiverSpineEdgeMasks.set(source, map.RiverSpineEdgeMasks.get(source) | (1 << se));
      map.RiverSpineEdgeMasks.set(target, map.RiverSpineEdgeMasks.get(target) | (1 << te));
      target = source;
      source = inflow.get(target);
    }
  }
  releaseWorking(map, inflow);
}
type Front = { triangle: number; spine: number; depth: number; maximum: number };
function canWiden(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: Band,
  spine: number,
  target: number
): boolean {
  if (
    target < 0 ||
    map.RiverOrders.get(target) > 0 ||
    map.WaterKindCodes.get(target) !== 0 ||
    map.DrainageBasinIds.get(target) !== map.DrainageBasinIds.get(spine) ||
    Math.abs(map.Elevation.get(spine) - map.Elevation.get(target)) >
      units(c.Profile.RiverChannelMaximumBankRelief)
  )
    return false;
  return (
    longitudinalAlignment(map, upstream, spine, target) <=
    c.Profile.RiverChannelMaximumLongitudinalAlignment / 1000
  );
}
function tryWiden(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: Band,
  front: Front,
  target: number
): boolean {
  const depth =
      front.depth + (target < 0 ? Infinity : physicalDistance(map.mesh, front.triangle, target)),
    p = c.Profile;
  if (depth > front.maximum || !canWiden(map, c, upstream, front.spine, target)) return false;
  const relief = toUnits(Math.abs(map.Elevation.get(front.spine) - map.Elevation.get(target)));
  const slope = Math.max(0, map.Slope.get(target) - p.PlainSlopeThreshold) * 10_000;
  const strength = Math.max(
    1,
    map.RiverChannelStrength.get(front.spine) -
      (p.RiverChannelWidthDecay * depth) / map.scale.length(0.0025) -
      relief / map.scale.length(2.5e-7) -
      slope
  );
  const order = map.RiverChannelOrders.get(front.spine),
    held = map.RiverChannelStrength.get(target);
  if (strength < held || (strength === held && order <= map.RiverChannelOrders.get(target)))
    return false;
  map.RiverChannelStrength.set(target, strength);
  map.RiverChannelOrders.set(target, order);
  return depth < front.maximum;
}
function expansionSteps(map: PhysicalField, c: PhysicalContext, i: number): number {
  const p = c.Profile,
    order = map.RiverOrders.get(i),
    discharge = truncate(
      map.FlowAccumulation.get(i) /
        Math.max(map.scale.volume(1.5625e-20), p.RiverAccumulationThreshold)
    );
  if (order < p.RiverChannelWideningOrder && discharge < p.RiverChannelWideningDischargeMultiplier)
    return 0;
  const scale = Math.max(
    order - p.RiverChannelWideningOrder,
    truncate(discharge / p.RiverChannelWideningDischargeMultiplier)
  );
  return (map.RiverWidth.get(i) / 2) * (1 + scale * 0.05);
}
/** A bed kept shallow where people cross (a ford) is no deeper than it is kept. */
export function shoalBed(map: PhysicalField, i: number, depth: number) {
  const found = reachAt(map, i),
    reach = found ? riverStorage(map).reaches.get(found.id) : undefined,
    at = reach?.cells.indexOf(i) ?? -1;
  if (!reach || at < 0 || depth >= reach.depth[at]) return;
  reach.depth[at] = Math.max(0, depth);
  map.RiverDepth.set(i, reach.depth[at]);
}
export function riverChannelGeometry(map: PhysicalField, c: PhysicalContext) {
  map.RiverChannelStrength.fill(0);
  map.RiverChannelOrders.fill(0);
  map.RiverWidth.fill(0);
  map.RiverDepth.fill(0);
  const upstream = dominantUpstream(map),
    frontier = new RecordQueue(3);
  for (const reach of riverStorage(map).reaches.values())
    if (!reach.dry) reach.cells.forEach((_, at) => sizeChannel(map, c, reach, at, frontier));
  try {
    expandChannels(map, c, upstream, frontier);
    extendSpines(map);
  } finally {
    releaseWorking(map, upstream);
  }
}

function sizeChannel(
  map: PhysicalField,
  c: PhysicalContext,
  reach: Reach,
  at: number,
  frontier: RecordQueue
) {
  const i = reach.cells[at],
    p = c.Profile,
    flow = flowThroughYear(reach.monthly.subarray(at * 12, (at + 1) * 12), 0).mean;
  if (flow <= 0 || map.WaterKindCodes.get(i) !== 0) return;
  const dimensions = channelDimensions(
    flow,
    map.Slope.get(i),
    groundOf(map).fold(i, surfaceStanding),
    map.scale
  );
  reach.width[at] = dimensions.width;
  reach.depth[at] = dimensions.depth;
  map.RiverWidth.set(i, reach.width[at]);
  map.RiverDepth.set(i, reach.depth[at]);
  const discharge = truncate(
    flow / Math.max(map.scale.volume(1.5625e-20), p.RiverAccumulationThreshold)
  );
  map.RiverChannelStrength.set(
    i,
    clamp(
      p.RiverChannelBaseStrength +
        (reach.order - 1) * p.RiverChannelOrderStrength +
        discharge * p.RiverChannelDischargeStrength,
      1,
      1000
    )
  );
  map.RiverChannelOrders.set(i, reach.order);
  const maximum = expansionSteps(map, c, i);
  if (maximum > 0) frontier.push(i, i, 0, maximum);
}
/** Frontier records: the widened triangle, then spine, depth and maximum as fields 0..2. */
function expandChannels(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: Band,
  frontier: RecordQueue
) {
  for (let triangle = frontier.shift(); triangle >= 0; triangle = frontier.shift()) {
    const front: Front = {
      triangle,
      spine: frontier.field(0),
      depth: frontier.field(1),
      maximum: frontier.field(2),
    };
    for (let edge = 0; edge < map.mesh.degree(triangle); edge++) {
      const target = map.mesh.neighbor(triangle, edge);
      if (tryWiden(map, c, upstream, front, target))
        frontier.push(
          target,
          front.spine,
          front.depth + physicalDistance(map.mesh, triangle, target),
          front.maximum
        );
    }
  }
}
