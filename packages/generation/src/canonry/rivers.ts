// RiverNetworkLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp } from "./math";
import { contributingArea, sourceToOutletOrder } from "./flowGraph";
import { depthRateToDischarge } from "./dimensions";
import { edgeLeadingTo } from "./mesh";

function completeChannels(map: PhysicalField, order: number[], channels: Uint8Array) {
  const downstream = channels.slice();
  for (const i of order) {
    if (!downstream[i]) continue;
    const target = map.FlowTargets[i];
    if (target < 0) continue;
    downstream[target] = 1;
    if (map.WaterKindCodes[target] === 0) channels[target] = 1;
  }
}
function buildChannels(map: PhysicalField, p: PhysicalProfile, order: number[]): Uint8Array {
  let largest = 0;
  for (const basin of map.DrainageBasinIds) largest = Math.max(largest, basin);
  const maximum = new Float64Array(largest + 1),
    channels = new Uint8Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    const basin = map.DrainageBasinIds[i];
    if (basin > 0) maximum[basin] = Math.max(maximum[basin], map.FlowAccumulation[i]);
  }
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0) continue;
    const basin = map.DrainageBasinIds[i],
      discharge =
        basin > 0 && basin < maximum.length ? maximum[basin] : p.RiverAccumulationThreshold;
    if (discharge < p.RiverMinimumBasinDischarge) continue;
    const threshold = clamp(
      (discharge * p.RiverBasinHeadwaterFraction) / 1000,
      p.RiverMinimumAccumulationThreshold,
      p.RiverAccumulationThreshold
    );
    const factor = clamp(
      Math.sqrt(Math.max(0, map.Slope[i]) / Math.max(0.000001, p.ChannelReferenceSlope)),
      p.ChannelSlopeFloor / 1000,
      p.ChannelSlopeCeiling / 1000
    );
    if (map.FlowAccumulation[i] * factor >= threshold) channels[i] = 1;
  }
  completeChannels(map, order, channels);
  return channels;
}
function headwaterReach(
  map: PhysicalField,
  channels: Uint8Array,
  incoming: Int32Array,
  protectedStarts: Uint8Array,
  headwater: number
) {
  const reach = [];
  let current = headwater;
  while (current >= 0 && channels[current] && incoming[current] <= 1) {
    reach.push(current);
    const target = map.FlowTargets[current];
    if (target < 0 || !channels[target] || incoming[target] > 1 || protectedStarts[target]) break;
    current = target;
  }
  return reach;
}
function headwaterCounts(map: PhysicalField, channels: Uint8Array) {
  const incoming = new Int32Array(channels.length),
    protectedStarts = new Uint8Array(channels.length);
  for (let i = 0; i < channels.length; i++) {
    const target = map.FlowTargets[i];
    if (target < 0) continue;
    if (channels[i] && channels[target]) incoming[target]++;
    if (map.WaterKindCodes[i] === 2 && channels[target]) protectedStarts[target] = 1;
  }
  return { incoming, protectedStarts };
}
function shortReachSupported(
  map: PhysicalField,
  p: PhysicalProfile,
  channels: Uint8Array,
  incoming: Int32Array,
  reach: number[]
): boolean {
  const target = map.FlowTargets[reach[reach.length - 1]];
  return (
    (target >= 0 && Boolean(channels[target]) && incoming[target] > 1) ||
    map.FlowAccumulation[reach[0]] >= p.RiverAccumulationThreshold
  );
}
function pruneHeadwaters(map: PhysicalField, p: PhysicalProfile, channels: Uint8Array) {
  const { incoming, protectedStarts } = headwaterCounts(map, channels);
  for (let i = 0; i < channels.length; i++) {
    if (!channels[i] || incoming[i] !== 0 || protectedStarts[i]) continue;
    const reach = headwaterReach(map, channels, incoming, protectedStarts, i);
    if (
      reach.length * map.mesh.spacing < p.MinimumRiverReachLength &&
      !shortReachSupported(map, p, channels, incoming, reach)
    )
      for (const member of reach) channels[member] = 0;
  }
}
function strahlerOrder(largest: number, count: number): number {
  return largest === 0 ? 1 : count >= 2 ? largest + 1 : largest;
}
function strahlerOrders(map: PhysicalField, order: number[], channels: Uint8Array) {
  const largest = new Int32Array(channels.length),
    count = new Int32Array(channels.length);
  for (const i of order) {
    const conduit = !channels[i] && map.WaterKindCodes[i] === 2 && largest[i] > 0;
    if (!channels[i] && !conduit) continue;
    const riverOrder = strahlerOrder(largest[i], count[i]);
    if (channels[i]) map.RiverOrders[i] = riverOrder;
    const target = map.FlowTargets[i];
    if (target < 0) continue;
    if (riverOrder > largest[target]) {
      largest[target] = riverOrder;
      count[target] = 1;
    } else if (riverOrder === largest[target]) count[target]++;
  }
}
export function carriesSpine(map: PhysicalField, source: number, target: number): boolean {
  return (
    map.RiverOrders[source] > 0 ||
    (map.WaterKindCodes[source] === 2 &&
      map.WaterKindCodes[target] !== 2 &&
      map.RiverOrders[target] > 0)
  );
}
function spineMasks(map: PhysicalField) {
  map.RiverSpineEdgeMasks.fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets[i];
    if (target < 0 || !carriesSpine(map, i, target)) continue;
    const sourceEdge = edgeLeadingTo(map.mesh, i, target),
      targetEdge = edgeLeadingTo(map.mesh, target, i);
    if (sourceEdge < 0 || targetEdge < 0)
      throw new Error("River spine contains a non-adjacent segment.");
    map.RiverSpineEdgeMasks[i] |= 1 << sourceEdge;
    map.RiverSpineEdgeMasks[target] |= 1 << targetEdge;
  }
}
export function riverNetwork(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++)
    map.FlowAccumulation[i] = depthRateToDischarge(map.Runoff[i], map.mesh.areas[i]);
  map.CatchmentArea.set(contributingArea(map.FlowTargets, map.mesh.areas));
  map.RiverOrders.fill(0);
  const order = sourceToOutletOrder(map);
  for (const i of order) {
    const target = map.FlowTargets[i];
    if (map.LakeOutletTargets[i] >= 0)
      map.FlowAccumulation[i] = Math.min(map.FlowAccumulation[i], map.LakeOverflow[i]);
    if (target >= 0) map.FlowAccumulation[target] += map.FlowAccumulation[i];
  }
  const channels = buildChannels(map, c.Profile, order);
  pruneHeadwaters(map, c.Profile, channels);
  completeChannels(map, order, channels);
  strahlerOrders(map, order, channels);
  spineMasks(map);
}
