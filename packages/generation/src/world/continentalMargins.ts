// ContinentalMarginEvolutionLayer.cs and MarineSedimentationLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { KeyedHeap } from "@atlas/domain";
export { marineSedimentation } from "../processes/marineSediment";
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
