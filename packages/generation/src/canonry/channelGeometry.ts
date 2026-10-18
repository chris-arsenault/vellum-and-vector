// RiverChannelGeometryLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, toUnits, truncate, units } from "./math";
import { edgeLeadingTo } from "./mesh";

function normalize(x: number, y: number): [number, number] {
  const length = Math.max(0.000001, Math.sqrt(x * x + y * y));
  return [x / length, y / length];
}
function direction(map: PhysicalField, source: number, target: number): [number, number] {
  return normalize(
    Math.fround(map.mesh.x[target] - map.mesh.x[source]),
    Math.fround(map.mesh.y[target] - map.mesh.y[source])
  );
}
export function dominantUpstream(map: PhysicalField, filled = false): Int32Array {
  const upstream = new Int32Array(map.mesh.count).fill(-1);
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
  upstream: Int32Array,
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
}
type Front = { triangle: number; spine: number; depth: number; maximum: number };
function canWiden(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: Int32Array,
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
  upstream: Int32Array,
  front: Front,
  target: number
): boolean {
  const depth = front.depth + 1,
    p = c.Profile;
  if (depth > front.maximum || !canWiden(map, c, upstream, front.spine, target)) return false;
  const relief = toUnits(Math.abs(map.Elevation[front.spine] - map.Elevation[target]));
  const slope = Math.max(0, toUnits(map.Slope[target]) - p.PlainSlopeThreshold);
  const strength = Math.max(
    1,
    map.RiverChannelStrength[front.spine] - p.RiverChannelWidthDecay * depth - relief - slope
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
  return Math.min(p.RiverChannelMaximumExpansionSteps, 1 + truncate(scale / 3));
}
export function riverChannelGeometry(map: PhysicalField, c: PhysicalContext) {
  map.RiverChannelStrength.fill(0);
  map.RiverChannelOrders.fill(0);
  const upstream = dominantUpstream(map),
    frontier: Front[] = [],
    p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const order = map.RiverOrders[i];
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
    if (maximum > 0) frontier.push({ triangle: i, spine: i, depth: 0, maximum });
  }
  for (let head = 0; head < frontier.length; head++) {
    const front = frontier[head];
    for (let edge = 0; edge < 3; edge++) {
      const target = map.mesh.neighbors[front.triangle * 3 + edge];
      if (tryWiden(map, c, upstream, front, target))
        frontier.push({ ...front, triangle: target, depth: front.depth + 1 });
    }
  }
  extendSpines(map);
}
