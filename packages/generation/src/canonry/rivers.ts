// RiverNetworkLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp } from "./math";
import { contributingArea, sourceToOutletOrder } from "./flowGraph";
import { depthRateToDischarge } from "./dimensions";
import { edgeLeadingTo } from "./mesh";
import { physicalDistance } from "./physicalMetric";
import type { NumericalVector } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

function completeChannels(map: PhysicalField, order: NumericalVector, channels: NumericalVector) {
  const downstream = channels.slice();
  for (const i of order) {
    if (!downstream[i]) continue;
    const target = map.FlowTargets[i];
    if (target < 0) continue;
    downstream[target] = 1;
    if (map.WaterKindCodes[target] === 0) channels[target] = 1;
  }
  releaseWorking(map, downstream);
}
function buildChannels(
  map: PhysicalField,
  p: PhysicalProfile,
  order: NumericalVector
): NumericalVector {
  let largest = 0;
  for (const basin of map.DrainageBasinIds) largest = Math.max(largest, basin);
  const maximum = workingArray(map, "float64", "river:basinMaximum", largest + 1),
    channels = workingArray(map, "uint8", "river:channels");
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
  releaseWorking(map, maximum);
  return channels;
}
function headwaterReach(
  map: PhysicalField,
  channels: NumericalVector,
  incoming: NumericalVector,
  protectedStarts: NumericalVector,
  headwater: number,
  reach: NumericalVector
) {
  let count = 0;
  let current = headwater;
  while (current >= 0 && channels[current] && incoming[current] <= 1) {
    reach[count++] = current;
    const target = map.FlowTargets[current];
    if (target < 0 || !channels[target] || incoming[target] > 1 || protectedStarts[target]) break;
    current = target;
  }
  return reach.subarray(0, count);
}
function headwaterCounts(map: PhysicalField, channels: NumericalVector) {
  const incoming = workingArray(map, "int32", "river:incoming"),
    protectedStarts = workingArray(map, "uint8", "river:protectedStarts");
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
  channels: NumericalVector,
  incoming: NumericalVector,
  reach: NumericalVector
): boolean {
  const target = map.FlowTargets[reach[reach.length - 1]];
  return (
    (target >= 0 && Boolean(channels[target]) && incoming[target] > 1) ||
    map.FlowAccumulation[reach[0]] >= p.RiverAccumulationThreshold
  );
}
function pruneHeadwaters(map: PhysicalField, p: PhysicalProfile, channels: NumericalVector) {
  const { incoming, protectedStarts } = headwaterCounts(map, channels);
  const scratch = workingArray(map, "int32", "river:reach");
  for (let i = 0; i < channels.length; i++) {
    if (!channels[i] || incoming[i] !== 0 || protectedStarts[i]) continue;
    const reach = headwaterReach(map, channels, incoming, protectedStarts, i, scratch);
    if (
      reach.reduce((length, cell) => {
        const target = map.FlowTargets[cell];
        return length + (target < 0 ? 0 : physicalDistance(map.mesh, cell, target));
      }, 0) < p.MinimumRiverReachLength &&
      !shortReachSupported(map, p, channels, incoming, reach)
    )
      for (const member of reach) channels[member] = 0;
  }
  releaseWorking(map, incoming, protectedStarts, scratch);
}
function strahlerOrder(largest: number, count: number): number {
  return largest === 0 ? 1 : count >= 2 ? largest + 1 : largest;
}
function strahlerOrders(map: PhysicalField, order: NumericalVector, channels: NumericalVector) {
  const largest = workingArray(map, "int32", "river:largest"),
    count = workingArray(map, "int32", "river:count");
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
  releaseWorking(map, largest, count);
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
export function riverNetwork(map: PhysicalField, c: PhysicalContext, incoming?: NumericalVector) {
  for (let i = 0; i < map.mesh.count; i++)
    map.FlowAccumulation[i] =
      depthRateToDischarge(map.Runoff[i], map.mesh.areas[i]) + (incoming?.[i] ?? 0);
  const area = contributingArea(map.FlowTargets, map.mesh.areas, map.numerical);
  map.CatchmentArea.set(area);
  releaseWorking(map, area);
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
  releaseWorking(map, order, channels);
}
