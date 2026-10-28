// ContinentalMarginEvolutionLayer.cs and MarineSedimentationLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, units } from "./math";
import { deposit } from "./surface";
import { KeyedHeap } from "@atlas/domain";
import { workingValues, releaseWorking } from "./physicalNumerics";

const smooth = (value: number) => {
  const c = clamp(value, 0, 1);
  return c * c * (3 - 2 * c);
};
function adjacentLandMargin(map: PhysicalField, i: number): number {
  let selected = -1,
    priority = -1;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j < 0 || map.WaterKindCodes.get(j) === 1) continue;
    const margin = map.MarginCodes.get(j),
      rank = [0, 1, 4, 3, 2][margin];
    if (rank > priority) {
      selected = margin;
      priority = rank;
    }
  }
  return selected;
}
function* seedOceanCoast(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1) continue;
    const margin = adjacentLandMargin(map, i);
    if (margin < 0) continue;
    let distance = Infinity;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0 && map.WaterKindCodes.get(j) !== 1)
        distance = Math.min(distance, map.mesh.edgeLength(i, edge) / 2);
    }
    map.OceanMarginDistance.set(i, distance);
    map.CoastalMarginCodes.set(i, margin);
    yield i;
  }
}
function seedLandCoast(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) === 1) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0 && map.WaterKindCodes.get(j) === 1) {
        map.OceanMarginDistance.set(i, -1);
        map.CoastalMarginCodes.set(i, map.MarginCodes.get(i));
        break;
      }
    }
  }
}
function marginFrame(map: PhysicalField) {
  map.OceanMarginDistance.fill(Infinity);
  map.CoastalMarginCodes.fill(0);
  const queue = new KeyedHeap("min");
  for (const i of seedOceanCoast(map)) queue.push(i, map.OceanMarginDistance.get(i));
  seedLandCoast(map);
  for (let i = queue.pop(); i >= 0; i = queue.pop()) {
    const distance = queue.poppedKey();
    if (distance !== map.OceanMarginDistance.get(i)) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      const next = distance + map.mesh.edgeLength(i, edge);
      if (j < 0 || map.OceanMarginDistance.get(j) <= next || map.WaterKindCodes.get(j) !== 1)
        continue;
      map.OceanMarginDistance.set(j, next);
      map.CoastalMarginCodes.set(j, map.CoastalMarginCodes.get(i));
      queue.push(j, next);
    }
  }
  for (let i = 0; i < map.mesh.count; i++)
    if (!Number.isFinite(map.OceanMarginDistance.get(i))) map.OceanMarginDistance.set(i, 0);
}
export function continentalMarginEvolution(map: PhysicalField) {
  // Crust support owns structural relief and subsidence. Distance from today's coast
  // supplies a sediment frame, never a replacement crust column or bathymetric profile.
  marginFrame(map);
}
function capacity(map: PhysicalField, p: PhysicalProfile, i: number): number {
  const margin = map.CoastalMarginCodes.get(i),
    distance = map.OceanMarginDistance.get(i);
  const width = margin === 1 ? p.PassiveShelfWidth : p.RiftedShelfWidth;
  const step = margin === 1 ? p.PassiveMarginMaximumGradient : p.RiftedMarginMaximumGradient;
  const rise =
    p.ContinentalRiseMinimumWidth +
    Math.ceil(Math.max(0, p.OceanicSubsidenceDepth + 200 - p.ContinentalShelfDepth) / step);
  if (distance <= 0 || distance > width + rise || (margin !== 1 && margin !== 3)) return 0;
  const influence = smooth(1 - (distance - 1) / (width + rise));
  const accommodation = Math.max(0, map.EffectiveSeaLevel - map.Elevation.get(i));
  return Math.min(
    accommodation,
    Math.max(
      0,
      units(p.MarineSedimentCapacity * influence * (margin === 3 ? 0.72 : 1)) -
        map.SedimentThickness.get(i)
    )
  );
}
export function marineSedimentation(map: PhysicalField, c: PhysicalContext) {
  if (map.SedimentExportedTotal <= 0) return;
  const capacities = workingValues(
    map,
    "float64",
    "marine:capacity",
    (i) => (capacity(map, c.Profile, i) / 1024) * map.mesh.area(i)
  );
  let remainingCapacity = map.coverage.reduce(capacities, (sum, value) => sum + value, 0);
  const exported = map.SedimentExportedTotal;
  const initialBudget = Math.min(exported, remainingCapacity);
  let budget = initialBudget;
  for (let i = 0; i < map.mesh.count; i++) {
    const available = capacities.get(i);
    if (available <= 0 || budget <= 0) {
      remainingCapacity -= available;
      continue;
    }
    const amount =
      remainingCapacity <= 0
        ? 0
        : Math.min(available, budget, (budget * available) / remainingCapacity);
    if (amount > 0) {
      const area = map.mesh.area(i);
      const deposited = (deposit(map, i, (amount * 1024) / area) / 1024) * area;
      budget -= Math.min(budget, deposited);
    }
    remainingCapacity -= available;
  }
  map.SedimentExportedTotal = exported - initialBudget + budget;
  releaseWorking(map, capacities);
}
