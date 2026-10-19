// ContinentalMarginEvolutionLayer.cs and MarineSedimentationLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { buoyancy, clamp, thickness, toUnits, units } from "./math";
import { deposit } from "./surface";

const smooth = (value: number) => {
  const c = clamp(value, 0, 1);
  return c * c * (3 - 2 * c);
};
function adjacentLandMargin(map: PhysicalField, i: number): number {
  let selected = -1,
    priority = -1;
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[i * 3 + edge];
    if (j < 0 || map.WaterKindCodes[j] === 1) continue;
    const margin = map.MarginCodes[j],
      rank = [0, 1, 4, 3, 2][margin];
    if (rank > priority) {
      selected = margin;
      priority = rank;
    }
  }
  return selected;
}
function seedOceanCoast(map: PhysicalField): number[] {
  const queue: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    const margin = adjacentLandMargin(map, i);
    if (margin < 0) continue;
    map.OceanMarginDistance[i] = map.mesh.spacing;
    map.CoastalMarginCodes[i] = margin;
    queue.push(i);
  }
  return queue;
}
function seedLandCoast(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] === 1) continue;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j >= 0 && map.WaterKindCodes[j] === 1) {
        map.OceanMarginDistance[i] = -1;
        map.CoastalMarginCodes[i] = map.MarginCodes[i];
        break;
      }
    }
  }
}
function marginFrame(map: PhysicalField) {
  map.OceanMarginDistance.fill(0);
  map.CoastalMarginCodes.fill(0);
  const queue = seedOceanCoast(map);
  seedLandCoast(map);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j < 0 || map.OceanMarginDistance[j] !== 0 || map.WaterKindCodes[j] !== 1) continue;
      map.OceanMarginDistance[j] = map.OceanMarginDistance[i] + map.mesh.spacing;
      map.CoastalMarginCodes[j] = map.CoastalMarginCodes[i];
      queue.push(j);
    }
  }
}
function convergentDepth(p: PhysicalProfile, distance: number, current: number): number {
  const ambient = Math.max(p.ContinentalSlopeDepth, p.OceanicSubsidenceDepth + 200);
  const trenchWidth = 50_000;
  if (distance <= trenchWidth)
    return Math.max(current, ambient + p.ConvergentTrenchDepth * smooth(distance / trenchWidth));
  const recovery = clamp((distance - trenchWidth) / p.ContinentalSlopeWidth, 0, 1);
  return recovery >= 1
    ? current
    : Math.max(current, ambient + p.ConvergentTrenchDepth * (1 - smooth(recovery)));
}
function desiredDepth(
  p: PhysicalProfile,
  margin: number,
  distance: number,
  current: number
): number {
  if (margin === 2) return convergentDepth(p, distance, current);
  const width =
    margin === 3 ? p.RiftedShelfWidth : margin === 4 ? p.TransformShelfWidth : p.PassiveShelfWidth;
  const depth = p.ContinentalShelfDepth * (margin === 3 ? 1.35 : margin === 4 ? 1.15 : 1);
  if (distance <= width) return Math.min(current, 12 + (depth - 12) * smooth(distance / width));
  const step =
    margin === 3
      ? p.RiftedMarginMaximumGradient
      : margin === 4
        ? p.TransformMarginMaximumGradient
        : p.PassiveMarginMaximumGradient;
  const oceanward = distance - width,
    ramp = p.ContinentalRiseMinimumWidth;
  const rise =
    oceanward <= ramp ? (step * oceanward * oceanward) / (2 * ramp) : step * (oceanward - ramp / 2);
  return Math.min(current, depth + rise);
}
export function continentalMarginEvolution(map: PhysicalField, c: PhysicalContext) {
  marginFrame(map);
  for (let i = 0; i < map.mesh.count; i++) {
    const distance = map.OceanMarginDistance[i];
    if (distance <= 0) continue;
    const depth = Math.max(1, toUnits(map.EffectiveSeaLevel - map.Elevation[i]));
    const desired =
      map.EffectiveSeaLevel -
      units(desiredDepth(c.Profile, map.CoastalMarginCodes[i], distance, depth));
    const difference = toUnits(desired - map.Elevation[i]);
    if (Math.abs(difference) < 0.5) continue;
    const adjustment =
      ((difference / (buoyancy(map.CrustContinentalFraction[i] / 1000) / 1000)) *
        c.Profile.MarginEvolutionResponsePerMille) /
      1000;
    map.CrustThickness[i] = units(thickness(toUnits(map.CrustThickness[i]) + adjustment));
  }
}
function capacity(map: PhysicalField, p: PhysicalProfile, i: number): number {
  const margin = map.CoastalMarginCodes[i],
    distance = map.OceanMarginDistance[i];
  const width = margin === 1 ? p.PassiveShelfWidth : p.RiftedShelfWidth;
  const step = margin === 1 ? p.PassiveMarginMaximumGradient : p.RiftedMarginMaximumGradient;
  const rise =
    p.ContinentalRiseMinimumWidth +
    Math.ceil(Math.max(0, p.OceanicSubsidenceDepth + 200 - p.ContinentalShelfDepth) / step);
  if (distance <= 0 || distance > width + rise || (margin !== 1 && margin !== 3)) return 0;
  const influence = smooth(1 - (distance - 1) / (width + rise));
  return Math.max(
    0,
    units(p.MarineSedimentCapacity * influence * (margin === 3 ? 0.72 : 1)) -
      map.SedimentThickness[i]
  );
}
export function marineSedimentation(map: PhysicalField, c: PhysicalContext) {
  if (map.SedimentExportedTotal <= 0) return;
  const capacities = Float64Array.from(
    { length: map.mesh.count },
    (_, i) => (capacity(map, c.Profile, i) / 1024) * map.mesh.areas[i]
  );
  let remainingCapacity = capacities.reduce((sum, value) => sum + value, 0);
  const exported = map.SedimentExportedTotal;
  const initialBudget = Math.min(exported, remainingCapacity);
  let budget = initialBudget;
  for (let i = 0; i < map.mesh.count; i++) {
    const available = capacities[i];
    if (available <= 0 || budget <= 0) {
      remainingCapacity -= available;
      continue;
    }
    const amount =
      remainingCapacity <= 0
        ? 0
        : Math.min(available, budget, (budget * available) / remainingCapacity);
    if (amount > 0) {
      const deposited =
        (deposit(map, i, (amount * 1024) / map.mesh.areas[i]) / 1024) * map.mesh.areas[i];
      budget -= Math.min(budget, deposited);
    }
    remainingCapacity -= available;
  }
  map.SedimentExportedTotal = exported - initialBudget + budget;
}
