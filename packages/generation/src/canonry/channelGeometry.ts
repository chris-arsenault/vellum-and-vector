import { meshDeltaX } from "./mesh";
// RiverChannelGeometryLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, toUnits, truncate, units } from "./math";
import { edgeLeadingTo } from "./mesh";
import { channelDimensions } from "./dimensions";
import { physicalDistance } from "./physicalMetric";
import { RecordQueue, type NumericalVector } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

function normalize(x: number, y: number): [number, number] {
  const length = Math.max(0.000001, Math.sqrt(x * x + y * y));
  return [x / length, y / length];
}
function direction(map: PhysicalField, source: number, target: number): [number, number] {
  return normalize(
    Math.fround(meshDeltaX(map.mesh, map.mesh.x[target] - map.mesh.x[source])),
    Math.fround(map.mesh.y[target] - map.mesh.y[source])
  );
}
export function dominantUpstream(map: PhysicalField, filled = false): NumericalVector {
  const upstream = workingArray(map, "int32", "channel:upstream").fill(-1);
  const channel = filled ? map.RiverChannelStrength : map.RiverOrders;
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets[i];
    if (channel[i] <= 0 || target < 0 || channel[target] <= 0) continue;
    const previous = upstream[target];
    if (previous < 0 || map.FlowAccumulation[i] > map.FlowAccumulation[previous])
      upstream[target] = i;
  }
  return upstream;
}
export function longitudinalAlignment(
  map: PhysicalField,
  upstream: NumericalVector,
  spine: number,
  target: number
): number {
  let x = 0,
    y = 0;
  const downstream = map.FlowTargets[spine],
    previous = upstream[spine];
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
    if (map.RiverOrders[head] <= 0) continue;
    let target = head,
      source = inflow[target];
    while (source >= 0 && map.RiverOrders[source] <= 0) {
      const se = edgeLeadingTo(map.mesh, source, target),
        te = edgeLeadingTo(map.mesh, target, source);
      if (se < 0 || te < 0) break;
      map.RiverSpineEdgeMasks[source] |= 1 << se;
      map.RiverSpineEdgeMasks[target] |= 1 << te;
      target = source;
      source = inflow[target];
    }
  }
  releaseWorking(map, inflow);
}
type Front = { triangle: number; spine: number; depth: number; maximum: number };
function canWiden(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: NumericalVector,
  spine: number,
  target: number
): boolean {
  if (
    target < 0 ||
    map.RiverOrders[target] > 0 ||
    map.WaterKindCodes[target] !== 0 ||
    map.DrainageBasinIds[target] !== map.DrainageBasinIds[spine] ||
    Math.abs(map.Elevation[spine] - map.Elevation[target]) >
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
  upstream: NumericalVector,
  front: Front,
  target: number
): boolean {
  const depth =
      front.depth + (target < 0 ? Infinity : physicalDistance(map.mesh, front.triangle, target)),
    p = c.Profile;
  if (depth > front.maximum || !canWiden(map, c, upstream, front.spine, target)) return false;
  const relief = toUnits(Math.abs(map.Elevation[front.spine] - map.Elevation[target]));
  const slope = Math.max(0, map.Slope[target] - p.PlainSlopeThreshold) * 10_000;
  const strength = Math.max(
    1,
    map.RiverChannelStrength[front.spine] -
      (p.RiverChannelWidthDecay * depth) / 10_000 -
      relief -
      slope
  );
  const order = map.RiverChannelOrders[front.spine];
  if (
    strength < map.RiverChannelStrength[target] ||
    (strength === map.RiverChannelStrength[target] && order <= map.RiverChannelOrders[target])
  )
    return false;
  map.RiverChannelStrength[target] = strength;
  map.RiverChannelOrders[target] = order;
  return depth < front.maximum;
}
function expansionSteps(map: PhysicalField, c: PhysicalContext, i: number): number {
  const p = c.Profile,
    order = map.RiverOrders[i],
    discharge = truncate(map.FlowAccumulation[i] / Math.max(1, p.RiverAccumulationThreshold));
  if (order < p.RiverChannelWideningOrder && discharge < p.RiverChannelWideningDischargeMultiplier)
    return 0;
  const scale = Math.max(
    order - p.RiverChannelWideningOrder,
    truncate(discharge / p.RiverChannelWideningDischargeMultiplier)
  );
  return Math.min(p.RiverChannelMaximumWidth / 2, (map.RiverWidth[i] / 2) * (1 + scale * 0.05));
}
export function riverChannelGeometry(map: PhysicalField, c: PhysicalContext) {
  map.RiverChannelStrength.fill(0);
  map.RiverChannelOrders.fill(0);
  map.RiverWidth.fill(0);
  map.RiverDepth.fill(0);
  const upstream = dominantUpstream(map),
    frontier = new RecordQueue(3),
    p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const order = map.RiverOrders[i];
    if (order <= 0 && (map.WaterKindCodes[i] === 0 || map.FlowAccumulation[i] <= 0)) continue;
    const dimensions = channelDimensions(
      map.FlowAccumulation[i],
      map.Slope[i],
      map.RockResistance[i]
    );
    map.RiverWidth[i] = dimensions.width;
    map.RiverDepth[i] = dimensions.depth;
    if (order <= 0) continue;
    const discharge = Math.min(
      12,
      truncate(map.FlowAccumulation[i] / Math.max(1, p.RiverAccumulationThreshold))
    );
    map.RiverChannelStrength[i] = clamp(
      p.RiverChannelBaseStrength +
        (order - 1) * p.RiverChannelOrderStrength +
        discharge * p.RiverChannelDischargeStrength,
      1,
      1000
    );
    map.RiverChannelOrders[i] = order;
    const maximum = expansionSteps(map, c, i);
    if (maximum > 0) frontier.push(i, i, 0, maximum);
  }
  try {
    expandChannels(map, c, upstream, frontier);
    extendSpines(map);
  } finally {
    releaseWorking(map, upstream);
  }
}
/** Frontier records: the widened triangle, then spine, depth and maximum as fields 0..2. */
function expandChannels(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: NumericalVector,
  frontier: RecordQueue
) {
  for (let triangle = frontier.shift(); triangle >= 0; triangle = frontier.shift()) {
    const front: Front = {
      triangle,
      spine: frontier.field(0),
      depth: frontier.field(1),
      maximum: frontier.field(2),
    };
    for (let edge = 0; edge < map.mesh.degree[triangle]; edge++) {
      const target = map.mesh.neighbors[triangle * map.mesh.stride + edge];
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
