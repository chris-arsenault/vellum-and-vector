// ContinentalMarginEvolutionLayer.cs and MarineSedimentationLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, units } from "./math";
import { deposit } from "./surface";
import { PriorityQueue } from "./priorityQueue";

const smooth = (value: number) => {
  const c = clamp(value, 0, 1);
  return c * c * (3 - 2 * c);
};
function adjacentLandMargin(map: PhysicalField, i: number): number {
  let selected = -1,
    priority = -1;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
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
    let distance = Infinity;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const at = i * map.mesh.stride + edge,
        j = map.mesh.neighbors[at];
      if (j >= 0 && map.WaterKindCodes[j] !== 1)
        distance = Math.min(distance, map.mesh.edgeLength[at] / 2);
    }
    map.OceanMarginDistance[i] = distance;
    map.CoastalMarginCodes[i] = margin;
    queue.push(i);
  }
  return queue;
}
function seedLandCoast(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] === 1) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j >= 0 && map.WaterKindCodes[j] === 1) {
        map.OceanMarginDistance[i] = -1;
        map.CoastalMarginCodes[i] = map.MarginCodes[i];
        break;
      }
    }
  }
}
function marginFrame(map: PhysicalField) {
  map.OceanMarginDistance.fill(Infinity);
  map.CoastalMarginCodes.fill(0);
  const queue = new PriorityQueue<{ i: number; distance: number }>(
    (a, b) => a.distance - b.distance || a.i - b.i
  );
  for (const i of seedOceanCoast(map)) queue.push({ i, distance: map.OceanMarginDistance[i] });
  seedLandCoast(map);
  while (queue.count) {
    const { i, distance } = queue.pop();
    if (distance !== map.OceanMarginDistance[i]) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const at = i * map.mesh.stride + edge,
        j = map.mesh.neighbors[at];
      const next = distance + map.mesh.edgeLength[at];
      if (j < 0 || map.OceanMarginDistance[j] <= next || map.WaterKindCodes[j] !== 1) continue;
      map.OceanMarginDistance[j] = next;
      map.CoastalMarginCodes[j] = map.CoastalMarginCodes[i];
      queue.push({ i: j, distance: next });
    }
  }
  for (let i = 0; i < map.mesh.count; i++)
    if (!Number.isFinite(map.OceanMarginDistance[i])) map.OceanMarginDistance[i] = 0;
}
export function continentalMarginEvolution(map: PhysicalField) {
  // Crust support owns structural relief and subsidence. Distance from today's coast
  // supplies a sediment frame, never a replacement crust column or bathymetric profile.
  marginFrame(map);
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
  const accommodation = Math.max(0, map.EffectiveSeaLevel - map.Elevation[i]);
  return Math.min(
    accommodation,
    Math.max(
      0,
      units(p.MarineSedimentCapacity * influence * (margin === 3 ? 0.72 : 1)) -
        map.SedimentThickness[i]
    )
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
