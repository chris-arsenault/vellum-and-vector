// RiverNetworkLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp } from "./math";
import { contributingArea, sourceToOutletOrder } from "./flowGraph";
import { depthRateToDischarge } from "./dimensions";
import { edgeLeadingTo } from "./mesh";
import { physicalDistance } from "./physicalMetric";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

function completeChannels(map: PhysicalField, order: Band, channels: Band) {
  const downstream = map.coverage.copyBand(channels);
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n);
    if (!downstream.get(i)) continue;
    const target = map.FlowTargets.get(i);
    if (target < 0) continue;
    downstream.set(target, 1);
    if (map.WaterKindCodes.get(target) === 0) channels.set(target, 1);
  }
  releaseWorking(map, downstream);
}
function buildChannels(map: PhysicalField, p: PhysicalProfile, order: Band): Band {
  let largest = 0;
  for (let i = 0; i < map.mesh.count; i++) largest = Math.max(largest, map.DrainageBasinIds.get(i));
  const maximum = workingArray(map, "float64", "river:basinMaximum", largest + 1),
    channels = workingArray(map, "uint8", "river:channels");
  for (let i = 0; i < map.mesh.count; i++) {
    const basin = map.DrainageBasinIds.get(i);
    if (basin > 0) maximum.set(basin, Math.max(maximum.get(basin), map.FlowAccumulation.get(i)));
  }
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0) continue;
    const basin = map.DrainageBasinIds.get(i),
      discharge =
        basin > 0 && basin < maximum.length ? maximum.get(basin) : p.RiverAccumulationThreshold;
    if (discharge < p.RiverMinimumBasinDischarge) continue;
    const threshold = clamp(
      (discharge * p.RiverBasinHeadwaterFraction) / 1000,
      p.RiverMinimumAccumulationThreshold,
      p.RiverAccumulationThreshold
    );
    const factor = clamp(
      Math.sqrt(Math.max(0, map.Slope.get(i)) / Math.max(0.000001, p.ChannelReferenceSlope)),
      p.ChannelSlopeFloor / 1000,
      p.ChannelSlopeCeiling / 1000
    );
    if (map.FlowAccumulation.get(i) * factor >= threshold) channels.set(i, 1);
  }
  completeChannels(map, order, channels);
  releaseWorking(map, maximum);
  return channels;
}
function headwaterReach(
  map: PhysicalField,
  channels: Band,
  incoming: Band,
  protectedStarts: Band,
  headwater: number
) {
  // A reach is a short chain of cells; it is sized by the chain, never by the world.
  const reach: number[] = [];
  let current = headwater;
  while (current >= 0 && channels.get(current) && incoming.get(current) <= 1) {
    reach.push(current);
    const target = map.FlowTargets.get(current);
    if (
      target < 0 ||
      !channels.get(target) ||
      incoming.get(target) > 1 ||
      protectedStarts.get(target)
    )
      break;
    current = target;
  }
  return reach;
}
function headwaterCounts(map: PhysicalField, channels: Band) {
  const incoming = workingArray(map, "int32", "river:incoming"),
    protectedStarts = workingArray(map, "uint8", "river:protectedStarts");
  for (let i = 0; i < channels.length; i++) {
    const target = map.FlowTargets.get(i);
    if (target < 0) continue;
    if (channels.get(i) && channels.get(target)) incoming.add(target, 1);
    if (map.WaterKindCodes.get(i) === 2 && channels.get(target)) protectedStarts.set(target, 1);
  }
  return { incoming, protectedStarts };
}
function shortReachSupported(
  map: PhysicalField,
  p: PhysicalProfile,
  channels: Band,
  incoming: Band,
  reach: number[]
): boolean {
  const target = map.FlowTargets.get(reach[reach.length - 1]);
  return (
    (target >= 0 && Boolean(channels.get(target)) && incoming.get(target) > 1) ||
    map.FlowAccumulation.get(reach[0]) >= p.RiverAccumulationThreshold
  );
}
function pruneHeadwaters(map: PhysicalField, p: PhysicalProfile, channels: Band) {
  const { incoming, protectedStarts } = headwaterCounts(map, channels);
  for (let i = 0; i < channels.length; i++) {
    if (!channels.get(i) || incoming.get(i) !== 0 || protectedStarts.get(i)) continue;
    const reach = headwaterReach(map, channels, incoming, protectedStarts, i);
    if (
      reach.reduce((length, cell) => {
        const target = map.FlowTargets.get(cell);
        return length + (target < 0 ? 0 : physicalDistance(map.mesh, cell, target));
      }, 0) < p.MinimumRiverReachLength &&
      !shortReachSupported(map, p, channels, incoming, reach)
    )
      for (const member of reach) channels.set(member, 0);
  }
  releaseWorking(map, incoming, protectedStarts);
}
function strahlerOrder(largest: number, count: number): number {
  return largest === 0 ? 1 : count >= 2 ? largest + 1 : largest;
}
function strahlerOrders(map: PhysicalField, order: Band, channels: Band) {
  const largest = workingArray(map, "int32", "river:largest"),
    count = workingArray(map, "int32", "river:count");
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      channel = channels.get(i) !== 0,
      conduit = !channel && map.WaterKindCodes.get(i) === 2 && largest.get(i) > 0;
    if (!channel && !conduit) continue;
    const riverOrder = strahlerOrder(largest.get(i), count.get(i));
    if (channel) map.RiverOrders.set(i, riverOrder);
    const target = map.FlowTargets.get(i);
    if (target < 0) continue;
    if (riverOrder > largest.get(target)) {
      largest.set(target, riverOrder);
      count.set(target, 1);
    } else if (riverOrder === largest.get(target)) count.add(target, 1);
  }
  releaseWorking(map, largest, count);
}
export function carriesSpine(map: PhysicalField, source: number, target: number): boolean {
  return (
    map.RiverOrders.get(source) > 0 ||
    (map.WaterKindCodes.get(source) === 2 &&
      map.WaterKindCodes.get(target) !== 2 &&
      map.RiverOrders.get(target) > 0)
  );
}
function spineMasks(map: PhysicalField) {
  map.RiverSpineEdgeMasks.fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets.get(i);
    if (target < 0 || !carriesSpine(map, i, target)) continue;
    const sourceEdge = edgeLeadingTo(map.mesh, i, target),
      targetEdge = edgeLeadingTo(map.mesh, target, i);
    if (sourceEdge < 0 || targetEdge < 0)
      throw new Error("River spine contains a non-adjacent segment.");
    map.RiverSpineEdgeMasks.set(i, map.RiverSpineEdgeMasks.get(i) | (1 << sourceEdge));
    map.RiverSpineEdgeMasks.set(target, map.RiverSpineEdgeMasks.get(target) | (1 << targetEdge));
  }
}
export function riverNetwork(map: PhysicalField, c: PhysicalContext, incoming?: Band) {
  for (let i = 0; i < map.mesh.count; i++)
    map.FlowAccumulation.set(
      i,
      depthRateToDischarge(map.Runoff.get(i), map.mesh.area(i)) + (incoming?.get(i) ?? 0)
    );
  const area = contributingArea(map, map.FlowTargets);
  map.CatchmentArea.copyFrom(area);
  releaseWorking(map, area);
  map.RiverOrders.fill(0);
  const order = sourceToOutletOrder(map);
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      target = map.FlowTargets.get(i);
    if (map.LakeOutletTargets.get(i) >= 0)
      map.FlowAccumulation.set(i, Math.min(map.FlowAccumulation.get(i), map.LakeOverflow.get(i)));
    if (target >= 0) map.FlowAccumulation.add(target, map.FlowAccumulation.get(i));
  }
  const channels = buildChannels(map, c.Profile, order);
  pruneHeadwaters(map, c.Profile, channels);
  completeChannels(map, order, channels);
  strahlerOrders(map, order, channels);
  spineMasks(map);
  releaseWorking(map, order, channels);
}
